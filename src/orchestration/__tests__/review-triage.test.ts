import { describe, expect, it } from "vitest";
import { InvalidWorkerReportError, WorkerReportCodec } from "../../sdk/report-codec.js";
import { ReviewTriageReportSchema, type ReviewTriageReport } from "../review-triage.schema.js";

const codec = new WorkerReportCodec();
const triage: ReviewTriageReport = {
  summary: "One fix and one duplicate",
  headSha: "a".repeat(40),
  findings: [
    {
      id: "private-1",
      disposition: "fix",
      evidence: "src/input.ts accepts blank input; the contract requires rejection.",
      criterion: "src/input.ts rejects blank input; exercise the public parser with whitespace.",
    },
    {
      id: "private-2",
      disposition: "ignore",
      evidence: "Duplicate of private-1: same whitespace branch and required behavior.",
    },
  ],
};

function parse(report: unknown, mode: "triage" | "verify" = "triage") {
  return codec.parse(`\`\`\`yaml\n${JSON.stringify(report)}\n\`\`\``, {
    agent: "code-verifier",
    mode,
  });
}

describe("review triage worker reports", () => {
  it("preserves per-finding dispositions and evidence through the harness codec", () => {
    expect(parse(triage)).toEqual(triage);
    expect(parse({ ...triage, findings: [] })).toMatchObject({ findings: [] });
  });

  it("cannot substitute a triage disposition for acceptance verification", () => {
    expect(() => parse(triage, "verify")).toThrow(InvalidWorkerReportError);
    expect(() =>
      parse({
        summary: "Passed",
        criteria: [{ criterion: "Works", verdict: "PASS", evidence: "Observed" }],
        verified: true,
      }),
    ).toThrow(InvalidWorkerReportError);
  });

  it.each([
    { id: "private-1", disposition: "fix", evidence: "Observed" },
    { id: "private-1", disposition: "ignore", evidence: " " },
    { id: "private-1", disposition: "needs_input", evidence: "No access" },
    { id: "private-1", disposition: "ignore", evidence: "Observed", criterion: "Silently fix it" },
  ])("rejects incomplete or contradictory disposition %j", (finding) => {
    expect(() => parse({ ...triage, findings: [finding] })).toThrow(InvalidWorkerReportError);
  });

  it("rejects duplicate finding IDs and invalid head identities", () => {
    expect(() => parse({ ...triage, findings: [...triage.findings, ...triage.findings] })).toThrow(
      InvalidWorkerReportError,
    );
    expect(() => parse({ ...triage, headSha: "main" })).toThrow(InvalidWorkerReportError);
  });

  it("keeps unavailable evidence as an explicit caller question", () => {
    const finding = {
      id: "external-3",
      disposition: "needs_input",
      evidence: "Production behavior cannot be verified with the available access.",
      question: "Can the owner provide production verification evidence?",
    };
    expect(() => parse({ ...triage, findings: [finding] })).toThrow(InvalidWorkerReportError);
    const report = { ...triage, findings: [finding], openQuestions: [finding.question] };
    expect(ReviewTriageReportSchema.parse(parse(report))).toEqual(report);
  });
});
