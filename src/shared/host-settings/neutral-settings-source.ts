import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { HostSettingsSource, SettingsScope } from "./host-settings-source.js";

const PropsSchema = z.object({
  cwd: z.string().min(1),
  home: z.string().min(1).default(homedir),
  untrackedCwd: z.string().min(1).optional(),
});
const SettingsSchema = z.record(z.string(), z.unknown());

export class InvalidSettingsError extends Error {
  override name = "InvalidSettingsError";
}

/** Flight-rules-owned settings for Codex; never adds unsupported keys to native config.toml. */
export class NeutralSettingsSource implements HostSettingsSource {
  readonly host = "codex";
  private readonly props: z.infer<typeof PropsSchema>;

  constructor(props: z.input<typeof PropsSchema>) {
    this.props = PropsSchema.parse(props);
  }

  pathFor(scope: SettingsScope): string {
    if (scope === "user") return join(this.props.home, ".agents", "flight-rules.settings.json");
    if (scope === "project") return join(this.props.cwd, ".agents", "flight-rules.settings.json");
    const path = join(this.props.cwd, ".agents", "flight-rules.settings.local.json");
    return this.props.untrackedCwd === undefined || existsSync(path)
      ? path
      : join(this.props.untrackedCwd, ".agents", "flight-rules.settings.local.json");
  }

  read(scope: SettingsScope): Record<string, unknown> | undefined {
    const path = this.pathFor(scope);
    if (!existsSync(path)) return undefined;
    try {
      return SettingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (cause) {
      throw new InvalidSettingsError(`Invalid flight-rules settings object at ${path}`, { cause });
    }
  }

  write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void {
    const values = SettingsSchema.parse(update(this.read(scope) ?? {}));
    const path = this.pathFor(scope);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`);
  }

  hint(): string {
    return `use FLIGHT_RULES_HOST=codex flight-rules config set with --scope user, project or local; inspect paths with config show`;
  }
}
