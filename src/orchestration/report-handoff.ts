import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import {
  DispatchOutcomeSchema,
  DispatchRequestSchema,
  type DispatchOutcome,
  type DispatchRequest,
  type OrchestrationFailure,
} from "./orchestration.schema.js";

export type ReportHandoffResult<T> =
  | { status: "accepted"; outcome: DispatchOutcome<T> }
  | { status: "rejected"; failure: OrchestrationFailure };

export interface ReportHandoff {
  accept<T>(
    request: DispatchRequest,
    outcome: unknown,
    reportSchema: z.ZodType<T>,
  ): ReportHandoffResult<T>;
}

/** Rejects stale or cross-task results before a caller can use a worker's role-specific report. */
export class ValidatedReportHandoff implements ReportHandoff {
  accept<T>(
    request: DispatchRequest,
    outcome: unknown,
    reportSchema: z.ZodType<T>,
  ): ReportHandoffResult<T> {
    const expected = DispatchRequestSchema.parse(request);
    const parsed = DispatchOutcomeSchema.safeParse(outcome);
    if (!parsed.success) {
      return {
        status: "rejected",
        failure: {
          code: "INVALID_HANDOFF",
          message: parsed.error.message,
          remedy:
            "Return a complete structured outcome with the original dispatch identity and caller context.",
        },
      };
    }
    const value = parsed.data;
    if (
      value.dispatchId !== expected.id ||
      value.agent !== expected.agent ||
      !isDeepStrictEqual(value.context, expected.context)
    ) {
      return {
        status: "rejected",
        failure: {
          code: "INVALID_HANDOFF",
          message: "The result does not belong to this dispatch, agent and caller context.",
          remedy:
            "Reconcile the original invocation; do not route another task or attempt's report into this run.",
        },
      };
    }
    if (value.status !== "completed") return { status: "accepted", outcome: value };

    const report = reportSchema.safeParse(value.report);
    if (!report.success) {
      return {
        status: "rejected",
        failure: {
          code: "INVALID_REPORT",
          message: report.error.message,
          remedy:
            "Obtain a report matching the requested role's schema; do not fabricate or infer a successful result.",
        },
      };
    }
    return { status: "accepted", outcome: { ...value, status: "completed", report: report.data } };
  }
}
