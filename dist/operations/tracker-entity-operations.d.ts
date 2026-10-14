import { z } from "zod";
import { type TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import type { OperationDescriptor } from "./operation-registry.js";
import { type OperationAccessPolicy, type OperationRegistry } from "./operation-registry.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
declare const propsSchema: z.ZodObject<{
    getTracker: z.ZodCustom<() => TaskTracker, () => TaskTracker>;
    getPrHost: z.ZodOptional<z.ZodCustom<() => PullRequestHost, () => PullRequestHost>>;
    getConfig: z.ZodOptional<z.ZodCustom<() => Pick<Config, "inReviewStatus">, () => Pick<Config, "inReviewStatus">>>;
    cwd: z.ZodString;
    trustedRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export interface TrackerEntityOperations {
    operations(): OperationDescriptor[];
    registry(policy?: OperationAccessPolicy): OperationRegistry;
}
/** Shares guarded tracker entity writes across CLI, MCP, and SDK callers. */
export declare class DefaultTrackerEntityOperations implements TrackerEntityOperations {
    private readonly props;
    private readonly roots;
    constructor(props: z.input<typeof propsSchema>);
    operations(): OperationDescriptor[];
    registry(policy?: OperationAccessPolicy): OperationRegistry;
    private descriptor;
    private createEpic;
    private editEpic;
    private createInitiative;
    private editInitiative;
    private createTicket;
    private editTicket;
    private createTdd;
    private assertPortable;
    private trustedFilePath;
}
export {};
