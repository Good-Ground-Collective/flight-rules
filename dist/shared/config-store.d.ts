import type { Config, PathProbe } from "./config.js";
import type { HostSettingsSource } from "./host-settings/host-settings-source.js";
/**
 * Where a config layer lives, lowest precedence first. `user`, `project`, and
 * `local` are the host's settings files, read through a `HostSettingsSource`;
 * `file` is the flight-rules config file that `flight-rules config path`
 * reports.
 */
export declare const configScopes: readonly ["user", "project", "local", "file"];
export type ConfigScope = (typeof configScopes)[number];
export interface ConfigLayer {
    scope: ConfigScope;
    path: string;
    present: boolean;
    values: Record<string, unknown>;
}
export interface ConfigReport {
    config: Config;
    sources: Record<string, {
        scope: ConfigScope;
        path: string;
    }>;
    layers: {
        scope: ConfigScope;
        path: string;
        present: boolean;
    }[];
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
export declare class ConfigStore {
    private readonly cwd;
    private readonly env;
    private readonly hostSettings;
    private readonly pathProbe;
    private readonly untrackedRoot;
    constructor(props: ConfigStoreProps);
    /** The flight-rules config file path, as `flight-rules config path` reports it. */
    filePath(): string;
    pathFor(scope: ConfigScope): string;
    layers(): ConfigLayer[];
    load(): Config;
    report(): ConfigReport;
    inspect(): ConfigInspection;
    /**
     * The scope a write lands in when the caller names none: wherever the key
     * is set now, else the config file when one exists, else `local`.
     */
    defaultScopeFor(key: string): ConfigScope;
    set(key: string, rawValues: readonly string[], scope: ConfigScope): ConfigScope;
    unset(key: string, scope: ConfigScope): void;
    /**
     * The highest-precedence scope that sets `key`, when it outranks `scope`.
     * A write to `scope` would then not take effect.
     */
    shadowingScope(key: string, scope: ConfigScope): ConfigScope | undefined;
    private merge;
    private layer;
    private readLayer;
    private write;
    private toFrontmatter;
    private assertKnownKey;
    private coerce;
}
