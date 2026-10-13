type ExecFileFn = (file: string, args: readonly string[]) => Promise<{
    stdout: string;
    stderr: string;
}>;
export interface ToolCheck {
    name: string;
    ok: boolean;
    detail: string;
    required: boolean;
    code?: string | undefined;
    remedy?: string | undefined;
}
export interface ToolProbeInput {
    repo?: string | undefined;
    /** True when QA instructions apply to the repo, which makes the capture tools required. */
    qaInstructionsFound: boolean;
    /** Omitted preserves the general environment check's existing requirements. */
    githubRequired?: boolean;
    pushRequired?: boolean;
}
export interface ToolProbe {
    probe(input: ToolProbeInput): Promise<ToolCheck[]>;
}
export interface NodeToolProbeProps {
    execFileFn?: ExecFileFn;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
}
/**
 * Probes the CLI's operating environment for the binaries `flight-rules`
 * shells out to, so a missing or outdated tool surfaces in `check` rather
 * than partway through a run.
 */
export declare class NodeToolProbe implements ToolProbe {
    private readonly execFile;
    private readonly env;
    constructor(props?: NodeToolProbeProps);
    probe(input: ToolProbeInput): Promise<ToolCheck[]>;
    private ghVersion;
    private ghAuth;
    private ghPush;
    private present;
    /** True when `version` is at least `minimum`, comparing major, minor, then patch. */
    private meetsMinimumVersion;
}
export declare const nodeToolProbe: ToolProbe;
export {};
