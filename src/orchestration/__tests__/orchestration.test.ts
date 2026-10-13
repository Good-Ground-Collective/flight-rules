import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FileAgentRegistry } from "../../agents/agent-registry/agent-registry.js";
import { RegistryOrchestrationPolicy } from "../orchestration-policy.js";
import {
  CallerContextSchema,
  DispatchRequestSchema,
  type DispatchRequest,
  type RuntimeSnapshot,
} from "../orchestration.schema.js";
import { ValidatedReportHandoff } from "../report-handoff.js";

const context = {
  runId: "run-1",
  taskId: "task-1",
  cwd: "/repo/worktree/src",
  repositoryRoot: "/repo/worktree",
  baseRef: "main",
  skill: "execute-work",
  attempt: 1,
};
const request: DispatchRequest = {
  id: "dispatch-1",
  agent: "code-implementation",
  context,
  input: { ticket: "A bounded change" },
};
const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../agents", import.meta.url)),
);
const policy = new RegistryOrchestrationPolicy({ agents });
const available = {
  state: "available",
  evidence: "Observed by the adapter for this worker and checkout",
} as const;
const unavailable = {
  state: "unknown",
  evidence: "The host does not expose this fact",
  remedy: "Inspect the effective host configuration",
} as const;
function runtime(): RuntimeSnapshot {
  return {
    context,
    agent: request.agent,
    host: { name: "fixture", version: "1" },
    observedAt: "2026-10-13T00:00:00Z",
    spawn: available,
    ask: available,
    permissions: { read: available, edit: available, shell: available, web: available },
    limits: {
      maxConcurrent: 2,
      activeWorkers: 0,
      currentDepth: 0,
      maxDepth: 1,
      source: "Observed host settings",
    },
  };
}

describe("registry dispatch policy", () => {
  it("selects the canonical named registration without a concrete model override", () => {
    const decision = policy.prepare(request, runtime());
    expect(decision).toMatchObject({
      status: "ready",
      request,
      definition: { frontmatter: { name: request.agent, model: "standard" } },
    });
    expect(DispatchRequestSchema.safeParse({ ...request, model: "override" }).success).toBe(false);
  });

  it("isolates the registry from caller and returned-definition mutations", () => {
    const definitions = structuredClone(agents);
    const local = new RegistryOrchestrationPolicy({ agents: definitions });
    const implementation = definitions.find((agent) => agent.frontmatter.name === request.agent);
    if (!implementation) throw new Error("missing implementation agent");
    implementation.body = "mutated";
    const first = local.prepare(request, runtime());
    if (first.status !== "ready") throw new Error("expected ready");
    expect(first.definition.body).not.toBe("mutated");
    first.definition.frontmatter.capabilities.push("spawn");
    expect(local.prepare(request, runtime()).status).toBe("ready");
    expect(() => new RegistryOrchestrationPolicy({ agents: [...agents, implementation] })).toThrow(
      "duplicate agent name",
    );
  });

  it("rejects an unregistered agent", () => {
    expect(policy.prepare({ ...request, agent: "missing-agent" }, runtime())).toMatchObject({
      failure: { code: "UNKNOWN_AGENT" },
    });
  });

  it.each(["runId", "taskId", "baseRef", "skill", "cwd", "repositoryRoot", "attempt"] as const)(
    "rejects evidence from a different %s",
    (key) => {
      const snapshot = runtime();
      snapshot.context = {
        ...context,
        [key]:
          key === "attempt"
            ? 2
            : key === "cwd"
              ? "/repo/worktree/other"
              : key === "repositoryRoot"
                ? "/repo"
                : "other",
      };
      expect(policy.prepare(request, snapshot)).toMatchObject({
        failure: { code: "CONTEXT_MISMATCH" },
      });
    },
  );

  it("rejects evidence observed for another worker", () => {
    expect(policy.prepare(request, { ...runtime(), agent: "code-verifier" })).toMatchObject({
      failure: { code: "CONTEXT_MISMATCH" },
    });
  });

  it.each(["unknown", "denied"] as const)("reports missing parent dispatch: %s", (state) => {
    expect(
      policy.prepare(request, { ...runtime(), spawn: { ...unavailable, state } }),
    ).toMatchObject({
      failure: { code: "DISPATCH_UNAVAILABLE", capability: "spawn", remedy: unavailable.remedy },
    });
  });

  it.each([
    [{ maxConcurrent: null }, "LIMITS_UNKNOWN"],
    [{ maxDepth: null }, "LIMITS_UNKNOWN"],
    [{ maxConcurrent: 0 }, "CAPACITY_EXHAUSTED"],
    [{ activeWorkers: 2 }, "CAPACITY_EXHAUSTED"],
    [{ currentDepth: 1 }, "DEPTH_EXCEEDED"],
    [{ maxDepth: 0 }, "DEPTH_EXCEEDED"],
  ])("rejects unavailable capacity %j", (limits, code) => {
    const snapshot = runtime();
    expect(
      policy.prepare(request, { ...snapshot, limits: { ...snapshot.limits, ...limits } }),
    ).toMatchObject({ status: "unavailable", failure: { code, remedy: expect.any(String) } });
  });

  it("keeps retry attempt separate from worker depth and concurrency", () => {
    const caller = { ...context, attempt: 3 };
    expect(
      policy.prepare({ ...request, context: caller }, { ...runtime(), context: caller }).status,
    ).toBe("ready");
  });

  it.each(["unknown", "denied", "missing"] as const)(
    "rejects required worker access: %s",
    (state) => {
      const snapshot = runtime();
      delete snapshot.permissions.edit;
      if (state !== "missing") snapshot.permissions.edit = { ...unavailable, state };
      expect(policy.prepare(request, snapshot)).toMatchObject({
        failure: {
          code: state === "denied" ? "CAPABILITY_DENIED" : "CAPABILITY_UNKNOWN",
          capability: "edit",
        },
      });
    },
  );

  it("requires workflow capabilities in addition to the agent declaration", () => {
    const dispatch = { ...request, requiredCapabilities: ["git.push"] };
    expect(policy.prepare(dispatch, runtime())).toMatchObject({
      failure: { code: "CAPABILITY_UNKNOWN", capability: "git.push" },
    });
    const snapshot = runtime();
    snapshot.permissions["git.push"] = available;
    expect(policy.prepare(dispatch, snapshot).status).toBe("ready");
  });

  it.each([
    { sandbox: { fs: "read-only", network: "none" } },
    { dispatch: { maxConcurrent: 1, maxDepth: 1 } },
  ])("does not silently discard explicit restrictions %j", (settings) => {
    const definitions = agents.map((agent) => ({
      ...agent,
      frontmatter: { ...agent.frontmatter, ...settings },
    }));
    const restricted = new RegistryOrchestrationPolicy({ agents: definitions as typeof agents });
    expect(restricted.prepare(request, runtime())).toMatchObject({
      failure: { code: "UNSUPPORTED_AGENT_SETTINGS" },
    });
  });

  it("rejects relative or escaping working directories without claiming filesystem access", () => {
    for (const cwd of ["src", "/repo/worktree-other", "/repo/worktree/../outside"]) {
      expect(CallerContextSchema.safeParse({ ...context, cwd }).success).toBe(false);
    }
    expect(CallerContextSchema.parse(context)).toEqual(context);
  });
});

describe("caller-owned questions and sibling skills", () => {
  const question = { context, question: "Which behavior is required?", allowHumanQuestions: true };
  it("requires explicit question opt-in even when the host supports questions", () => {
    expect(policy.ask({ ...question, allowHumanQuestions: false }, runtime())).toMatchObject({
      failure: { code: "QUESTIONS_DISABLED" },
    });
  });
  it.each(["unknown", "denied"] as const)("does not invent question support: %s", (state) => {
    expect(policy.ask(question, { ...runtime(), ask: { ...unavailable, state } })).toMatchObject({
      failure: { code: "QUESTIONS_UNAVAILABLE" },
    });
  });
  it("plans waiting for an actual answer, without interpreting capability evidence as an answer", () => {
    expect(policy.ask(question, runtime())).toEqual({
      status: "awaiting-answer",
      request: question,
    });
    expect(
      policy.ask(question, { ...runtime(), context: { ...context, taskId: "other" } }),
    ).toMatchObject({ failure: { code: "CONTEXT_MISMATCH" } });
  });
  it("preserves the caller context when selecting a sibling skill", () => {
    const result = policy.sibling({
      context,
      skill: "verify-ticket",
      input: { ticketId: context.taskId },
    });
    expect(result).toEqual({
      context,
      skill: "verify-ticket",
      input: { ticketId: context.taskId },
    });
    expect(result.context).not.toBe(context);
  });
});

describe("role-specific report handoff", () => {
  const handoff = new ValidatedReportHandoff();
  const schema = z.strictObject({
    findings: z.array(z.string()),
    confidence: z.enum(["high", "low"]),
  });
  const report = { findings: ["  Keep exact evidence\n"], confidence: "high" };
  const outcome = {
    status: "completed",
    dispatchId: request.id,
    agent: request.agent,
    context,
    report,
  };

  it("preserves role-specific reports, including evidence whitespace", () => {
    expect(handoff.accept(request, outcome, schema)).toEqual({ status: "accepted", outcome });
  });
  it.each([
    { dispatchId: "other" },
    { agent: "code-verifier" },
    { context: { ...context, attempt: 2 } },
    { context: { ...context, taskId: "other" } },
    { context: { ...context, cwd: "/repo/worktree/other" } },
    { context: { ...context, baseRef: "other" } },
    { context: { ...context, runId: "other" } },
    { report: undefined },
    { status: "success" },
    { extra: true },
  ])("rejects malformed or mismatched envelopes %j", (change) => {
    expect(handoff.accept(request, { ...outcome, ...change }, schema)).toMatchObject({
      status: "rejected",
      failure: { code: "INVALID_HANDOFF" },
    });
  });
  it("rejects an invalid role report", () => {
    expect(
      handoff.accept(request, { ...outcome, report: { summary: "Looks good" } }, schema),
    ).toMatchObject({ failure: { code: "INVALID_REPORT" } });
  });
  it.each(["failed", "unavailable"])("preserves %s without fabricating a report", (status) => {
    const failure = {
      code: "EXECUTION_FAILED",
      message: "Host tool failed",
      remedy: "Inspect host error",
    };
    const result = { status, dispatchId: request.id, agent: request.agent, context, failure };
    expect(handoff.accept(request, result, schema)).toEqual({
      status: "accepted",
      outcome: result,
    });
    expect(handoff.accept(request, { ...result, report }, schema)).toMatchObject({
      failure: { code: "INVALID_HANDOFF" },
    });
  });
});
