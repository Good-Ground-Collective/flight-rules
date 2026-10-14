import { z } from "zod";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { OperationDescriptor } from "./operation-registry.js";
declare const propsSchema: z.ZodObject<{
    cwd: z.ZodString;
    getHost: z.ZodCustom<() => PullRequestHost, () => PullRequestHost>;
}, z.core.$strict>;
export interface PrOperations {
    operations(): OperationDescriptor[];
}
export declare class PullRequestAttachmentPathError extends Error {
    name: string;
}
/** Shares pull-request behavior between CLI and operation transports, binding file access to launch cwd. */
export declare class DefaultPrOperations implements PrOperations {
    private readonly cwd;
    private readonly launchRoot;
    private readonly launchDevice;
    private readonly launchInode;
    private readonly getHost;
    constructor(props: z.input<typeof propsSchema>);
    operations(): OperationDescriptor[];
    private descriptor;
    private validateAttachments;
    private requireOriginalLaunchDirectory;
}
export {};
