import { describe, expect, it } from "vitest";
import { VerifiedImplementationLoop } from "../implementation-loop.js";
import {
  ImplementationReportSchema,
  type HandoffRecord,
  type ImplementationReport,
  type ImplementationRun,
  type VerificationReport,
} from "../implementation-loop.schema.js";
import type { DispatchRequest } from "../orchestration.schema.js";

const loop = new VerifiedImplementationLoop();
function run(): ImplementationRun {
  return {
    context: {
      runId: "run-1",
      taskId: "ticket-1",
      cwd: "/repo/src",
      repositoryRoot: "/repo",
      baseRef: "abc123",
      skill: "execute-work",
    },
    criteria: ["Reject invalid input", "Preserve valid input"],
    implementationInput: {
      ticket: "Validate input",
      charter: "Repository standards",
      parentBrief: "Keep compatibility",
    },
    history: [],
  };
}
function implementationReport(path = "src/input.ts"): ImplementationReport {
  return {
    summary: "Everything passes!",
    filesChanged: [{ path, why: "Implemented the requirement" }],
    testsRun: [{ command: "npm test", result: "passed" }],
    approach: "Implementation details",
  };
}
function report(
  input: ImplementationRun,
  verdict: "PASS" | "FAIL" | "UNVERIFIABLE" = "FAIL",
): VerificationReport {
  return {
    summary: "Independent verification",
    criteria: input.criteria.map((criterion) => ({
      criterion,
      verdict,
      evidence: "  Exact command output\nFAIL at line 12\n",
    })),
    verified: verdict === "PASS",
  };
}
function receipt(request: DispatchRequest, result: unknown): HandoffRecord {
  return {
    request,
    outcome: {
      status: "completed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      report: result,
    },
  };
}
function nextImplementation(input: ImplementationRun): DispatchRequest {
  const decision = loop.next(input);
  if (decision.status !== "implement") throw new Error(JSON.stringify(decision));
  return decision.request;
}
function addRound(
  input: ImplementationRun,
  result = report(input),
  implementation = implementationReport(),
): void {
  const impl = receipt(nextImplementation(input), implementation);
  const verification = loop.verify(input, impl);
  if (verification.status !== "verify") throw new Error(JSON.stringify(verification));
  input.history.push({ implementation: impl, verification: receipt(verification.request, result) });
}

describe("verified implementation loop", () => {
  it("uses standard twice, then the named escalated variant; preserves exact failed criteria", () => {
    const input = run();
    for (const attempt of [1, 2, 3]) {
      const request = nextImplementation(input);
      expect(request.agent).toBe(
        attempt === 3 ? "code-implementation-escalated" : "code-implementation",
      );
      expect(request.context).toEqual({ ...input.context, attempt });
      expect(request.input).toMatchObject({
        ...input.implementationInput,
        criteria: input.criteria,
      });
      if (attempt === 1) expect(request.input).not.toHaveProperty("verifierFailures");
      else expect(request.input.verifierFailures).toEqual(report(input).criteria);
      addRound(input);
      expect(input.history.at(-1)?.verification.request.agent).toBe("code-verifier");
    }
    expect(loop.next(input)).toMatchObject({
      status: "stopped",
      failure: { code: "ATTEMPTS_EXHAUSTED" },
    });
  });

  it("isolates verifier input and includes changed paths from earlier attempts", () => {
    const input = run();
    addRound(input, report(input), implementationReport("src/first.ts"));
    const impl = receipt(nextImplementation(input), implementationReport("src/second.ts"));
    const verification = loop.verify(input, impl);
    expect(verification).toMatchObject({
      status: "verify",
      request: { agent: "code-verifier", context: { ...input.context, attempt: 2 } },
    });
    if (verification.status !== "verify") throw new Error("expected verifier dispatch");
    expect(verification.request.input).toEqual({
      criteria: input.criteria,
      filesChanged: [{ path: "src/first.ts" }, { path: "src/second.ts" }],
    });
    expect(JSON.stringify(verification)).not.toContain("Everything passes");
    input.history.push({
      implementation: impl,
      verification: receipt(verification.request, report(input, "PASS")),
    });
    expect(loop.next(input)).toMatchObject({
      status: "verified",
      filesChanged: ["src/first.ts", "src/second.ts"],
    });
  });

  it.each([1, 2, 3])("stops after PASS on attempt %i", (attempt) => {
    const input = run();
    for (let previous = 1; previous < attempt; previous++) addRound(input);
    addRound(input, report(input, "PASS"));
    expect(loop.next(input)).toMatchObject({ status: "verified" });
    const previous = input.history.at(-1);
    if (!previous) throw new Error("missing round");
    expect(loop.verify(input, previous.implementation)).toMatchObject({
      failure: { code: "INVALID_HISTORY" },
    });
  });

  it.each([1, 2, 3])(
    "stops UNVERIFIABLE on attempt %i before another implementation",
    (attempt) => {
      const input = run();
      for (let previous = 1; previous < attempt; previous++) addRound(input);
      const result = report(input);
      result.criteria[0] = {
        criterion: input.criteria[0] ?? "",
        verdict: "UNVERIFIABLE",
        evidence: "No credentials",
      };
      addRound(input, result);
      expect(loop.next(input)).toMatchObject({ failure: { code: "UNVERIFIABLE" } });
    },
  );

  it("passes only FAIL items to the next implementer", () => {
    const input = run();
    const result = report(input);
    result.criteria[1] = {
      criterion: input.criteria[1] ?? "",
      verdict: "PASS",
      evidence: "Independent test passed",
    };
    addRound(input, result);
    expect(nextImplementation(input).input.verifierFailures).toEqual([result.criteria[0]]);
  });

  it.each(["missing", "extra", "reordered", "paraphrased", "contradictory"] as const)(
    "rejects %s verifier criteria",
    (kind) => {
      const input = run();
      const result = report(input);
      if (kind === "missing") result.criteria.pop();
      if (kind === "extra")
        result.criteria.push({ criterion: "Unrequested", verdict: "FAIL", evidence: "irrelevant" });
      if (kind === "reordered") result.criteria.reverse();
      if (kind === "paraphrased")
        result.criteria[0] = {
          criterion: "Different wording",
          verdict: "FAIL",
          evidence: "ambiguous binding",
        };
      if (kind === "contradictory") result.verified = true;
      addRound(input, result);
      expect(loop.next(input)).toMatchObject({ failure: { code: "INVALID_REPORT" } });
    },
  );

  it("stops for implementer questions before verification and verifier questions before retry", () => {
    const input = run();
    const implementation = receipt(nextImplementation(input), {
      ...implementationReport(),
      openQuestions: ["Which API?"],
    });
    expect(loop.verify(input, implementation)).toMatchObject({
      failure: { code: "OPEN_QUESTIONS", message: "Which API?" },
    });
    addRound(input, { ...report(input, "PASS"), openQuestions: ["Is the evidence sufficient?"] });
    expect(loop.next(input)).toMatchObject({ failure: { code: "OPEN_QUESTIONS" } });
  });

  it.each(["failed", "unavailable"] as const)(
    "does not count an execution outcome of %s as a verifier FAIL",
    (status) => {
      const input = run();
      const request = nextImplementation(input);
      const failure = {
        code: "EXECUTION_FAILED",
        message: "Host terminated worker",
        remedy: "Inspect execution",
      };
      const implementation = {
        request,
        outcome: {
          status,
          dispatchId: request.id,
          agent: request.agent,
          context: request.context,
          failure,
        },
      };
      expect(loop.verify(input, implementation)).toEqual({ status: "stopped", failure });
      addRound(input);
      const round = input.history[0];
      if (!round) throw new Error("missing round");
      const verifier = round.verification.request;
      round.verification.outcome = {
        status,
        dispatchId: verifier.id,
        agent: verifier.agent,
        context: verifier.context,
        failure,
      };
      expect(loop.next(input)).toEqual({ status: "stopped", failure });
    },
  );

  it.each([
    "early-escalation",
    "escalated-verifier",
    "claims-in-verifier",
    "out-of-order",
    "foreign-report",
    "foreign-task",
  ] as const)("rejects %s history", (kind) => {
    const input = run();
    addRound(input);
    const round = input.history[0];
    if (!round) throw new Error("missing round");
    if (kind === "early-escalation")
      round.implementation.request.agent = "code-implementation-escalated";
    if (kind === "escalated-verifier")
      round.verification.request.agent = "code-implementation-escalated";
    if (kind === "claims-in-verifier")
      round.verification.request.input.summary = "Implementation passed all tests";
    if (kind === "out-of-order") round.implementation.request.context.attempt = 2;
    if (kind === "foreign-task") input.context.taskId = "different-task";
    if (kind === "foreign-report")
      round.verification.outcome = {
        ...(receipt(round.verification.request, report(input)).outcome as object),
        context: { ...round.verification.request.context, attempt: 2 },
      };
    expect(loop.next(input)).toMatchObject({
      status: "stopped",
      failure: { code: kind === "foreign-report" ? "INVALID_HANDOFF" : "INVALID_HISTORY" },
    });
  });

  it.each(["PASS", "UNVERIFIABLE"] as const)("rejects history continuing after %s", (verdict) => {
    const input = run();
    addRound(input);
    addRound(input);
    const first = input.history[0];
    if (!first) throw new Error("missing round");
    first.verification.outcome = receipt(
      first.verification.request,
      report(input, verdict),
    ).outcome;
    expect(loop.next(input)).toMatchObject({ failure: { code: "INVALID_HISTORY" } });
  });

  it("rejects an invented fourth round or injected retry evidence", () => {
    const input = run();
    for (let attempt = 0; attempt < 3; attempt++) addRound(input);
    const last = input.history.at(-1);
    if (!last) throw new Error("missing round");
    input.history.push(last);
    expect(loop.next(input)).toMatchObject({ failure: { code: "INVALID_HISTORY" } });
    const injected = run();
    injected.implementationInput.verifierFailures = ["Invented prior FAIL"];
    expect(loop.next(injected)).toMatchObject({ failure: { code: "INVALID_HISTORY" } });
  });

  it("retains the canonical implementation report shape", () => {
    expect(ImplementationReportSchema.parse(implementationReport())).toEqual(
      implementationReport(),
    );
    const input = run();
    expect(
      loop.verify(input, receipt(nextImplementation(input), { summary: "done" })),
    ).toMatchObject({ failure: { code: "INVALID_REPORT" } });
    expect(loop.verify(input, {} as HandoffRecord)).toMatchObject({
      failure: { code: "INVALID_HANDOFF" },
    });
  });
});
