import { describe, expect, it } from "vitest";
import { EvidenceReviewPlanner, ValidatedReviewVerifier } from "../review-planner.js";
import { ZodReviewContract } from "../review-contract.js";
import { JsonReviewCodec } from "../review-codec.js";
import { ReviewSchema, FindingRecordSchema } from "../review.schema.js";
import type { FindingRecord, Review, ReviewEvidence } from "../review.schema.js";

const head = "a".repeat(40);
const finding = {
  path: "src/incidents.ts",
  line: 12,
  label: "issue",
  type: "fix",
  blocking: true,
  severity: "major",
  subject: "Scope the query",
  discussion: "Records can cross tenants.",
  details: "Filter on tenantId and add the cross-tenant test.",
  resolved_when: "The query is scoped and the cross-tenant test passes.",
};
const makeReview = (overrides: Partial<Review> = {}): Review =>
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
const record = (overrides = {}): FindingRecord =>
  FindingRecordSchema.parse({
    v: 1,
    schema_revision: 1,
    finding: { ...finding, id: "f-0000000001", ...overrides },
    status: "open",
    evidence: [],
  });
const code: ReviewEvidence = { kind: "code", commit_sha: head, path: "src/incidents.ts", line: 12 };
const contract = new ZodReviewContract();
const codec = new JsonReviewCodec();
const planner = (
  verified: ReviewEvidence[] = [],
  authorizedDecisions: string[] = [],
  dismissals: ReviewEvidence[] = [],
) =>
  new EvidenceReviewPlanner({
    verifier: new ValidatedReviewVerifier({
      verified: verified.map((e) => JSON.stringify(e)),
      authorizedDecisions,
      dismissals: dismissals.map((e) => JSON.stringify(e)),
    }),
  });

describe("versioned review contract", () => {
  it("rejects unknown fields and unsupported revisions instead of silently dropping them", () => {
    expect(() => contract.parse({ ...makeReview(), human_decisions: [] })).toThrow();
    expect(() => contract.parse({ ...makeReview(), schema_revision: 2 })).toThrow();
  });
  it("distinguishes informational observations from actionable findings", () => {
    const info = {
      path: "",
      line: 0,
      label: "note",
      blocking: false,
      subject: "Existing helper reused",
      discussion: "The helper already handles this case.",
    };
    expect(contract.parse({ ...makeReview(), findings: [info] }).findings[0]).not.toHaveProperty(
      "type",
    );
    expect(() =>
      contract.parse({ ...makeReview(), findings: [{ ...info, severity: "critical" }] }),
    ).toThrow();
    expect(() =>
      contract.parse({ ...makeReview(), findings: [{ ...info, blocking: true }] }),
    ).toThrow();
  });
  it("normalizes severe findings before allowing preference labels", () => {
    const parsed = contract.parse({
      ...makeReview(),
      findings: [{ ...finding, label: "nitpick", blocking: false }],
    });
    expect(parsed.findings[0]).toMatchObject({ label: "issue", blocking: true });
  });
  it("rejects assigned IDs on new findings and incomplete replacement briefs", () => {
    expect(() =>
      contract.parse({ ...makeReview(), findings: [{ ...finding, id: "f-0000000001" }] }),
    ).toThrow();
    expect(() =>
      contract.parse({
        ...makeReview(),
        prior_findings: [
          {
            id: "f-0000000001",
            status: "still_open",
            reason: "Needs a fix.",
            updated_finding: { id: "f-0000000001", type: "fix" },
          },
        ],
      }),
    ).toThrow();
  });
  it("requires a positive range and rejects traversal paths", () => {
    expect(() =>
      contract.parse({ ...makeReview(), findings: [{ ...finding, start_line: 13 }] }),
    ).toThrow();
    for (const path of ["../secrets", "/tmp/file", "src/../file", "src\\file"]) {
      expect(() => contract.parse({ ...makeReview(), findings: [{ ...finding, path }] })).toThrow();
    }
  });
  it("requires evidence for closure and an explanation for incomplete reviews", () => {
    expect(() =>
      contract.parse({
        ...makeReview(),
        prior_findings: [
          { id: "f-0000000001", status: "resolved", reason: "Fixed.", evidence: [] },
        ],
      }),
    ).toThrow();
    expect(() => contract.parse({ ...makeReview(), review_complete: false })).toThrow();
  });
});

describe("iterative lifecycle", () => {
  it("keeps an omitted body or inline blocker open and marks the pass incomplete", async () => {
    const result = await planner().plan({
      review: makeReview(),
      records: [record()],
      headSha: head,
    });
    expect(result.outcome).toBe("INCOMPLETE");
    expect(result.records[0]?.status).toBe("open");
  });
  it("rejects unknown IDs and stale heads before planning any changes", async () => {
    await expect(
      planner().plan({
        review: makeReview({ head_sha: "b".repeat(40) }),
        records: [],
        headSha: head,
      }),
    ).rejects.toThrow("stale");
    await expect(
      planner().plan({
        review: makeReview({
          prior_findings: [{ id: "f-0000000002", status: "still_open", reason: "Still wrong." }],
        }),
        records: [record()],
        headSha: head,
      }),
    ).rejects.toThrow("unknown");
  });
  it("resolves a verified fix but retains one with unsupported evidence", async () => {
    const review = makeReview({
      prior_findings: [
        {
          id: "f-0000000001",
          status: "resolved",
          reason: "Scoped at this head.",
          evidence: [code],
        },
      ],
    });
    expect(
      (await planner([code]).plan({ review, records: [record()], headSha: head })).outcome,
    ).toBe("APPROVED");
    const failed = await planner().plan({ review, records: [record()], headSha: head });
    expect(failed.outcome).toBe("INCOMPLETE");
    expect(failed.records[0]?.status).toBe("open");
  });
  it("does not turn every design improvement into human escalation", async () => {
    const result = await planner().plan({
      review: makeReview({
        findings: [
          { ...finding, type: "fix", blocking: false, severity: "trivial", label: "suggestion" },
        ],
      }),
      records: [],
      headSha: head,
    });
    expect(result.outcome).toBe("APPROVED");
    expect(result.records[0]?.finding.id).toMatch(/^f-[a-f0-9]{10}$/);
  });
  it("requires authorization for decision retyping and preserves the ID until implementation is verified", async () => {
    const original = record({
      type: "decide",
      decision_owner: "policy owner",
      decision_options: [
        { id: "approve", description: "Allow access." },
        { id: "decline", description: "Keep read-only." },
      ],
    });
    const decision = { comment_id: 10, author_id: 20, option_id: "decline" };
    const comment: ReviewEvidence = {
      kind: "github_comment",
      comment_id: 10,
      url: "https://github.com/owner/repo/pull/1#issuecomment-10",
    };
    const review = makeReview({
      outcome: "CHANGES_NEEDED",
      prior_findings: [
        {
          id: original.finding.id,
          status: "still_open",
          reason: "Policy owner declined; remove writes.",
          evidence: [comment],
          decision,
          updated_finding: record().finding,
        },
      ],
    });
    const unauthorized = await planner([comment]).plan({
      review,
      records: [original],
      headSha: head,
    });
    expect(unauthorized.records[0]?.finding.type).toBe("decide");
    const approved = await planner(
      [comment],
      [`${original.finding.id}:${JSON.stringify(decision)}`],
    ).plan({ review, records: [original], headSha: head });
    expect(approved.outcome).toBe("CHANGES_NEEDED");
    expect(approved.records[0]).toMatchObject({
      status: "open",
      finding: { id: original.finding.id, type: "fix" },
      decision,
    });
  });
  it("prevents decision withdrawal by manual dismissal but permits evidence-backed mistakes", async () => {
    const original = record({
      type: "decide",
      decision_owner: "owner",
      decision_options: [
        { id: "yes", description: "Permit." },
        { id: "no", description: "Decline." },
      ],
    });
    const event: ReviewEvidence = { kind: "thread_resolution", thread_id: "thread", author_id: 20 };
    const dismissed = makeReview({
      prior_findings: [
        {
          id: original.finding.id,
          status: "withdrawn",
          reason: "Someone resolved the thread.",
          evidence: [event],
          withdrawal_basis: "dismissed",
        },
      ],
    });
    expect(
      (
        await planner([event], [], [event]).plan({
          review: dismissed,
          records: [original],
          headSha: head,
        })
      ).records[0]?.status,
    ).toBe("open");
    const removed = makeReview({
      prior_findings: [
        {
          id: original.finding.id,
          status: "withdrawn",
          reason: "The permission expansion was removed.",
          evidence: [code],
          withdrawal_basis: "no_longer_applicable",
        },
      ],
    });
    expect(
      (await planner([code]).plan({ review: removed, records: [original], headSha: head })).outcome,
    ).toBe("APPROVED");
  });
  it("keeps information out of the open lifecycle and cannot escalate without a named decision", async () => {
    const info = {
      path: "",
      line: 0,
      label: "praise",
      blocking: false,
      subject: "Good isolation",
      discussion: "The boundary is well covered.",
    };
    const result = await planner().plan({
      review: { ...makeReview(), findings: [info] },
      records: [],
      headSha: head,
    });
    expect(result.records).toEqual([]);
    expect(result.informational).toHaveLength(1);
    expect(
      (
        await planner().plan({
          review: makeReview({ outcome: "ESCALATE" }),
          records: [],
          headSha: head,
        })
      ).outcome,
    ).toBe("INCOMPLETE");
  });
});

describe("portable record markers", () => {
  it("round-trips complete body findings without parsing the headline", () => {
    const original = record({ details: "Do not truncate --> or <script>." });
    const rendered = codec.render(original);
    expect(rendered).toContain("issue (blocking, fix)");
    expect(codec.finding(original)).toContain("\\u003e");
    expect(codec.readFindings({ body: rendered, authorId: 10, trustedAuthorIds: [10] })).toEqual([
      original,
    ]);
    expect(codec.readFindings({ body: rendered, authorId: 20, trustedAuthorIds: [10] })).toEqual(
      [],
    );
  });
  it("fails closed on malformed or unsupported trusted markers", () => {
    expect(() =>
      codec.readFindings({
        body: "<!-- code-review:finding broken -->",
        authorId: 10,
        trustedAuthorIds: [10],
      }),
    ).toThrow();
    expect(() =>
      codec.readState({
        body: '<!-- code-review:state {"v":2} -->',
        authorId: 10,
        trustedAuthorIds: [10],
      }),
    ).toThrow();
  });
});
