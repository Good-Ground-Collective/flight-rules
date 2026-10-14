import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import {
  HandoffRecordSchema,
  ImplementationReportSchema,
  ImplementationRunSchema,
  VerificationReportSchema,
  type CriterionResult,
  type HandoffRecord,
  type ImplementationRun,
  type VerificationReport,
} from "./implementation-loop.schema.js";
import type { DispatchRequest, OrchestrationFailure } from "./orchestration.schema.js";
import { ValidatedReportHandoff } from "./report-handoff.js";

export type StoppedImplementation = { status: "stopped"; failure: OrchestrationFailure };
export type ImplementationDecision =
  | { status: "implement"; request: DispatchRequest; filesChanged: string[] }
  | { status: "verified"; report: VerificationReport; filesChanged: string[] }
  | StoppedImplementation;
export type VerificationDecision =
  | { status: "verify"; request: DispatchRequest }
  | StoppedImplementation;

export interface ImplementationLoop {
  next(run: ImplementationRun): ImplementationDecision;
  verify(run: ImplementationRun, implementation: HandoffRecord): VerificationDecision;
}

/** Derives retries from paired, context-bound reports; worker failures never count as verifier FAILs. */
export class VerifiedImplementationLoop implements ImplementationLoop {
  private readonly reports = new ValidatedReportHandoff();

  next(run: ImplementationRun): ImplementationDecision {
    const parsed = ImplementationRunSchema.safeParse(run);
    if (!parsed.success) {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HISTORY",
          message: parsed.error.message,
          remedy:
            "Supply the original run context and at most three ordered implementation/verification receipts.",
        },
      };
    }
    const input = parsed.data;
    const filesChanged = new Set<string>();
    let failures: CriterionResult[] = [];

    for (const [index, round] of input.history.entries()) {
      const expected = this.implementationRequest(input, index + 1, failures);
      const implementation = this.readReport(
        expected,
        round.implementation,
        ImplementationReportSchema,
      );
      if (implementation.status === "stopped") return implementation;
      if (implementation.report.openQuestions?.length)
        return this.openQuestions(implementation.report.openQuestions);
      for (const file of implementation.report.filesChanged) filesChanged.add(file.path);

      const verification = this.readReport(
        this.verificationRequest(input, index + 1, [...filesChanged]),
        round.verification,
        VerificationReportSchema,
      );
      if (verification.status === "stopped") return verification;
      const report = verification.report;
      if (
        !isDeepStrictEqual(
          report.criteria.map((criterion) => criterion.criterion),
          input.criteria,
        )
      ) {
        return {
          status: "stopped",
          failure: {
            code: "INVALID_REPORT",
            message: "Verifier criteria do not match the original criteria in order and text.",
            remedy:
              "Have the verifier quote each original criterion exactly once, in its original order.",
          },
        };
      }

      const terminal =
        report.verified ||
        report.criteria.some((criterion) => criterion.verdict === "UNVERIFIABLE") ||
        Boolean(report.openQuestions?.length);
      if (terminal && index < input.history.length - 1) {
        return {
          status: "stopped",
          failure: {
            code: "INVALID_HISTORY",
            message: "History continues after a terminal verification result.",
            remedy:
              "Reconcile the stopped run before starting further work; do not reinterpret it as a retry.",
          },
        };
      }
      if (report.openQuestions?.length) return this.openQuestions(report.openQuestions);
      if (report.criteria.some((criterion) => criterion.verdict === "UNVERIFIABLE")) {
        return {
          status: "stopped",
          failure: {
            code: "UNVERIFIABLE",
            message: "At least one acceptance criterion could not be verified.",
            remedy:
              "Resolve the missing evidence or access described in the verifier report before starting a new run.",
          },
        };
      }
      if (report.verified) return { status: "verified", report, filesChanged: [...filesChanged] };
      failures = report.criteria.filter((criterion) => criterion.verdict === "FAIL");
    }

    if (input.history.length === 3) {
      return {
        status: "stopped",
        failure: {
          code: "ATTEMPTS_EXHAUSTED",
          message: "Three implementation attempts received verifier FAIL results.",
          remedy:
            "Return all remaining failed criteria to the caller for a decision; do not dispatch a fourth attempt.",
        },
      };
    }
    return {
      status: "implement",
      request: this.implementationRequest(input, input.history.length + 1, failures),
      filesChanged: [...filesChanged],
    };
  }

  verify(run: ImplementationRun, implementation: HandoffRecord): VerificationDecision {
    const decision = this.next(run);
    if (decision.status === "stopped") return decision;
    if (decision.status === "verified") {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HISTORY",
          message: "This run already passed verification.",
          remedy: "Use the verified result; start a separate run if the task or checkout changes.",
        },
      };
    }
    const receipt = HandoffRecordSchema.safeParse(implementation);
    if (!receipt.success) {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HANDOFF",
          message: receipt.error.message,
          remedy: "Supply the original implementation request and its structured outcome.",
        },
      };
    }
    const result = this.readReport(decision.request, receipt.data, ImplementationReportSchema);
    if (result.status === "stopped") return result;
    if (result.report.openQuestions?.length) return this.openQuestions(result.report.openQuestions);

    const filesChanged = [
      ...new Set([
        ...decision.filesChanged,
        ...result.report.filesChanged.map((file) => file.path),
      ]),
    ];
    return {
      status: "verify",
      request: this.verificationRequest(run, decision.request.context.attempt, filesChanged),
    };
  }

  private implementationRequest(
    run: ImplementationRun,
    attempt: number,
    failures: CriterionResult[],
  ): DispatchRequest {
    return {
      id: `${run.context.runId}:implementation:${attempt}`,
      agent: attempt === 3 ? "code-implementation-escalated" : "code-implementation",
      context: { ...run.context, attempt },
      input: {
        ...run.implementationInput,
        mode: "implement",
        criteria: [...run.criteria],
        ...(failures.length ? { verifierFailures: failures } : {}),
      },
    };
  }

  private verificationRequest(
    run: ImplementationRun,
    attempt: number,
    filesChanged: string[],
  ): DispatchRequest {
    return {
      id: `${run.context.runId}:verification:${attempt}`,
      agent: "code-verifier",
      context: { ...run.context, attempt },
      input: {
        mode: "verify",
        criteria: [...run.criteria],
        filesChanged: filesChanged.map((path) => ({ path })),
      },
    };
  }

  private readReport<T>(
    expected: DispatchRequest,
    record: HandoffRecord,
    schema: z.ZodType<T>,
  ): { status: "completed"; report: T } | StoppedImplementation {
    if (!isDeepStrictEqual(expected, record.request)) {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HISTORY",
          message: "Recorded dispatch differs from the request derived from this run.",
          remedy:
            "Preserve the original task, attempt, agent and input; do not substitute or enrich verifier requests.",
        },
      };
    }
    const handoff = this.reports.accept(expected, record.outcome, schema);
    if (handoff.status === "rejected") return { status: "stopped", failure: handoff.failure };
    if (handoff.outcome.status !== "completed")
      return { status: "stopped", failure: handoff.outcome.failure };
    return { status: "completed", report: handoff.outcome.report };
  }

  private openQuestions(questions: string[]): StoppedImplementation {
    return {
      status: "stopped",
      failure: {
        code: "OPEN_QUESTIONS",
        message: questions.join("\n"),
        remedy:
          "Return these questions to the caller. Use the question policy only when this invocation explicitly permits human questions.",
      },
    };
  }
}
