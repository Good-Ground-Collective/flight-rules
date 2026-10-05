import type { HostSettingsSource, SettingsScope } from "./host-settings-source.js";
export interface ClaudeSettingsSourceProps {
    cwd: string;
    env?: Record<string, string | undefined>;
    home?: string;
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
    constructor(props: ClaudeSettingsSourceProps);
    pathFor(scope: SettingsScope): string;
    read(scope: SettingsScope): Record<string, unknown> | undefined;
    write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void;
    hint(): string;
    private parse;
    private pluginKey;
}
