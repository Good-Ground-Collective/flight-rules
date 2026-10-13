import { z } from "zod";
import type { FindingRecord, Review, ReviewState } from "./review.schema.js";
export declare class InvalidReviewError extends Error {
    name: string;
}
export interface ReviewContract {
    parse(value: unknown): Review;
    record(value: unknown): FindingRecord;
    state(value: unknown): ReviewState;
    schemas(): {
        full: z.core.JSONSchema.BaseSchema;
        transport: z.core.JSONSchema.BaseSchema;
    };
}
/** Shared validation and normalization; transport schemas alone never authorize a transition. */
export declare class ZodReviewContract implements ReviewContract {
    parse(value: unknown): Review;
    record(value: unknown): FindingRecord;
    state(value: unknown): ReviewState;
    schemas(): {
        full: z.core.JSONSchema.BaseSchema;
        transport: z.core.JSONSchema.BaseSchema;
    };
    private normalize;
    private normalizeActionable;
    private checkRange;
    private checkOptions;
}
export declare const reviewContract: ReviewContract;
