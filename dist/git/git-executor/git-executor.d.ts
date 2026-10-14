import { z } from "zod";
import { type BranchSpec } from "../branch-namer/branch-namer.js";
export type { BranchSpec } from "../branch-namer/branch-namer.js";
type ExecFileFn = (file: string, args: readonly string[], options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}) => Promise<{
    stdout: string;
    stderr: string;
}>;
declare const NodeGitExecutorPropsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>>;
    execFile: z.ZodOptional<z.ZodCustom<ExecFileFn, ExecFileFn>>;
}, z.core.$strip>;
/** Where a branch started: a new branch, or a disposable worktree branch renamed in place. */
export interface BranchStart {
    branch: string;
    renamedFrom: string | null;
}
export declare const PushSpecSchema: z.ZodObject<{
    branch: z.ZodString;
    remote: z.ZodDefault<z.ZodString>;
    setUpstream: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type PushSpec = z.input<typeof PushSpecSchema>;
export interface GitExecutor {
    stage(files: string[]): Promise<void>;
    commit(message: string, files?: readonly string[]): Promise<void>;
    getCommitSha(): Promise<string>;
    checkout(spec: BranchSpec, from?: string): Promise<string>;
    /**
     * Like `checkout`, but in a linked worktree whose current branch is
     * disposable (no upstream, no commits of its own, not the default branch,
     * and at `from` when one is given) it renames that branch instead of
     * stacking a second branch on it.
     */
    startBranch(spec: BranchSpec, from?: string): Promise<BranchStart>;
    getCurrentBranch(): Promise<string>;
    push(spec: PushSpec): Promise<void>;
}
export declare class NodeGitExecutor implements GitExecutor {
    private readonly execFile;
    private readonly cwd;
    private readonly env;
    constructor(props?: z.input<typeof NodeGitExecutorPropsSchema>);
    stage(files: string[]): Promise<void>;
    commit(message: string, files?: readonly string[]): Promise<void>;
    getCommitSha(): Promise<string>;
    checkout(spec: BranchSpec, from?: string): Promise<string>;
    startBranch(spec: BranchSpec, from?: string): Promise<BranchStart>;
    getCurrentBranch(): Promise<string>;
    push(spec: PushSpec): Promise<void>;
    private isDisposableWorktreeBranch;
    private defaultBranch;
    private succeeds;
    private run;
}
