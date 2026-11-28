import { createHash } from "node:crypto";
import { z } from "zod";
import { NewFindingSchema } from "./review.schema.js";
import { FlightRulesExtensionSchema } from "./flight-rules-extensions.js";
import type {
  FileCoverage,
  FlightRulesExtension,
  MandateCoverage,
} from "./flight-rules-extensions.js";
import { InvalidReviewError, reviewContract } from "./review-contract.js";
import type {
  NewFinding,
  PriorFinding,
  Review,
  ReviewOutcome,
} from "./review.schema.js";

export const VerdictSchema = z
  .strictObject({
    key: z.string().regex(/^[a-f0-9]{16}$/),
    verdict: z.enum(["confirmed", "rejected"]),
    reason: z.string(),
  })
  .refine(
    (value) => value.verdict !== "rejected" || value.reason.trim().length > 0,
    {
      message: "a rejected verdict requires a reason",
      path: ["reason"],
    },
  );

export type Verdict = z.infer<typeof VerdictSchema>;

export interface MergeTrace {
  survivor: string;
  merged: string[];
  lens_indexes: number[];
}

export interface EnsembleMerge {
  review: Review;
  trace: MergeTrace[];
}

export interface VerdictApplication {
  review: Review;
  dropped: { key: string; reason: string }[];
  problems: string[];
}

type ActionFinding = Extract<
  NewFinding,
  { type: "fix" | "clarify" | "decide" }
>;
type DecisionFinding = Extract<NewFinding, { type: "decide" }>;
interface Member {
  finding: NewFinding;
  lens: number;
}

const mandateStrictness = {
  not_applicable: 0,
  waived: 1,
  reviewed: 2,
  enforced: 3,
};
const fileStrictness = {
  not_applicable: 0,
  skipped_generated: 1,
  skipped_binary: 1,
  reviewed: 2,
};
const severityRank = { trivial: 0, minor: 1, major: 2, critical: 3 };
const typeRank = { clarify: 1, fix: 2, decide: 3 };
const similarityThreshold = 0.5;

/**
 * Merges independent lens passes over one head into a single candidate review, then lets a
 * verifier veto findings. Duplicate detection is rule-based so the same lenses always merge the
 * same way; the verifier can only drop findings, never add or alter them.
 */
export class ReviewEnsemble {
  static key(finding: NewFinding): string {
    const text = [
      finding.path,
      finding.start_line ?? "",
      finding.line,
      finding.subject,
    ].join("|");
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  static merge(input: { lenses: Review[]; primary: number }): EnsembleMerge {
    const { primary } = input;
    ReviewEnsemble.checkLenses(input.lenses, primary);
    const lenses = input.lenses.map((lens) => reviewContract.parse(lens));
    const lead = lenses[primary];
    if (lead === undefined)
      throw new InvalidReviewError("primary lens index is out of range");

    const groups = ReviewEnsemble.group(lenses);
    const trace: MergeTrace[] = [];
    const findings: NewFinding[] = [];
    for (const members of groups) {
      findings.push(ReviewEnsemble.combine(members));
      const survivor = members[0];
      if (members.length > 1 && survivor !== undefined) {
        trace.push({
          survivor: ReviewEnsemble.key(survivor.finding),
          merged: members
            .slice(1)
            .map((member) => ReviewEnsemble.key(member.finding)),
          lens_indexes: [...new Set(members.map((member) => member.lens))],
        });
      }
    }

    const incomplete = lenses.filter((lens) => !lens.review_complete);
    const reasons = incomplete
      .map((lens) => lens.incomplete_reason?.trim() ?? "")
      .filter((reason) => reason.length > 0);
    const extensions = ReviewEnsemble.extensions(lenses, primary);
    const draft = {
      contract_version: lead.contract_version,
      schema_revision: lead.schema_revision,
      head_sha: lead.head_sha,
      summary: lead.summary,
      outcome: lead.outcome,
      outcome_reason: lead.outcome_reason,
      remaining_risk: lead.remaining_risk,
      review_complete: incomplete.length === 0,
      ...(incomplete.length === 0
        ? {}
        : { incomplete_reason: [...new Set(reasons)].join("; ") }),
      findings,
      prior_findings: ReviewEnsemble.priorFindings(lenses, primary),
      ...(extensions === undefined ? {} : { extensions }),
    };

    const normalized = reviewContract.parse(draft);
    const outcome = ReviewEnsemble.outcome(normalized, lead.outcome);
    return { review: reviewContract.parse({ ...normalized, outcome }), trace };
  }

  static applyVerdicts(
    review: Review,
    verdicts: Verdict[],
  ): VerdictApplication {
    const parsed = reviewContract.parse(review);
    const checked = z.array(VerdictSchema).parse(verdicts);
    const problems: string[] = [];
    const byKey = new Map<string, Verdict>();
    for (const verdict of checked) {
      if (byKey.has(verdict.key))
        problems.push(`duplicate verdict for key ${verdict.key}`);
      else byKey.set(verdict.key, verdict);
    }

    const known = new Set(
      parsed.findings.map((finding) => ReviewEnsemble.key(finding)),
    );
    for (const key of byKey.keys()) {
      if (!known.has(key)) problems.push(`unknown verdict key ${key}`);
    }

    const dropped: { key: string; reason: string }[] = [];
    const kept = parsed.findings.filter((finding) => {
      const key = ReviewEnsemble.key(finding);
      const verdict = byKey.get(key);
      if (verdict?.verdict !== "rejected") return true;
      dropped.push({ key, reason: verdict.reason });
      return false;
    });
    if (dropped.length === 0) return { review: parsed, dropped, problems };

    const filtered = { ...parsed, findings: kept };
    const outcome = ReviewEnsemble.outcome(
      reviewContract.parse(filtered),
      parsed.outcome,
    );
    return {
      review: reviewContract.parse({ ...filtered, outcome }),
      dropped,
      problems,
    };
  }

  private static checkLenses(lenses: Review[], primary: number): void {
    const first = lenses[0];
    if (first === undefined)
      throw new InvalidReviewError("an ensemble needs at least one lens");
    if (!Number.isInteger(primary) || primary < 0 || primary >= lenses.length) {
      throw new InvalidReviewError("primary lens index is out of range");
    }
    for (const lens of lenses) {
      if (lens.head_sha !== first.head_sha) {
        throw new InvalidReviewError("lenses reviewed different heads");
      }
      if (lens.contract_version !== first.contract_version) {
        throw new InvalidReviewError("lenses use different contract versions");
      }
      if (lens.schema_revision !== first.schema_revision) {
        throw new InvalidReviewError("lenses use different schema revisions");
      }
    }
  }

  private static group(lenses: Review[]): Member[][] {
    const groups: Member[][] = [];
    lenses.forEach((lens, index) => {
      for (const finding of lens.findings) {
        const home = groups.find((members) => {
          const survivor = members[0];
          return (
            survivor !== undefined &&
            members.every((member) => member.lens !== index) &&
            ReviewEnsemble.sameIssue(survivor.finding, finding)
          );
        });
        if (home === undefined) groups.push([{ finding, lens: index }]);
        else home.push({ finding, lens: index });
      }
    });
    return groups;
  }

  private static sameIssue(left: NewFinding, right: NewFinding): boolean {
    if (left.path !== right.path) return false;
    if ("type" in left !== "type" in right) return false;
    if (!ReviewEnsemble.overlaps(left, right)) return false;
    if (left.category !== undefined && left.category === right.category)
      return true;
    return (
      ReviewEnsemble.similarity(left.subject, right.subject) >=
      similarityThreshold
    );
  }

  private static overlaps(left: NewFinding, right: NewFinding): boolean {
    if (left.line === 0 || right.line === 0) return left.line === right.line;
    const leftStart = left.start_line ?? left.line;
    const rightStart = right.start_line ?? right.line;
    return leftStart <= right.line && rightStart <= left.line;
  }

  private static similarity(left: string, right: string): number {
    const leftTokens = new Set(left.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const rightTokens = new Set(right.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const shared = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    ).length;
    const union = leftTokens.size + rightTokens.size - shared;
    return union === 0 ? 0 : shared / union;
  }

  private static combine(members: Member[]): NewFinding {
    const survivor = members[0]?.finding;
    if (survivor === undefined)
      throw new InvalidReviewError("cannot combine an empty group");
    if (!("type" in survivor)) return survivor;

    const actions = members
      .map((member) => member.finding)
      .filter((finding): finding is ActionFinding => "type" in finding);
    let winner = survivor.type;
    let severity = survivor.severity;
    for (const action of actions) {
      if (typeRank[action.type] > typeRank[winner]) winner = action.type;
      if (severityRank[action.severity] > severityRank[severity])
        severity = action.severity;
    }

    const merged = {
      ...survivor,
      type: winner,
      severity,
      blocking: actions.some((action) => action.blocking),
    };
    if (winner !== "decide" || survivor.type === "decide")
      return NewFindingSchema.parse(merged);

    const decision = actions.find(
      (action): action is DecisionFinding => action.type === "decide",
    );
    return NewFindingSchema.parse({
      ...merged,
      decision_owner: decision?.decision_owner,
      decision_options: decision?.decision_options,
    });
  }

  private static priorFindings(
    lenses: Review[],
    primary: number,
  ): PriorFinding[] {
    const lead = lenses[primary];
    if (lead === undefined) return [];
    return lead.prior_findings.map((entry) => {
      if (entry.status === "still_open") return entry;
      for (const [index, lens] of lenses.entries()) {
        if (index === primary) continue;
        const veto = lens.prior_findings.find(
          (other) => other.id === entry.id && other.status === "still_open",
        );
        if (veto !== undefined) return veto;
      }
      return entry;
    });
  }

  private static extensions(
    lenses: Review[],
    primary: number,
  ): Record<string, unknown> | undefined {
    const own = lenses[primary]?.extensions;
    if (own?.["flight_rules"] === undefined) return own;

    const extensions = lenses.flatMap((lens) => {
      const raw = lens.extensions?.["flight_rules"];
      return raw === undefined ? [] : [FlightRulesExtensionSchema.parse(raw)];
    });
    const lead = FlightRulesExtensionSchema.parse(own["flight_rules"]);
    const files = ReviewEnsemble.unionFiles(extensions);
    const merged: FlightRulesExtension = {
      ...lead,
      charterCoverage: {
        ...lead.charterCoverage,
        mandates: ReviewEnsemble.unionMandates(extensions),
      },
      ...(files === undefined ? {} : { coverage: { files } }),
    };
    return { ...own, flight_rules: merged };
  }

  private static unionMandates(
    extensions: FlightRulesExtension[],
  ): MandateCoverage[] {
    const union = new Map<string, MandateCoverage>();
    for (const mandate of extensions.flatMap(
      (entry) => entry.charterCoverage.mandates,
    )) {
      const current = union.get(mandate.id);
      if (current === undefined) {
        union.set(mandate.id, mandate);
        continue;
      }
      const files = [...new Set([...current.files, ...mandate.files])];
      const winner =
        mandateStrictness[mandate.state] > mandateStrictness[current.state]
          ? mandate
          : current;
      union.set(mandate.id, { ...winner, files });
    }
    return [...union.values()];
  }

  private static unionFiles(
    extensions: FlightRulesExtension[],
  ): FileCoverage[] | undefined {
    const lists = extensions.flatMap((entry) =>
      entry.coverage ? [entry.coverage.files] : [],
    );
    if (lists.length === 0) return undefined;

    const union = new Map<string, FileCoverage>();
    for (const file of lists.flat()) {
      const current = union.get(file.path);
      if (current === undefined) {
        union.set(file.path, file);
        continue;
      }
      const winner =
        fileStrictness[file.state] > fileStrictness[current.state]
          ? file
          : current;
      const hunks = [current.hunks_reviewed, file.hunks_reviewed].filter(
        (count): count is number => count !== undefined,
      );
      union.set(file.path, {
        ...winner,
        ...(hunks.length === 0 ? {} : { hunks_reviewed: Math.max(...hunks) }),
      });
    }
    return [...union.values()];
  }

  private static outcome(
    review: Review,
    claimed: ReviewOutcome,
  ): ReviewOutcome {
    if (!review.review_complete) return "INCOMPLETE";
    const blockers = review.findings.filter((finding) => finding.blocking);
    if (
      blockers.some((finding) => "type" in finding && finding.type === "decide")
    ) {
      return "ESCALATE";
    }
    if (blockers.length > 0) return "CHANGES_NEEDED";
    return claimed === "CHANGES_NEEDED" || claimed === "ESCALATE"
      ? "APPROVED"
      : claimed;
  }
}
