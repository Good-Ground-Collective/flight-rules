import { z } from "zod";
import {
  ActionableFindingSchema,
  FindingRecordSchema,
  ReviewSchema,
  ReviewStateSchema,
  TransportReviewSchema,
} from "./review.schema.js";
import type {
  ActionableFinding,
  FindingRecord,
  NewFinding,
  Review,
  ReviewState,
} from "./review.schema.js";

export class InvalidReviewError extends Error {
  override name = "InvalidReviewError";
}

export interface ReviewContract {
  parse(value: unknown): Review;
  record(value: unknown): FindingRecord;
  state(value: unknown): ReviewState;
  schemas(): { full: z.core.JSONSchema.BaseSchema; transport: z.core.JSONSchema.BaseSchema };
}

/** Shared validation and normalization; transport schemas alone never authorize a transition. */
export class ZodReviewContract implements ReviewContract {
  parse(value: unknown): Review {
    const result = ReviewSchema.parse(value);
    const ids = result.prior_findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length)
      throw new InvalidReviewError("duplicate prior finding IDs");
    if (!result.review_complete && !result.incomplete_reason?.trim()) {
      throw new InvalidReviewError("an incomplete review must explain what could not be reviewed");
    }

    const findings = result.findings.map((finding) => this.normalize(finding));
    const priorFindings = result.prior_findings.map((transition) => {
      if (transition.status !== "still_open") return transition;
      if (
        (transition.decision !== undefined || transition.updated_finding !== undefined) &&
        !transition.evidence?.length
      ) {
        throw new InvalidReviewError(`transition ${transition.id} requires evidence`);
      }
      if (transition.updated_finding === undefined) return transition;
      if (transition.id !== transition.updated_finding.id)
        throw new InvalidReviewError("a replacement must preserve the finding ID");
      return {
        ...transition,
        updated_finding: this.normalizeActionable(transition.updated_finding),
      };
    });
    for (const transition of priorFindings) {
      if (
        transition.decision !== undefined &&
        !transition.evidence?.some(
          (evidence) =>
            evidence.kind === "github_comment" &&
            evidence.comment_id === transition.decision?.comment_id,
        )
      ) {
        throw new InvalidReviewError(
          `decision ${transition.id} must reference its human comment in evidence`,
        );
      }
    }
    return { ...result, findings, prior_findings: priorFindings };
  }

  record(value: unknown): FindingRecord {
    const result = FindingRecordSchema.parse(value);
    if (result.status !== "open" && result.evidence.length === 0)
      throw new InvalidReviewError("closed records require evidence");
    return { ...result, finding: this.normalizeActionable(result.finding) };
  }

  state(value: unknown): ReviewState {
    const result = ReviewStateSchema.parse(value);
    const ids = result.records.map((record) => record.id);
    if (new Set(ids).size !== ids.length)
      throw new InvalidReviewError("duplicate finding IDs in state");
    for (const record of result.records) {
      if (
        record.status === "informational" &&
        record.finding !== undefined &&
        record.id !== record.finding.id
      ) {
        throw new InvalidReviewError("informational index ID does not match its finding");
      }
    }
    return result;
  }

  schemas(): { full: z.core.JSONSchema.BaseSchema; transport: z.core.JSONSchema.BaseSchema } {
    return {
      full: z.toJSONSchema(ReviewSchema, { target: "draft-07" }),
      transport: z.toJSONSchema(TransportReviewSchema, { target: "draft-07" }),
    };
  }

  private normalize(finding: NewFinding): NewFinding {
    this.checkRange(finding);
    if (!("type" in finding)) return finding;
    if (finding.type === "decide") this.checkOptions(finding);
    const blocking =
      finding.blocking || finding.severity === "critical" || finding.severity === "major";
    const label =
      blocking && ["nitpick", "typo", "polish"].includes(finding.label) ? "issue" : finding.label;
    return { ...finding, blocking, label };
  }

  private normalizeActionable(finding: ActionableFinding): ActionableFinding {
    return ActionableFindingSchema.parse({ ...this.normalize(finding), id: finding.id });
  }

  private checkRange(finding: NewFinding): void {
    if (
      finding.start_line !== undefined &&
      (finding.line === 0 || finding.start_line > finding.line)
    ) {
      throw new InvalidReviewError("start_line must not exceed a positive line anchor");
    }
  }

  private checkOptions(finding: Extract<NewFinding, { type: "decide" }>): void {
    const ids = finding.decision_options.map((option) => option.id);
    if (new Set(ids).size !== ids.length)
      throw new InvalidReviewError("decision option IDs must be unique");
  }
}

export const reviewContract: ReviewContract = new ZodReviewContract();
