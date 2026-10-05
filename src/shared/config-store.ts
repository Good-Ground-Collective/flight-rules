import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ConfigSchema, parseFrontmatter } from "./config.js";
import type { Config } from "./config.js";

/**
 * Where a config layer lives, lowest precedence first. `user`, `project`, and
 * `local` are Claude Code settings files carrying the values under
 * `pluginConfigs["flight-rules@<marketplace>"].options`; `file` is the
 * flight-rules config file (`$FLIGHT_RULES_CONFIG` or
 * `.claude/flight-rules.local.md`).
 */
export const configScopes = ["user", "project", "local", "file"] as const;
export type ConfigScope = (typeof configScopes)[number];

export interface ConfigLayer {
  scope: ConfigScope;
  path: string;
  present: boolean;
  values: Record<string, unknown>;
}

export interface ConfigReport {
  config: Config;
  sources: Record<string, { scope: ConfigScope; path: string }>;
  layers: { scope: ConfigScope; path: string; present: boolean }[];
}

/**
 * What `config show` prints: the merged values even when they do not yet
 * form a valid config, so a half-finished setup can still be inspected.
 */
export interface ConfigInspection {
  valid: boolean;
  error?: string;
  values: Record<string, unknown>;
  sources: ConfigReport["sources"];
  layers: ConfigReport["layers"];
}

export interface ConfigStoreProps {
  cwd: string;
  env?: Record<string, string | undefined>;
  home?: string;
}

const pluginId = "flight-rules@flight-rules";
const pluginKeyPattern = /^flight-rules(@.+)?$/;

const SettingsSchema = z.looseObject({
  pluginConfigs: z
    .record(z.string(), z.looseObject({ options: z.record(z.string(), z.unknown()).optional() }))
    .optional(),
});

/**
 * Resolves flight-rules config from every place it may live and merges it
 * key by key, so shared values (tracker, Jira host, statuses) can sit in the
 * user's Claude Code settings while a project sets only what differs.
 */
export class ConfigStore {
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly home: string;

  constructor(props: ConfigStoreProps) {
    this.cwd = props.cwd;
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
  }

  /** The flight-rules config file path, honouring `FLIGHT_RULES_CONFIG`. */
  filePath(): string {
    return this.env["FLIGHT_RULES_CONFIG"] ?? join(this.cwd, ".claude", "flight-rules.local.md");
  }

  pathFor(scope: ConfigScope): string {
    switch (scope) {
      case "user":
        return join(this.env["CLAUDE_CONFIG_DIR"] ?? join(this.home, ".claude"), "settings.json");
      case "project":
        return join(this.cwd, ".claude", "settings.json");
      case "local":
        return join(this.cwd, ".claude", "settings.local.json");
      case "file":
        return this.filePath();
    }
  }

  layers(): ConfigLayer[] {
    return configScopes.map((scope) => this.readLayer(scope));
  }

  load(): Config {
    return this.report().config;
  }

  report(): ConfigReport {
    const { values, sources, layers } = this.merge();
    if (Object.keys(values).length === 0) {
      throw new Error(
        `No flight-rules config found. Run /flight-rules:setup, or set pluginConfigs["${pluginId}"].options in ${this.pathFor("user")}, ${this.pathFor("project")}, or ${this.pathFor("local")}`,
      );
    }
    return { config: ConfigSchema.parse(values), sources, layers };
  }

  inspect(): ConfigInspection {
    const merged = this.merge();
    const result = ConfigSchema.safeParse(merged.values);
    if (result.success) return { valid: true, ...merged, values: result.data };
    const error =
      Object.keys(merged.values).length === 0
        ? "no flight-rules config found"
        : result.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
    return { valid: false, error, ...merged };
  }

  /**
   * The scope a write lands in when the caller names none: wherever the key
   * is set now, else the config file when one exists, else `local`.
   */
  defaultScopeFor(key: string): ConfigScope {
    const layers = this.layers();
    const owner = [...layers].reverse().find((layer) => key in layer.values);
    if (owner !== undefined) return owner.scope;
    return this.layer(layers, "file").present ? "file" : "local";
  }

  set(key: string, rawValues: readonly string[], scope: ConfigScope): ConfigScope {
    const value = this.coerce(key, rawValues);
    this.write(scope, (values) => ({ ...values, [key]: value }));
    return scope;
  }

  unset(key: string, scope: ConfigScope): void {
    this.assertKnownKey(key);
    this.write(scope, (values) => {
      const next = { ...values };
      delete next[key];
      return next;
    });
  }

  /**
   * The highest-precedence scope that sets `key`, when it outranks `scope`.
   * A write to `scope` would then not take effect.
   */
  shadowingScope(key: string, scope: ConfigScope): ConfigScope | undefined {
    const rank = configScopes.indexOf(scope);
    return [...this.layers()]
      .reverse()
      .find((layer) => configScopes.indexOf(layer.scope) > rank && key in layer.values)?.scope;
  }

  private merge(): Omit<ConfigInspection, "valid" | "error"> {
    const layers = this.layers();
    if (this.env["FLIGHT_RULES_CONFIG"] !== undefined && !this.layer(layers, "file").present) {
      throw new Error(`FLIGHT_RULES_CONFIG points at ${this.filePath()}, which does not exist`);
    }
    const values: Record<string, unknown> = {};
    const sources: ConfigReport["sources"] = {};
    for (const layer of layers) {
      for (const [key, value] of Object.entries(layer.values)) {
        values[key] = value;
        sources[key] = { scope: layer.scope, path: layer.path };
      }
    }
    return {
      values,
      sources,
      layers: layers.map(({ scope, path, present }) => ({ scope, path, present })),
    };
  }

  private layer(layers: ConfigLayer[], scope: ConfigScope): ConfigLayer {
    const found = layers.find((l) => l.scope === scope);
    if (found === undefined) throw new Error(`unknown config scope ${scope}`);
    return found;
  }

  private readLayer(scope: ConfigScope): ConfigLayer {
    const path = this.pathFor(scope);
    if (!existsSync(path)) return { scope, path, present: false, values: {} };
    const contents = readFileSync(path, "utf-8");
    if (scope === "file") return { scope, path, present: true, values: parseFrontmatter(contents) };
    const options = this.pluginOptions(this.parseSettings(path, contents));
    return { scope, path, present: options !== undefined, values: options ?? {} };
  }

  private parseSettings(path: string, contents: string): z.infer<typeof SettingsSchema> {
    let json: unknown;
    try {
      json = JSON.parse(contents);
    } catch (err) {
      throw new Error(`${path} is not valid JSON`, { cause: err });
    }
    return SettingsSchema.parse(json);
  }

  private pluginKey(settings: z.infer<typeof SettingsSchema>): string | undefined {
    const keys = Object.keys(settings.pluginConfigs ?? {}).filter((k) => pluginKeyPattern.test(k));
    return keys.includes(pluginId) ? pluginId : keys.sort()[0];
  }

  private pluginOptions(settings: z.infer<typeof SettingsSchema>): Record<string, unknown> | undefined {
    const key = this.pluginKey(settings);
    if (key === undefined) return undefined;
    return settings.pluginConfigs?.[key]?.options;
  }

  private write(
    scope: ConfigScope,
    update: (values: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    const path = this.pathFor(scope);
    const contents = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
    mkdirSync(dirname(path), { recursive: true });

    if (scope === "file") {
      const values = update(contents === undefined ? {} : parseFrontmatter(contents));
      const body = contents?.replace(/^---\n[\s\S]*?\n---\n?/, "") ?? "";
      writeFileSync(path, `${this.toFrontmatter(values)}${body}`);
      return;
    }

    const settings = contents === undefined ? {} : this.parseSettings(path, contents);
    const key = this.pluginKey(settings) ?? pluginId;
    const pluginConfigs = { ...settings.pluginConfigs };
    const entry = pluginConfigs[key] ?? {};
    pluginConfigs[key] = { ...entry, options: update(entry.options ?? {}) };
    writeFileSync(path, `${JSON.stringify({ ...settings, pluginConfigs }, null, 2)}\n`);
  }

  private toFrontmatter(values: Record<string, unknown>): string {
    const lines = Object.entries(values).flatMap(([key, value]) =>
      Array.isArray(value)
        ? [`${key}:`, ...value.map((item) => `  - ${String(item)}`)]
        : [`${key}: ${String(value)}`],
    );
    return `---\n${lines.join("\n")}\n---\n`;
  }

  private assertKnownKey(key: string): void {
    if (!(key in ConfigSchema.shape)) {
      throw new Error(
        `Unknown config key "${key}" — expected one of: ${Object.keys(ConfigSchema.shape).join(", ")}`,
      );
    }
  }

  private coerce(key: string, rawValues: readonly string[]): unknown {
    this.assertKnownKey(key);
    const field = Object.entries(ConfigSchema.shape).find(([name]) => name === key)?.[1];
    if (field === undefined) return undefined;
    // Array fields (defaultLabels, competencies) accept a list and reject a
    // bare string; every other field is a scalar string.
    const isArray = field.safeParse([]).success && !field.safeParse("").success;
    const value = isArray ? [...rawValues] : rawValues.join(" ");
    const result = field.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid value for ${key}: ${result.error.issues.map((i) => i.message).join("; ")}`);
    }
    return value;
  }
}
