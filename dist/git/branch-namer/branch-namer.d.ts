export interface BranchSpec {
    type: string;
    scope: string;
    description?: string;
}
/** Builds the conventional `<type>/<scope>[-<description>]` branch name. */
export declare class BranchNamer {
    name(spec: BranchSpec): string;
}
export declare const branchNamer: BranchNamer;
