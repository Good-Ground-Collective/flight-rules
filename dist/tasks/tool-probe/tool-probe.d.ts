type ExecFileFn = (file: string, args: readonly string[]) => Promise<{
    stdout: string;
    stderr: string;
}>;
export interface ToolCheck {
    name: string;
    ok: boolean;
    detail: string;
    required: boolean;
}
export interface ToolProbeInput {
    repo?: string | undefined;
    /** True when QA instructions apply to the repo, which makes the capture tools required. */
    qaInstructionsFound: boolean;
}
export interface ToolProbe {
    probe(input: ToolProbeInput): Promise<ToolCheck[]>;
}
export interface NodeToolProbeProps {
    execFileFn?: ExecFileFn;
}
/**
 * Probes the CLI's operating environment for the binaries `flight-rules`
 * shells out to, so a missing or outdated tool surfaces in `check` rather
 * than partway through a run.
 */
export declare class NodeToolProbe implements ToolProbe {
    private readonly execFile;
    constructor(props?: NodeToolProbeProps);
    probe(input: ToolProbeInput): Promise<ToolCheck[]>;
    private ghVersion;
    private ghAuth;
    private ghPush;
    private present;
    /** True when `version` is at least `minimum`, comparing major, minor, then patch. */
    private meetsMinimumVersion;
    /** Distinguishes a missing binary (ENOENT) from a binary that ran and failed. */
    private isMissingBinary;
    private stderrOf;
}
export declare const nodeToolProbe: ToolProbe;
export {};
