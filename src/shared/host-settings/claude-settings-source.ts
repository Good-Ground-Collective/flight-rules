import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { HostSettingsSource, SettingsScope } from "./host-settings-source.js";

const pluginId = "flight-rules@flight-rules";
const pluginKeyPattern = /^flight-rules(@.+)?$/;

const SettingsSchema = z.looseObject({
  pluginConfigs: z
    .record(z.string(), z.looseObject({ options: z.record(z.string(), z.unknown()).optional() }))
    .optional(),
});
type Settings = z.infer<typeof SettingsSchema>;

export interface ClaudeSettingsSourceProps {
  cwd: string;
  env?: Record<string, string | undefined>;
  home?: string;
  /** The main checkout of a linked worktree; `local` settings fall back there. */
  untrackedCwd?: string;
}

/**
 * Claude Code settings files, where plugin options live under
 * `pluginConfigs["flight-rules@<marketplace>"].options`: the user's
 * `settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), and the project's
 * `.claude/settings.json` and `.claude/settings.local.json`.
 */
export class ClaudeSettingsSource implements HostSettingsSource {
  readonly host = "claude";
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly home: string;
  private readonly untrackedCwd: string | undefined;

  constructor(props: ClaudeSettingsSourceProps) {
    this.cwd = props.cwd;
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
    this.untrackedCwd = props.untrackedCwd;
  }

  pathFor(scope: SettingsScope): string {
    switch (scope) {
      case "user":
        return join(this.env["CLAUDE_CONFIG_DIR"] ?? join(this.home, ".claude"), "settings.json");
      case "project":
        return join(this.cwd, ".claude", "settings.json");
      case "local":
        return this.localPath();
    }
  }

  read(scope: SettingsScope): Record<string, unknown> | undefined {
    const path = this.pathFor(scope);
    if (!existsSync(path)) return undefined;
    const settings = this.parse(path, readFileSync(path, "utf-8"));
    const key = this.pluginKey(settings);
    return key === undefined ? undefined : settings.pluginConfigs?.[key]?.options;
  }

  write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void {
    const path = this.pathFor(scope);
    const settings = existsSync(path) ? this.parse(path, readFileSync(path, "utf-8")) : {};
    const key = this.pluginKey(settings) ?? pluginId;
    const pluginConfigs = { ...settings.pluginConfigs };
    const entry = pluginConfigs[key] ?? {};
    pluginConfigs[key] = { ...entry, options: update(entry.options ?? {}) };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...settings, pluginConfigs }, null, 2)}\n`);
  }

  hint(): string {
    return `set pluginConfigs["${pluginId}"].options in ${this.pathFor("user")}, ${this.pathFor("project")}, or ${this.pathFor("local")}`;
  }

  /** settings.local.json is untracked, so a linked worktree starts without one. */
  private localPath(): string {
    const here = join(this.cwd, ".claude", "settings.local.json");
    if (this.untrackedCwd === undefined || existsSync(here)) return here;
    return join(this.untrackedCwd, ".claude", "settings.local.json");
  }

  private parse(path: string, contents: string): Settings {
    let json: unknown;
    try {
      json = JSON.parse(contents);
    } catch (err) {
      throw new Error(`${path} is not valid JSON`, { cause: err });
    }
    return SettingsSchema.parse(json);
  }

  private pluginKey(settings: Settings): string | undefined {
    const keys = Object.keys(settings.pluginConfigs ?? {}).filter((k) => pluginKeyPattern.test(k));
    return keys.includes(pluginId) ? pluginId : keys.sort()[0];
  }
}
