import { z } from 'zod';
type ExecFileFn = (file: string, args: readonly string[]) => Promise<{
    stdout: string;
    stderr: string;
}>;
export interface BranchSpec {
    type: string;
    scope: string;
    description?: string;
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
    getCurrentBranch(): Promise<string>;
    push(spec: PushSpec): Promise<void>;
}
export declare class NodeGitExecutor implements GitExecutor {
    private readonly execFile;
    constructor(execFileFn?: ExecFileFn);
    stage(files: string[]): Promise<void>;
    commit(message: string, files?: readonly string[]): Promise<void>;
    getCommitSha(): Promise<string>;
    checkout(spec: BranchSpec, from?: string): Promise<string>;
    getCurrentBranch(): Promise<string>;
    push(spec: PushSpec): Promise<void>;
}
export {};
