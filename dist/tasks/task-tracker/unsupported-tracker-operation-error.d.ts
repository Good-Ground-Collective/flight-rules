import { z } from 'zod';
declare const UnsupportedTrackerOperationPropsSchema: z.ZodObject<{
    tracker: z.ZodString;
    operation: z.ZodString;
    remedy: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UnsupportedTrackerOperationProps = z.infer<typeof UnsupportedTrackerOperationPropsSchema>;
/**
 * Thrown when a tracker backend has no answer for part of the TaskTracker
 * contract, so a caller can tell "this tracker will never do this" from an
 * API failure worth retrying.
 */
export declare class UnsupportedTrackerOperationError extends Error {
    readonly tracker: string;
    readonly operation: string;
    constructor(props: UnsupportedTrackerOperationProps);
}
export {};
