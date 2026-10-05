import type { HostSettingsSource, SettingsScope } from "./host-settings-source.js";
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
export declare class ClaudeSettingsSource implements HostSettingsSource {
    readonly host = "claude";
    private readonly cwd;
    private readonly env;
    private readonly home;
    private readonly untrackedCwd;
    constructor(props: ClaudeSettingsSourceProps);
    pathFor(scope: SettingsScope): string;
    read(scope: SettingsScope): Record<string, unknown> | undefined;
    write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void;
    hint(): string;
    /** settings.local.json is untracked, so a linked worktree starts without one. */
    private localPath;
    private parse;
    private pluginKey;
}
