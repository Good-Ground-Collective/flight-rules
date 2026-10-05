import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigSchema, parseFrontmatter, resolveConfigPath } from "./config.js";
import type { Config, PathProbe } from "./config.js";
import { ClaudeSettingsSource } from "./host-settings/claude-settings-source.js";
import type { HostSettingsSource } from "./host-settings/host-settings-source.js";

/**
 * Where a config layer lives, lowest precedence first. `user`, `project`, and
 * `local` are the host's settings files, read through a `HostSettingsSource`;
 * `file` is the flight-rules config file that `flight-rules config path`
 * reports.
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
  /** The host's settings layers; defaults to Claude Code's. */
  hostSettings?: HostSettingsSource;
  /** Used for the user settings path when no host source is given. */
  home?: string;
  pathProbe?: PathProbe;
  /**
   * The main checkout when running in a linked git worktree. Untracked layers
   * (the config file, and the host's local settings) resolve there when the
   * worktree has no copy of its own, so reads find them and writes outlive
   * the worktree.
   */
  untrackedRoot?: string;
}

/**
 * Resolves flight-rules config from every place it may live and merges it
 * key by key, so shared values (tracker, Jira host, statuses) can sit in the
 * user's host settings while a project sets only what differs.
 */
export class ConfigStore {
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly hostSettings: HostSettingsSource;
  private readonly pathProbe: PathProbe | undefined;
  private readonly untrackedRoot: string | undefined;

  constructor(props: ConfigStoreProps) {
    this.cwd = props.cwd;
    this.env = props.env ?? process.env;
    this.pathProbe = props.pathProbe;
    this.untrackedRoot = props.untrackedRoot;
    this.hostSettings =
      props.hostSettings ??
      new ClaudeSettingsSource({
        cwd: props.cwd,
        env: this.env,
        ...(props.home !== undefined ? { home: props.home } : {}),
        ...(props.untrackedRoot !== undefined ? { untrackedCwd: props.untrackedRoot } : {}),
      });
  }

  /** The flight-rules config file path, as `flight-rules config path` reports it. */
  filePath(): string {
    const override = this.env["FLIGHT_RULES_CONFIG"];
    const here = resolveConfigPath(this.cwd, override, this.pathProbe);
    if (override !== undefined || this.untrackedRoot === undefined) return here;
    const isFile = this.pathProbe?.isFile.bind(this.pathProbe) ?? existsSync;
    return isFile(here) ? here : resolveConfigPath(this.untrackedRoot, undefined, this.pathProbe);
  }

  pathFor(scope: ConfigScope): string {
    return scope === "file" ? this.filePath() : this.hostSettings.pathFor(scope);
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
        `No flight-rules config found. Run the flight-rules setup skill, write ${this.filePath()}, or ${this.hostSettings.hint()}`,
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
    if (scope === "file") {
      if (!existsSync(path)) return { scope, path, present: false, values: {} };
      return { scope, path, present: true, values: parseFrontmatter(readFileSync(path, "utf-8")) };
    }
    const values = this.hostSettings.read(scope);
    return { scope, path, present: values !== undefined, values: values ?? {} };
  }

  private write(
    scope: ConfigScope,
    update: (values: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    if (scope !== "file") {
      this.hostSettings.write(scope, update);
      return;
    }
    const path = this.filePath();
    const contents = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
    mkdirSync(dirname(path), { recursive: true });
    const values = update(contents === undefined ? {} : parseFrontmatter(contents));
    const body = contents?.replace(/^---\n[\s\S]*?\n---\n?/, "") ?? "";
    writeFileSync(path, `${this.toFrontmatter(values)}${body}`);
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
