import { z } from "zod";
import { type TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import type { OperationDescriptor } from "./operation-registry.js";
declare const propsSchema: z.ZodObject<{
    getTracker: z.ZodCustom<() => TaskTracker, () => TaskTracker>;
    cwd: z.ZodString;
    trustedRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export interface TicketLifecycleOperations {
    operations(): OperationDescriptor[];
}
/** Shares guarded ticket lifecycle changes across Commander and programmatic hosts. */
export declare class DefaultTicketLifecycleOperations implements TicketLifecycleOperations {
    private readonly props;
    private readonly roots;
    constructor(props: z.input<typeof propsSchema>);
    operations(): OperationDescriptor[];
    private descriptor;
    private block;
    private unblock;
    private transition;
    private comment;
    private updateLabels;
    private trustedFilePath;
}
export {};
