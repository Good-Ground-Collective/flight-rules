import { z } from "zod";
import { type Charter } from "../bundled-docs/charter-catalog/charter-catalog.js";
declare const ReviewPolicyPropsSchema: z.ZodObject<{
    home: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodCustom<NodeJS.ProcessEnv, NodeJS.ProcessEnv>>;
}, z.core.$strict>;
declare const LoadPolicyPropsSchema: z.ZodObject<{
    paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
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
export interface LoadedReviewPolicy {
    method: string;
    /** The core charter followed by each selected language charter, as one document. */
    charter: string;
    /** The same charters, one entry per document. */
    charters: Pick<Charter, "id" | "language" | "appliesTo" | "tierA" | "contents">[];
    /** Every Tier A mandate the selected charters define, core first; a review accounts for each one. */
    tierA: string[];
    contract: string;
}
export interface ReviewPolicy {
    /**
     * With `paths`, selects the core charter plus the language charters governing those files;
     * without, every language charter, each scoped by its own `applies-to` globs.
     */
    load(input?: z.input<typeof LoadPolicyPropsSchema>): LoadedReviewPolicy;
    repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext;
}
/** Loads one review method for local skills and Actions, with repo rules read only from a pinned trusted commit. */
export declare class FileReviewPolicy implements ReviewPolicy {
    private readonly home;
    private readonly env;
    constructor(props?: z.input<typeof ReviewPolicyPropsSchema>);
    load(input?: z.input<typeof LoadPolicyPropsSchema>): LoadedReviewPolicy;
    repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext;
}
export declare class ReviewPolicyError extends Error {
    name: string;
}
export {};
