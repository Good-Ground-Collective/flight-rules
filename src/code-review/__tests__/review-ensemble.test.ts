import { describe, expect, it } from "vitest";
import { ReviewEnsemble } from "../review-ensemble.js";
import {
  EvidenceReviewPlanner,
  ValidatedReviewVerifier,
} from "../review-planner.js";
import { InvalidReviewError, reviewContract } from "../review-contract.js";
import {
  FindingRecordSchema,
  NewFindingSchema,
  ReviewSchema,
} from "../review.schema.js";
import type { Review } from "../review.schema.js";

const head = "a".repeat(40);
const fix = {
  path: "src/incidents.ts",
  line: 12,
  label: "issue",
  type: "fix",
  blocking: true,
  severity: "major",
  category: "security",
  subject: "Scope the query",
  discussion: "Records can cross tenants.",
  details: "Filter on tenantId and add the cross-tenant test.",
  resolved_when: "The query is scoped and the cross-tenant test passes.",
};
const decide = {
  ...fix,
  type: "decide",
  decision_owner: "platform",
  decision_options: [
    { id: "scope", description: "Scope the query" },
    { id: "accept", description: "Accept the risk" },
  ],
};
const note = {
  path: "src/incidents.ts",
  line: 12,
  label: "note",
  blocking: false,
  subject: "Helper reused",
  discussion: "The helper already covers this.",
};
const makeReview = (overrides: Record<string, unknown> = {}): Review =>
  ReviewSchema.parse({
    contract_version: 1,
    schema_revision: 1,
    head_sha: head,
    review_complete: true,
    summary: "Add incident lookup.",
    outcome: "APPROVED",
    outcome_reason: "No blockers remain.",
    remaining_risk: "No new risk.",
    findings: [],
    prior_findings: [],
    ...overrides,
  });
const lens = (
  findings: unknown[],
  overrides: Record<string, unknown> = {},
): Review => makeReview({ findings, outcome: "CHANGES_NEEDED", ...overrides });
const priorId = "f-0000000001";
const code = {
  kind: "code",
  commit_sha: head,
  path: "src/incidents.ts",
  line: 12,
};
const prior = (status: string, reason: string) => ({
  id: priorId,
  status,
  reason,
  evidence: [code],
  ...(status === "withdrawn" ? { withdrawal_basis: "incorrect" } : {}),
});

describe("merging lens findings", () => {
  it("merges identical findings from two lenses into one with a trace", () => {
    const { review, trace } = ReviewEnsemble.merge({
      lenses: [lens([fix]), lens([fix])],
      primary: 0,
    });
    const key = ReviewEnsemble.key(NewFindingSchema.parse(fix));
    expect(review.findings).toHaveLength(1);
    expect(trace).toEqual([
      { survivor: key, merged: [key], lens_indexes: [0, 1] },
    ]);
  });

  it("merges different categories when the subjects are similar", () => {
    const other = {
      ...fix,
      category: "data",
      subject: "Scope the query by tenant",
    };
    const { review } = ReviewEnsemble.merge({
      lenses: [lens([fix]), lens([other])],
      primary: 0,
    });
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]?.subject).toBe("Scope the query");
  });

  it("keeps findings on different paths, disjoint ranges and different kinds apart", () => {
    const elsewhere = { ...fix, path: "src/other.ts" };
    const far = { ...fix, line: 90, subject: "Unrelated wording" };
    const informational = {
      ...note,
      category: "security",
      subject: "Scope the query",
    };
    const { review, trace } = ReviewEnsemble.merge({
      lenses: [lens([fix]), lens([elsewhere, far, informational])],
      primary: 0,
    });
    expect(review.findings).toHaveLength(4);
    expect(trace).toEqual([]);
  });

  it("anchors line 0 only against line 0", () => {
    const file = { ...fix, line: 0 };
    const merged = ReviewEnsemble.merge({
      lenses: [lens([file]), lens([file])],
      primary: 0,
    });
    const mixed = ReviewEnsemble.merge({
      lenses: [lens([file]), lens([fix])],
      primary: 0,
    });
    expect(merged.review.findings).toHaveLength(1);
    expect(mixed.review.findings).toHaveLength(2);
  });

  it("raises severity and blocking to the highest across the group", () => {
    const low = {
      ...fix,
      severity: "minor",
      blocking: false,
      label: "suggestion",
    };
    const { review } = ReviewEnsemble.merge({
      lenses: [
        lens([low], { outcome: "APPROVED" }),
        lens([{ ...fix, severity: "critical" }]),
      ],
      primary: 0,
    });
    expect(review.findings[0]).toMatchObject({
      severity: "critical",
      blocking: true,
    });
    expect(review.outcome).toBe("CHANGES_NEEDED");
  });

  it("lets decide beat fix, and escalates only when a blocking decide survives", () => {
    const { review } = ReviewEnsemble.merge({
      lenses: [lens([fix]), lens([decide], { outcome: "ESCALATE" })],
      primary: 0,
    });
    expect(review.findings[0]).toMatchObject({
      type: "decide",
      decision_owner: "platform",
      path: "src/incidents.ts",
    });
    expect(review.outcome).toBe("ESCALATE");
  });

  it("lets fix beat clarify", () => {
    const clarify = { ...fix, type: "clarify" };
    const { review } = ReviewEnsemble.merge({
      lenses: [lens([clarify]), lens([fix])],
      primary: 0,
    });
    expect(review.findings[0]).toMatchObject({ type: "fix" });
  });

  it("approves when a primary escalation has no surviving blocker", () => {
    const { review } = ReviewEnsemble.merge({
      lenses: [lens([], { outcome: "ESCALATE" }), lens([])],
      primary: 0,
    });
    expect(review.outcome).toBe("APPROVED");
  });
});

describe("same-lens findings", () => {
  it("keeps two distinct same-category findings from one lens", () => {
    const second = { ...fix, subject: "Add the cross-tenant regression test" };
    const { review, trace } = ReviewEnsemble.merge({
      lenses: [lens([fix, second])],
      primary: 0,
    });
    expect(review.findings).toHaveLength(2);
    expect(trace).toEqual([]);
  });

  it("still merges cross-lens duplicates with distinct lens indexes", () => {
    const second = { ...fix, subject: "Add the cross-tenant regression test" };
    const { review, trace } = ReviewEnsemble.merge({
      lenses: [lens([fix, second]), lens([fix])],
      primary: 0,
    });
    expect(review.findings).toHaveLength(2);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.lens_indexes).toEqual([0, 1]);
  });
});

describe("merging review state", () => {
  it("takes prior findings from the primary but lets another lens keep a closed one open", () => {
    const { review } = ReviewEnsemble.merge({
      lenses: [
        makeReview({ prior_findings: [prior("resolved", "Fixed.")] }),
        makeReview({
          prior_findings: [prior("still_open", "Query is still unscoped.")],
        }),
      ],
      primary: 0,
    });
    expect(review.prior_findings).toHaveLength(1);
    expect(review.prior_findings[0]).toMatchObject({
      status: "still_open",
      reason: "Query is still unscoped.",
    });
  });

  it("marks the merge incomplete when any lens is incomplete and joins the reasons", () => {
    const { review } = ReviewEnsemble.merge({
      lenses: [
        lens([], {
          review_complete: false,
          incomplete_reason: "Could not read the schema.",
        }),
        lens([], { review_complete: false, incomplete_reason: "Timed out." }),
        lens([]),
      ],
      primary: 2,
    });
    expect(review).toMatchObject({
      review_complete: false,
      outcome: "INCOMPLETE",
      incomplete_reason: "Could not read the schema.; Timed out.",
    });
  });

  it("unions flight_rules coverage with the stricter state winning", () => {
    const extension = (overrides: Record<string, unknown>) => ({
      flight_rules: {
        charterCoverage: { charters: ["core"], mandates: [] },
        lint: { status: "ran", detail: "eslint" },
        counts: { tierA: 0, tierB: 0, holistic: 0 },
        ...overrides,
      },
    });
    const mandate = (id: string, state: string, files: string[]) => ({
      id,
      charter: "core",
      state,
      files,
    });
    const left = {
      ...extension({
        charterCoverage: {
          charters: ["core"],
          mandates: [
            mandate("M-1", "reviewed", ["a.ts"]),
            mandate("M-2", "waived", []),
          ],
        },
        coverage: {
          files: [
            { path: "a.ts", state: "skipped_generated", hunks_reviewed: 1 },
            { path: "b.ts", state: "reviewed", hunks_reviewed: 2 },
          ],
        },
      }),
      github_action: { grade: "low" },
    };
    const right = extension({
      charterCoverage: {
        charters: ["core", "typescript"],
        mandates: [
          mandate("M-1", "enforced", ["b.ts"]),
          mandate("M-3", "reviewed", ["b.ts"]),
        ],
      },
      lint: { status: "failed", detail: "other" },
      coverage: {
        files: [
          { path: "a.ts", state: "reviewed", hunks_reviewed: 4 },
          { path: "b.ts", state: "not_applicable" },
        ],
      },
    });
    const { review } = ReviewEnsemble.merge({
      lenses: [lens([], { extensions: left }), lens([], { extensions: right })],
      primary: 0,
    });
    expect(review.extensions).toEqual({
      github_action: { grade: "low" },
      flight_rules: {
        charterCoverage: {
          charters: ["core"],
          mandates: [
            mandate("M-1", "enforced", ["a.ts", "b.ts"]),
            mandate("M-2", "waived", []),
            mandate("M-3", "reviewed", ["b.ts"]),
          ],
        },
        lint: { status: "ran", detail: "eslint" },
        counts: { tierA: 0, tierB: 0, holistic: 0 },
        coverage: {
          files: [
            { path: "a.ts", state: "reviewed", hunks_reviewed: 4 },
            { path: "b.ts", state: "reviewed", hunks_reviewed: 2 },
          ],
        },
      },
    });
  });

  it("rejects lenses that reviewed different heads", () => {
    expect(() =>
      ReviewEnsemble.merge({
        lenses: [lens([]), lens([], { head_sha: "b".repeat(40) })],
        primary: 0,
      }),
    ).toThrow(InvalidReviewError);
  });

  it("rejects lenses with different contract versions or schema revisions", () => {
    const skewed = (overrides: Record<string, unknown>): Review => ({
      ...lens([]),
      ...overrides,
    });
    expect(() =>
      ReviewEnsemble.merge({
        lenses: [lens([]), skewed({ contract_version: 2 })],
        primary: 0,
      }),
    ).toThrow(InvalidReviewError);
    expect(() =>
      ReviewEnsemble.merge({
        lenses: [lens([]), skewed({ schema_revision: 2 })],
        primary: 0,
      }),
    ).toThrow(InvalidReviewError);
  });

  it("produces a review the planner accepts", async () => {
    const { review } = ReviewEnsemble.merge({
      lenses: [lens([fix, note]), lens([{ ...fix, severity: "critical" }])],
      primary: 0,
    });
    const record = FindingRecordSchema.parse({
      v: 1,
      schema_revision: 1,
      finding: { ...fix, id: priorId },
      status: "open",
      evidence: [],
    });
    const planner = new EvidenceReviewPlanner({
      verifier: new ValidatedReviewVerifier({
        verified: [],
        authorizedDecisions: [],
        dismissals: [],
      }),
    });
    const withPrior = ReviewEnsemble.merge({
      lenses: [
        lens([fix], { prior_findings: [{ ...prior("still_open", "Open.") }] }),
      ],
      primary: 0,
    }).review;
    expect(reviewContract.parse(review)).toEqual(review);
    const plan = await planner.plan({
      review: withPrior,
      records: [record],
      headSha: head,
    });
    expect(plan.problems).toEqual([]);
    expect(plan.outcome).toBe("CHANGES_NEEDED");
  });
});

describe("verifier verdicts", () => {
  const review = (): Review =>
    lens([fix, { ...fix, path: "src/b.ts", subject: "Other issue" }]);
  const keys = (): string[] =>
    review().findings.map((finding) => ReviewEnsemble.key(finding));

  it("derives a 16 hex key from path, range, line and subject", () => {
    expect(keys()[0]).toMatch(/^[a-f0-9]{16}$/);
    expect(keys()[0]).not.toBe(keys()[1]);
  });

  it("drops rejected findings and keeps those without a verdict", () => {
    const [first, second] = keys();
    const result = ReviewEnsemble.applyVerdicts(review(), [
      {
        key: first ?? "",
        verdict: "rejected",
        reason: "The query is already scoped.",
      },
      { key: second ?? "", verdict: "confirmed", reason: "" },
    ]);
    expect(result.review.findings.map((finding) => finding.path)).toEqual([
      "src/b.ts",
    ]);
    expect(result.dropped).toEqual([
      { key: first, reason: "The query is already scoped." },
    ]);
    expect(result.problems).toEqual([]);
    expect(
      ReviewEnsemble.applyVerdicts(review(), []).review.findings,
    ).toHaveLength(2);
  });

  it("reports unknown keys as problems and requires a reason to reject", () => {
    const result = ReviewEnsemble.applyVerdicts(review(), [
      { key: "0".repeat(16), verdict: "rejected", reason: "No such finding." },
    ]);
    expect(result.problems).toEqual([`unknown verdict key ${"0".repeat(16)}`]);
    expect(result.review.findings).toHaveLength(2);
    expect(() =>
      ReviewEnsemble.applyVerdicts(review(), [
        { key: keys()[0] ?? "", verdict: "rejected", reason: " " },
      ]),
    ).toThrow();
  });

  it("downgrades an escalation when its blocking decide is dropped", () => {
    const escalated = lens([decide], { outcome: "ESCALATE" });
    const result = ReviewEnsemble.applyVerdicts(escalated, [
      {
        key: ReviewEnsemble.key(NewFindingSchema.parse(decide)),
        verdict: "rejected",
        reason: "No decision is needed.",
      },
    ]);
    expect(result.review.findings).toEqual([]);
    expect(result.review.outcome).toBe("APPROVED");
  });

  it("lets the planner accept a review whose only blocker was rejected", async () => {
    const merged = ReviewEnsemble.merge({
      lenses: [lens([fix]), lens([], { outcome: "APPROVED" })],
      primary: 0,
    }).review;
    const result = ReviewEnsemble.applyVerdicts(merged, [
      {
        key: ReviewEnsemble.key(NewFindingSchema.parse(fix)),
        verdict: "rejected",
        reason: "False positive.",
      },
    ]);
    const planner = new EvidenceReviewPlanner({
      verifier: new ValidatedReviewVerifier({
        verified: [],
        authorizedDecisions: [],
        dismissals: [],
      }),
    });
    const plan = await planner.plan({
      review: result.review,
      records: [],
      headSha: head,
    });
    expect(plan.outcome).not.toBe("INCOMPLETE");
    expect(plan.problems).toEqual([]);
  });

  it("keeps CHANGES_NEEDED while one blocker remains after a partial rejection", () => {
    const other = { ...fix, path: "src/other.ts" };
    const merged = ReviewEnsemble.merge({
      lenses: [lens([fix, other])],
      primary: 0,
    }).review;
    const result = ReviewEnsemble.applyVerdicts(merged, [
      {
        key: ReviewEnsemble.key(NewFindingSchema.parse(fix)),
        verdict: "rejected",
        reason: "False positive.",
      },
    ]);
    expect(result.review.findings).toHaveLength(1);
    expect(result.review.outcome).toBe("CHANGES_NEEDED");
  });
});
