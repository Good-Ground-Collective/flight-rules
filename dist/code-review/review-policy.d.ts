import { z } from "zod";
declare const ReviewPolicyPropsSchema: z.ZodObject<{
    home: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
declare const RepositoryContextPropsSchema: z.ZodObject<{
    cwd: z.ZodString;
    trustedRef: z.ZodString;
    contextPath: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export interface RepositoryReviewContext {
    trustedRef: string;
    contextPath: string;
    sources: {
        path: string;
        contents: string;
    }[];
    missing: string[];
}
export interface ReviewPolicy {
    load(): {
        method: string;
        charter: string;
        contract: string;
    };
    repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext;
}
/** Loads one review method for local skills and Actions, with repo rules read only from a pinned trusted commit. */
export declare class FileReviewPolicy implements ReviewPolicy {
    private readonly home;
    constructor(props?: z.input<typeof ReviewPolicyPropsSchema>);
    load(): {
        method: string;
        charter: string;
        contract: string;
    };
    repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext;
}
export declare class ReviewPolicyError extends Error {
    name: string;
}
export {};
