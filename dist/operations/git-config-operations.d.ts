import { z } from "zod";
import type { GitExecutor } from "../git/git-executor/git-executor.js";
import type { ConfigStore, ConfigScope } from "../shared/config-store.js";
import type { OperationDescriptor } from "./operation-registry.js";
export declare const ConfigScopeSchema: z.ZodEnum<{
    file: "file";
    local: "local";
    user: "user";
    project: "project";
}>;
declare const GitConfigOperationsPropsSchema: z.ZodObject<{
    cwd: z.ZodString;
    configStore: z.ZodCustom<ConfigStore, ConfigStore>;
    git: z.ZodCustom<GitExecutor, GitExecutor>;
    configPolicy: z.ZodDefault<z.ZodObject<{
        scopes: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            file: "file";
            local: "local";
            user: "user";
            project: "project";
        }>>>;
        roots: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    binPath: z.ZodDefault<z.ZodString>;
    agentEnv: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export interface ConfigOperationPolicy {
    scopes: ConfigScope[];
    roots: string[];
}
export interface GitConfigOperations {
    operations(): OperationDescriptor[];
}
export declare class LaunchConfigOperationDeniedError extends Error {
    name: string;
}
/** Shared config and git behavior bound to one checkout and its launch-time write policy. */
export declare class DefaultGitConfigOperations implements GitConfigOperations {
    private readonly props;
    private readonly allowedScopes;
    private readonly allowedRoots;
    constructor(props: z.input<typeof GitConfigOperationsPropsSchema>);
    operations(): OperationDescriptor[];
    private descriptor;
    private setConfig;
    private unsetConfig;
    private authorizeConfigWrite;
    private rejectDanglingSymlinks;
    private commit;
    private checkout;
    private push;
    private message;
}
export {};
