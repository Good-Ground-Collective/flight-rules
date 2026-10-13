/**
 * Removes the attribution trailers Claude Code appends to commits and PR
 * bodies: `Co-Authored-By: Claude …`, `Claude-Session: …`, and a bare
 * claude.ai session link on its own line.
 */
export declare class AttributionStripper {
    strip(text: string): string;
    /** The command with attribution removed, or undefined when it writes no message or carries none. */
    stripCommand(command: string): string | undefined;
    /** True when a single trailer line, such as one `--footer` value, is Claude attribution. */
    isAttribution(line: string): boolean;
}
