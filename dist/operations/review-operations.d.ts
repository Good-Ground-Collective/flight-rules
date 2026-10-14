import { z } from "zod";
import { type ReviewPolicy } from "../code-review/review-policy.js";
import { type ReviewGitHubApi } from "../code-review/github-review-verifier.js";
import type { OperationDescriptor } from "./operation-registry.js";
export declare const ReviewOperationsLaunchPropsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
    trustedRef: z.ZodOptional<z.ZodString>;
    owners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    requireMapping: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type ReviewOperationsLaunchProps = z.input<typeof ReviewOperationsLaunchPropsSchema>;
declare const ReviewOperationsPropsSchema: z.ZodObject<{
    trustedRef: z.ZodOptional<z.ZodString>;
    owners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    requireMapping: z.ZodDefault<z.ZodBoolean>;
    cwd: z.ZodString;
    env: z.ZodOptional<z.ZodCustom<NodeJS.ProcessEnv, NodeJS.ProcessEnv>>;
    policy: z.ZodOptional<z.ZodCustom<ReviewPolicy, ReviewPolicy>>;
    api: z.ZodOptional<z.ZodCustom<ReviewGitHubApi, ReviewGitHubApi>>;
}, z.core.$strict>;
export interface ReviewOperations {
    operations(): OperationDescriptor[];
}
export declare class MissingTrustedReviewRefError extends Error {
    name: string;
}
/** Keeps the review lifecycle shared while pinning repository reads to the host's launch checkout. */
export declare class DefaultReviewOperations implements ReviewOperations {
    private readonly cwd;
    private readonly policy;
    private readonly api;
    private readonly trustedRef;
    private readonly owners;
    private readonly requireMapping;
    constructor(props: z.input<typeof ReviewOperationsPropsSchema>);
    operations(): OperationDescriptor[];
    private descriptor;
}
export {};
