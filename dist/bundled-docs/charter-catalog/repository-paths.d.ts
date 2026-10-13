import { z } from 'zod';
export declare const BaseRefSchema: z.ZodString;
declare const GitRepositoryPathsPropsSchema: z.ZodObject<{
    cwd: z.ZodString;
}, z.core.$strip>;
export type GitRepositoryPathsProps = z.input<typeof GitRepositoryPathsPropsSchema>;
/** Lists the repository-relative paths a charter selection is made from. */
export interface RepositoryPaths {
    /** Every tracked file plus untracked files git does not ignore. */
    inventory(): Promise<string[]>;
    /** Files changed since the merge base with `base`, including uncommitted and untracked work. */
    changedSince(base: string): Promise<string[]>;
}
export declare class GitRepositoryPaths implements RepositoryPaths {
    private readonly cwd;
    constructor(props: GitRepositoryPathsProps);
    inventory(): Promise<string[]>;
    changedSince(base: string): Promise<string[]>;
    private root;
    private paths;
    private git;
}
export declare class RepositoryPathsError extends Error {
    name: string;
}
export {};
