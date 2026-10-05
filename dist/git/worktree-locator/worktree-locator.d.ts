type ExecFileSyncFn = (file: string, args: readonly string[], cwd: string) => string;
export interface WorktreeLocatorProps {
    execFileSyncFn?: ExecFileSyncFn;
}
/**
 * Finds the main checkout behind a linked git worktree. Untracked files such
 * as local config and QA evidence live there, because a linked worktree
 * starts without them and is deleted when its work is done.
 */
export declare class WorktreeLocator {
    private readonly execFileSync;
    constructor(props?: WorktreeLocatorProps);
    /** The main checkout's root when `cwd` is inside a linked worktree; otherwise undefined. */
    mainCheckoutFor(cwd: string): string | undefined;
}
export {};
