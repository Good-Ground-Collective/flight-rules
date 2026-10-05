type ExecFileSyncFn = (file: string, args: readonly string[], cwd: string) => string;
export interface EvidenceDir {
    path: string;
    /** Whether git ignores the path in the repo that holds it; null outside any repo. */
    gitignored: boolean | null;
}
export interface EvidenceLocationProps {
    cwd: string;
    /** The main checkout when cwd is a linked worktree. */
    mainCheckout?: string | undefined;
    execFileSyncFn?: ExecFileSyncFn;
}
/**
 * Where QA evidence for a ticket is written: `evidence/<ticket>` inside the
 * host's config directory (`.claude/` or `.agents/`) of the main checkout,
 * so evidence outlives a linked worktree and never shows in its status.
 */
export declare class EvidenceLocation {
    private readonly root;
    private readonly execFileSync;
    constructor(props: EvidenceLocationProps);
    dirFor(ticket: string): EvidenceDir;
    private isIgnored;
}
export {};
