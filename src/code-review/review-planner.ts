import { randomBytes } from "node:crypto";
import { z } from "zod";
import { FindingRecordSchema, HeadShaSchema } from "./review.schema.js";
import { InvalidReviewError, reviewContract } from "./review-contract.js";
import type {
  ActionableFinding,
  DecisionAnswer,
  FindingRecord,
  Review,
  ReviewEvidence,
  ReviewOutcome,
  StoredFinding,
} from "./review.schema.js";

export interface ReviewVerifier {
  verify(evidence: ReviewEvidence, headSha: string): Promise<boolean>;
  authorize(answer: DecisionAnswer, finding: ActionableFinding): Promise<boolean>;
  dismissal(evidence: ReviewEvidence): Promise<boolean>;
}
export interface ReviewPlan {
  review: Review;
  records: FindingRecord[];
  informational: StoredFinding[];
  outcome: ReviewOutcome;
  problems: string[];
}
export interface ReviewPlannerProps {
  verifier: ReviewVerifier;
}
export interface ReviewPlanner {
  plan(input: { review: unknown; records: unknown[]; headSha: string }): Promise<ReviewPlan>;
}

/** Applies only evidence-checked transitions; caller adapters persist the plan before approving. */
export class EvidenceReviewPlanner implements ReviewPlanner {
  private readonly verifier: ReviewVerifier;

  constructor(props: ReviewPlannerProps) {
    this.verifier = props.verifier;
  }

  async plan(input: { review: unknown; records: unknown[]; headSha: string }): Promise<ReviewPlan> {
    const headSha = HeadShaSchema.parse(input.headSha);
    const review = reviewContract.parse(input.review);
    const records = input.records.map((record) => reviewContract.record(record));
    const known = new Map(records.map((record) => [record.finding.id, record]));
    if (known.size !== records.length) throw new InvalidReviewError("duplicate stored finding IDs");
    if (review.head_sha !== headSha)
      throw new InvalidReviewError("reviewed head is stale; rerun against the current PR head");
    for (const entry of review.prior_findings) {
      if (known.get(entry.id)?.status !== "open")
        throw new InvalidReviewError(`unknown or closed prior finding: ${entry.id}`);
    }

    const problems: string[] = [];
    const updates = new Map(review.prior_findings.map((entry) => [entry.id, entry]));
    const retained: FindingRecord[] = [];
    for (const record of records) {
      if (record.status !== "open") {
        retained.push(record);
        continue;
      }
      const entry = updates.get(record.finding.id);
      if (entry === undefined) {
        problems.push(`omitted open finding ${record.finding.id}`);
        retained.push(record);
        continue;
      }
      const evidence = entry.evidence ?? [];
      let valid = true;
      for (const reference of evidence) {
        try {
          if (!(await this.verifier.verify(reference, headSha))) valid = false;
        } catch {
          valid = false;
        }
      }
      const changed =
        entry.status !== "still_open" ||
        entry.updated_finding !== undefined ||
        entry.decision !== undefined;
      if (!valid && changed) {
        problems.push(`evidence could not be validated for ${entry.id}`);
        retained.push(record);
        continue;
      }

      let authorized = false;
      if (entry.decision !== undefined) {
        try {
          authorized = await this.verifier.authorize(entry.decision, record.finding);
        } catch {
          authorized = false;
        }
        if (!authorized) {
          problems.push(`decision authorization was not verified for ${entry.id}`);
          retained.push(record);
          continue;
        }
      }
      if (entry.status === "withdrawn" && entry.withdrawal_basis === "dismissed") {
        let dismissed = false;
        for (const reference of evidence) {
          try {
            if (await this.verifier.dismissal(reference)) dismissed = true;
          } catch {
            continue;
          }
        }
        if (record.finding.blocking || record.finding.type === "decide" || !dismissed) {
          problems.push(`manual dismissal cannot close ${entry.id}`);
          retained.push(record);
          continue;
        }
      }
      const withdrawal = entry.status === "withdrawn" && entry.withdrawal_basis !== "dismissed";
      const decisionChanged = record.finding.type === "decide" && changed;
      if (decisionChanged && !authorized && !withdrawal) {
        problems.push(`decision ${entry.id} still needs an authorized human answer`);
        retained.push(record);
        continue;
      }
      const finding =
        entry.status === "still_open" && entry.updated_finding !== undefined
          ? entry.updated_finding
          : record.finding;
      retained.push(
        FindingRecordSchema.parse({
          ...record,
          finding,
          status: entry.status === "still_open" ? "open" : entry.status,
          evidence: changed ? evidence : record.evidence,
          ...(entry.decision !== undefined ? { decision: entry.decision } : {}),
        }),
      );
    }

    const ids = new Set(known.keys());
    const informational: StoredFinding[] = [];
    for (const finding of review.findings) {
      const id = this.newId(ids);
      if (!("type" in finding)) {
        informational.push({ ...finding, id });
        continue;
      }
      retained.push(
        FindingRecordSchema.parse({
          v: 1,
          schema_revision: 1,
          finding: { ...finding, id },
          status: "open",
          evidence: [],
        }),
      );
    }
    const outcome = this.outcome(review, retained, problems);
    return { review, records: retained, informational, outcome, problems };
  }

  private newId(ids: Set<string>): string {
    let id = `f-${randomBytes(5).toString("hex")}`;
    while (ids.has(id)) id = `f-${randomBytes(5).toString("hex")}`;
    ids.add(id);
    return id;
  }

  private outcome(review: Review, records: FindingRecord[], problems: string[]): ReviewOutcome {
    if (!review.review_complete || problems.length > 0 || review.outcome === "INCOMPLETE")
      return "INCOMPLETE";
    const blockers = records.filter(
      (record) => record.status === "open" && record.finding.blocking,
    );
    if (blockers.some((record) => record.finding.type === "decide")) return "ESCALATE";
    if (review.outcome === "ESCALATE") {
      problems.push("claimed escalation has no matching open blocking decision");
      return "INCOMPLETE";
    }
    if (blockers.length > 0) return "CHANGES_NEEDED";
    if (review.outcome !== "APPROVED") {
      problems.push("claimed outcome has no matching open blocking finding");
      return "INCOMPLETE";
    }
    return "APPROVED";
  }
}

const ValidatedEvidencePropsSchema = z.strictObject({
  verified: z.array(z.string()),
  authorizedDecisions: z.array(z.string()),
  dismissals: z.array(z.string()),
});
export type ValidatedEvidenceProps = z.infer<typeof ValidatedEvidencePropsSchema>;

/** Adapter-supplied attestations are trusted input, gathered before the model run, never model output. */
export class ValidatedReviewVerifier implements ReviewVerifier {
  private readonly props: ValidatedEvidenceProps;

  constructor(props: ValidatedEvidenceProps) {
    this.props = ValidatedEvidencePropsSchema.parse(props);
  }

  async verify(evidence: ReviewEvidence): Promise<boolean> {
    return evidence.kind === "document" || this.props.verified.includes(JSON.stringify(evidence));
  }

  async authorize(answer: DecisionAnswer, finding: ActionableFinding): Promise<boolean> {
    if (
      finding.type !== "decide" ||
      !finding.decision_options.some((option) => option.id === answer.option_id)
    )
      return false;
    return this.props.authorizedDecisions.includes(`${finding.id}:${JSON.stringify(answer)}`);
  }

  async dismissal(evidence: ReviewEvidence): Promise<boolean> {
    return (
      evidence.kind === "thread_resolution" &&
      this.props.dismissals.includes(JSON.stringify(evidence))
    );
  }
}
