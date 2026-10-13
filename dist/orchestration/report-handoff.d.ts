import type { z } from "zod";
import { type DispatchOutcome, type DispatchRequest, type OrchestrationFailure } from "./orchestration.schema.js";
export type ReportHandoffResult<T> = {
    status: "accepted";
    outcome: DispatchOutcome<T>;
} | {
    status: "rejected";
    failure: OrchestrationFailure;
};
export interface ReportHandoff {
    accept<T>(request: DispatchRequest, outcome: unknown, reportSchema: z.ZodType<T>): ReportHandoffResult<T>;
}
/** Rejects stale or cross-task results before a caller can use a worker's role-specific report. */
export declare class ValidatedReportHandoff implements ReportHandoff {
    accept<T>(request: DispatchRequest, outcome: unknown, reportSchema: z.ZodType<T>): ReportHandoffResult<T>;
}
