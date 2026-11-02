import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import type { OperationEffect } from "../../../operations/operation.schema.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
} from "../../../operations/operation-registry.js";
import type {
  CallerContext,
  RuntimeSnapshot,
} from "../../../orchestration/orchestration.schema.js";
import { instructionCatalog } from "../../instruction-catalog.js";
import type { WorkerRuntimeContract } from "../../worker-runtime-core.js";
import { ClaudeAgentSkillRuntime, type ClaudeAgentSkillRuntimeObserver } from "../skill-runtime.js";
import type { WorkerHostTool } from "../tool-policy.js";
import { ScriptedClaudeQuery, type QueryScript } from "./scripted-claude-query.js";

const context: CallerContext = {
  runId: "skill-test",
  taskId: "human-boundary",
  cwd: "/repo",
  repositoryRoot: "/repo",
  baseRef: "main",
  skill: "test",
  attempt: 1,
};
const allowed = { state: "available", evidence: "Host observed access." } as const;
const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../../agents", import.meta.url)),
);
const operationTool = "mcp__flight-rules__flight_rules_operation";
const dispatchTool = "mcp__flight-rules__flight_rules_dispatch";
const siblingTool = "mcp__flight-rules__flight_rules_sibling_skill";
const askTool = "mcp__flight-rules__flight_rules_ask_human";
const hostReadTool = "mcp__flight-rules-host__unused_read";
const idleWorkers: WorkerRuntimeContract = {
  dispatch: async () => {
    throw new Error("This test does not dispatch a named worker.");
  },
  dispatchMany: async () => [],
};

const operationCall = (operationId = "test-read") => ({
  name: operationTool,
  input: { operationId, input: { value: "ok" } },
});
const siblingCall = {
  name: siblingTool,
  input: { siblingSkill: "guided-code-review", input: { nested: true } },
};
const askCall = { name: askTool, input: { question: "May I continue?" } };
const dispatchCall = (agent = "code-implementation") => ({
  name: dispatchTool,
  input: { agent, dispatchId: "dependent-worker", input: {} },
});
const hostCall = { name: hostReadTool, input: {} };

function snapshot(): RuntimeSnapshot {
  return {
    context,
    host: { name: "test-host", version: "1" },
    observedAt: new Date().toISOString(),
    agent: null,
    spawn: allowed,
    ask: allowed,
    permissions: {
      read: allowed,
      edit: allowed,
      shell: allowed,
      web: allowed,
      spawn: allowed,
      ask: allowed,
    },
    limits: {
      maxConcurrent: 3,
      activeWorkers: 0,
      currentDepth: 0,
      maxDepth: 1,
      source: "test host",
    },
  };
}

function hostTool(
  handler: WorkerHostTool["handler"] = async () => "host evidence",
): WorkerHostTool {
  return { name: "unused_read", description: "Unused host read", inputSchema: {}, handler };
}

interface RuntimeOptions {
  observe?: ClaudeAgentSkillRuntimeObserver;
  operationCalls?: (value: unknown) => void;
  operationEffects?: OperationEffect[];
  operationFailure?: Error;
  operationWait?: () => Promise<void>;
  hostTool?: WorkerHostTool;
  workers?: WorkerRuntimeContract;
  partialOperationIds?: string[];
  partialArrival?: () => Promise<void>;
}

function runtimeFor(script: QueryScript, options: RuntimeOptions = {}) {
  const scripted = new ScriptedClaudeQuery({
    response: "The human answer was recorded.",
    ...script,
  });
  const operationCalls = options.operationCalls ?? vi.fn<(value: unknown) => void>();
  const read = {
    id: "test-read",
    description: "Read test evidence",
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    effects: options.operationEffects ?? (["read"] satisfies OperationEffect[]),
    cli: { path: ["test", "read"], aliases: [] },
    handler: async (input: { value: string }) => {
      await options.operationWait?.();
      if (options.operationFailure !== undefined) throw options.operationFailure;
      operationCalls(input);
      return input;
    },
  };
  const partials = (options.partialOperationIds ?? []).map((operationId, index) => ({
    id: operationId,
    description: "Create a record and report a later upload failure",
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ createdId: z.string(), state: z.string() }),
    effects: ["write"] as OperationEffect[],
    cli: { path: ["test", "create", String(index)], aliases: [] },
    handler: async () => {
      await options.partialArrival?.();
      operationCalls(operationId);
      if (operationId === "test-error") throw new Error("Post-write audit failed");
      return {
        status: "partial" as const,
        data: { createdId: `CREATED-${417 + index}`, state: "created" },
        error: { name: "AttachmentUploadError", message: "Upload failed" },
      };
    },
  }));
  const operations = new MapOperationRegistry({
    operations: [read, ...partials],
    policy: new LaunchOperationAccessPolicy({
      allowedOperationIds: ["test-read", ...(options.partialOperationIds ?? [])],
    }),
  });
  const skills = new ClaudeAgentSkillRuntime({
    instructions: instructionCatalog,
    agents,
    models: { standard: "standard-model", escalated: "escalated-model", expert: "expert-model" },
    operations,
    workers: options.workers ?? idleWorkers,
    observe: options.observe ?? (async () => snapshot()),
    toolGrants: () => ({ read: [options.hostTool ?? hostTool()] }),
    query: scripted.query as never,
  });
  return { skills, scripted, operationCalls };
}

const completedDispatch = (request: Parameters<WorkerRuntimeContract["dispatch"]>[0]) => ({
  status: "completed" as const,
  dispatchId: request.id,
  agent: request.agent,
  context: request.context,
  report: { summary: "Completed", filesChanged: [], testsRun: [], approach: "Fixture" },
});

describe("Claude Agent skill runtime", () => {
  it("runs the canonical body unchanged through isolated options and an in-process operation server", async () => {
    const { skills, scripted, operationCalls } = runtimeFor({ turns: [[operationCall()]] });
    const canonical = instructionCatalog.loadSkill("guided-code-review").contents;

    const result = await skills.invoke("guided-code-review", context, { focus: "contract" });

    expect(result).toMatchObject({
      status: "completed",
      context,
      report: "The human answer was recorded.",
    });
    expect(operationCalls).toHaveBeenCalledWith({ value: "ok" });
    const [call] = scripted.invocations;
    expect(call?.prompt).toContain(canonical);
    expect(call?.prompt).toContain(JSON.stringify(context));
    expect(call?.prompt).toContain('"focus":"contract"');
    expect(call?.options).toMatchObject({
      settingSources: [],
      plugins: [],
      strictMcpConfig: true,
      persistSession: true,
      model: "standard-model",
      cwd: "/repo",
    });
    expect(call?.options.canUseTool).toBeTypeOf("function");
    expect(call?.options.hooks?.PreToolUse).toHaveLength(1);
    expect(call?.options.mcpServers?.["flight-rules"]).toMatchObject({ type: "sdk" });
    expect(call?.options.mcpServers?.["flight-rules-host"]).toMatchObject({ type: "sdk" });
    expect(call?.options.disallowedTools).toEqual(
      expect.arrayContaining(["Agent", "AskUserQuestion", "Skill", "ToolSearch"]),
    );
  });

  it("runs sibling instructions with the same caller context in a separate query", async () => {
    const { skills, scripted } = runtimeFor({
      turns: [[siblingCall]],
      nestedTurns: [],
    });

    const result = await skills.invoke("guided-code-review", context, { focus: "parent" });

    expect(result.status).toBe("completed");
    expect(scripted.invocations).toHaveLength(2);
    expect(scripted.invocations[1]?.prompt).toContain(JSON.stringify(context));
    expect(scripted.invocations[1]?.prompt).toContain('"nested":true');
  });

  it("observes each selected registered worker before dispatch", async () => {
    const observedRegistrations: (string | null)[] = [];
    const observe: ClaudeAgentSkillRuntimeObserver = async (caller, registration) => {
      const name = registration?.frontmatter.name ?? null;
      observedRegistrations.push(name);
      return { ...snapshot(), context: caller, agent: name };
    };
    const dispatch = vi.fn<WorkerRuntimeContract["dispatch"]>(async (request) =>
      completedDispatch(request),
    );
    const invokeWorker = (agent: string) =>
      runtimeFor(
        { turns: [[dispatchCall(agent)]] },
        { observe, workers: { dispatch, dispatchMany: async () => [] } },
      ).skills.invoke("guided-code-review", context, {});

    const implementation = await invokeWorker("code-implementation");
    const verifier = await invokeWorker("code-verifier");

    expect(implementation.status).toBe("completed");
    expect(verifier.status).toBe("completed");
    expect(dispatch.mock.calls.map(([request]) => request.agent)).toEqual([
      "code-implementation",
      "code-verifier",
    ]);
    expect(observedRegistrations.filter((name) => name !== null)).toEqual([
      "code-implementation",
      "code-verifier",
    ]);
  });

  it("rejects dispatch when worker evidence names a different registration", async () => {
    const dispatch = vi.fn<WorkerRuntimeContract["dispatch"]>();
    const { skills } = runtimeFor(
      { turns: [[dispatchCall("code-verifier")]] },
      {
        observe: async (caller) => ({
          ...snapshot(),
          context: caller,
          agent: "code-implementation",
        }),
        workers: { dispatch, dispatchMany: async () => [] },
      },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("CONTEXT_MISMATCH");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects dispatch when selected worker capabilities are denied", async () => {
    const dispatch = vi.fn<WorkerRuntimeContract["dispatch"]>();
    const { skills } = runtimeFor(
      { turns: [[dispatchCall()]] },
      {
        observe: async (caller, registration) => ({
          ...snapshot(),
          context: caller,
          agent: registration?.frontmatter.name ?? null,
          permissions: {
            ...snapshot().permissions,
            shell: { state: "denied", evidence: "No worker shell access", remedy: "Ask the host" },
          },
        }),
        workers: { dispatch, dispatchMany: async () => [] },
      },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("CAPABILITY_DENIED");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("passes the run's abort signal to the dispatched worker", async () => {
    const dispatch = vi.fn<WorkerRuntimeContract["dispatch"]>(async (request) =>
      completedDispatch(request),
    );
    const { skills } = runtimeFor(
      { turns: [[dispatchCall()]] },
      {
        observe: async (caller, registration) => ({
          ...snapshot(),
          context: caller,
          agent: registration?.frontmatter.name ?? null,
        }),
        workers: { dispatch, dispatchMany: async () => [] },
      },
    );

    await skills.invoke("guided-code-review", context, {});

    expect(dispatch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  describe("human questions", () => {
    it("defers the ask tool, keeps the pause and resumes the same session and call with the answer", async () => {
      const operationCalls = vi.fn();
      const observe = vi.fn(async () => snapshot());
      const { skills, scripted } = runtimeFor(
        { turns: [[askCall], [operationCall()]] },
        { observe, operationCalls },
      );

      const paused = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );

      expect(paused).toMatchObject({ status: "paused", context, question: "May I continue?" });
      expect(operationCalls).not.toHaveBeenCalled();
      expect(scripted.outputs).toEqual([]);
      if (paused.status !== "paused") throw new Error("Expected a deferred question");

      const completed = await skills.resume({
        context,
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "Yes, continue.",
      });

      expect(completed).toMatchObject({
        status: "completed",
        context,
        invocationId: paused.invocationId,
      });
      expect(operationCalls).toHaveBeenCalledTimes(1);
      const [first, second] = scripted.invocations;
      expect(first?.options.resume).toBeUndefined();
      expect(second?.options.resume).toBe("scripted-session-1");
      expect(second?.options.persistSession).toBe(true);
      expect(scripted.hookedToolUses.slice(0, 2)).toEqual(["scripted-use-1", "scripted-use-1"]);
      expect(scripted.outputs[0]).toMatchObject({
        id: "scripted-use-1",
        name: askTool,
        text: "Yes, continue.",
        isError: false,
      });
      expect(observe.mock.calls.length).toBeGreaterThanOrEqual(5);
      await expect(
        skills.resume({
          context,
          pauseId: paused.pauseId,
          questionId: paused.questionId,
          answer: "duplicate",
        }),
      ).rejects.toThrow();
    });

    it.each(["disabled", "unavailable"])(
      "offers no ask tool and supplies no default answer when human questions are %s",
      async (policy) => {
        const operationCalls = vi.fn();
        const { skills, scripted } = runtimeFor(
          { turns: [[askCall], [operationCall()]] },
          {
            operationCalls,
            observe: async () => ({
              ...snapshot(),
              ask:
                policy === "unavailable"
                  ? { state: "denied", evidence: "No human channel", remedy: "Supply a channel" }
                  : allowed,
            }),
          },
        );

        const result = await skills.invoke(
          "guided-code-review",
          context,
          {},
          { allowHumanQuestions: policy !== "disabled" },
        );

        expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
        expect(result.status === "failed" && result.failure.message).toContain(
          "flight_rules_ask_human",
        );
        expect(operationCalls).not.toHaveBeenCalled();
        expect(scripted.outputs).toEqual([]);
      },
    );

    it("refuses an answer written by the model", async () => {
      const { skills, scripted } = runtimeFor({
        turns: [[{ name: askTool, input: { question: "May I continue?", answer: "yes" } }]],
      });

      const result = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );

      expect(result.status).toBe("completed");
      expect(scripted.denials).toEqual([
        { name: askTool, reason: "Only the human caller can supply an answer." },
      ]);
      expect(scripted.outputs).toEqual([]);
    });

    it("fails when the SDK ran the ask tool without pausing it", async () => {
      const { skills } = runtimeFor({ turns: [[askCall]], bypassHooks: true });

      const result = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );

      expect(result).toMatchObject({ status: "failed", failure: { code: "QUESTION_NOT_PAUSED" } });
    });

    it.each([
      [operationTool, false],
      [operationTool, true],
      [hostReadTool, false],
      [hostReadTool, true],
      [dispatchTool, false],
      [dispatchTool, true],
    ])(
      "runs nothing from a turn that mixes a sibling skill with %s (reversed %s)",
      async (dependent, reversed) => {
        const dependentCall =
          dependent === operationTool
            ? operationCall()
            : dependent === dispatchTool
              ? dispatchCall()
              : hostCall;
        const batch = [siblingCall, dependentCall];
        const operationCalls = vi.fn();
        const hostCalls = vi.fn(async () => "host evidence");
        const dispatch = vi.fn<WorkerRuntimeContract["dispatch"]>(async (request) =>
          completedDispatch(request),
        );
        const { skills, scripted } = runtimeFor(
          { turns: [reversed ? batch.toReversed() : batch, [dependentCall]], nestedTurns: [] },
          {
            operationEffects: ["write"],
            operationCalls,
            hostTool: hostTool(hostCalls),
            observe: async () => ({ ...snapshot(), agent: "code-implementation" }),
            workers: { dispatch, dispatchMany: async () => [] },
          },
        );

        const result = await skills.invoke("guided-code-review", context, {});

        expect(result.status).toBe("completed");
        expect(scripted.denials.map(({ name }) => name).toSorted()).toEqual(
          [siblingTool, dependent].toSorted(),
        );
        expect(scripted.denials[0]?.reason).toContain("call it alone");
        expect(scripted.invocations).toHaveLength(1);
        const calls =
          dependent === operationTool
            ? operationCalls
            : dependent === hostReadTool
              ? hostCalls
              : dispatch;
        expect(calls).toHaveBeenCalledTimes(1);
      },
    );

    it("refuses an ask that shares its turn with another call", async () => {
      const operationCalls = vi.fn();
      const { skills, scripted } = runtimeFor(
        { turns: [[askCall, operationCall()]] },
        { operationCalls },
      );

      const result = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );

      expect(result.status).toBe("completed");
      expect(operationCalls).not.toHaveBeenCalled();
      expect(scripted.denials).toHaveLength(2);
    });

    it("fails the parent with a named error when a sibling skill pauses, and does not keep the sibling pause", async () => {
      const operationCalls = vi.fn();
      const { skills, scripted } = runtimeFor(
        { turns: [[siblingCall], [operationCall()]], nestedTurns: [[askCall]] },
        { operationCalls },
      );

      const result = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );

      expect(result).toMatchObject({
        status: "failed",
        failure: { code: "NESTED_PAUSE_UNSUPPORTED" },
      });
      expect(result.status === "failed" && result.failure.message).toContain("guided-code-review");
      expect(scripted.invocations).toHaveLength(2);
      expect(operationCalls).not.toHaveBeenCalled();
    });

    it("rejects foreign and missing resume identities and explicitly cancels paused work", async () => {
      const { skills } = runtimeFor({ turns: [[askCall]] });
      const paused = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );
      if (paused.status !== "paused") throw new Error("Expected a deferred question");

      await expect(
        skills.resume({
          context: { ...context, attempt: 2 },
          pauseId: paused.pauseId,
          questionId: paused.questionId,
          answer: "foreign",
        }),
      ).rejects.toThrow();
      await expect(
        skills.resume({
          context,
          pauseId: paused.pauseId,
          questionId: "stale-question",
          answer: "stale",
        }),
      ).rejects.toThrow();
      await expect(
        skills.resume({
          context,
          pauseId: paused.pauseId,
          questionId: paused.questionId,
          answer: "  ",
        }),
      ).rejects.toThrow("human answer is required");
      expect(skills.cancel(context, paused.pauseId)).toMatchObject({
        status: "failed",
        failure: { code: "CANCELLED" },
      });
      await expect(
        skills.resume({
          context,
          pauseId: paused.pauseId,
          questionId: paused.questionId,
          answer: "late",
        }),
      ).rejects.toThrow();
    });

    it("fails a resume when fresh question access is gone and keeps the pause resumable", async () => {
      let askAvailable = true;
      const { skills } = runtimeFor(
        { turns: [[askCall]] },
        {
          observe: async () => ({
            ...snapshot(),
            ask: askAvailable
              ? allowed
              : { state: "denied", evidence: "Channel closed", remedy: "Reopen" },
          }),
        },
      );
      const paused = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );
      if (paused.status !== "paused") throw new Error("Expected a deferred question");
      askAvailable = false;

      const refused = await skills.resume({
        context,
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "Yes",
      });

      expect(refused).toMatchObject({ status: "failed" });
      expect(refused.status === "failed" && refused.failure.message).toContain(
        "Fresh question access is unavailable",
      );
      askAvailable = true;
      const retried = await skills.resume({
        context,
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "Yes",
      });
      expect(retried.status).toBe("completed");
    });

    it("reserves a paused question before awaiting fresh access so concurrent resumes cannot share it", async () => {
      let racing = false;
      let release: (() => void) | undefined;
      let entered: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const observing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const observe = vi.fn(async () => {
        if (racing) {
          entered?.();
          await gate;
        }
        return snapshot();
      });
      const { skills } = runtimeFor({ turns: [[askCall]] }, { observe });
      const paused = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );
      if (paused.status !== "paused") throw new Error("Expected a deferred question");
      racing = true;
      const request = {
        context,
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "Yes",
      };

      const first = skills.resume(request);
      await observing;
      await expect(skills.resume(request)).rejects.toThrow("missing, stale or does not match");
      release?.();

      await expect(first).resolves.toMatchObject({
        status: "completed",
        invocationId: paused.invocationId,
      });
    });

    it("pauses again when the resumed session asks a further question", async () => {
      const { skills, scripted } = runtimeFor({ turns: [[askCall], [askCall]] });
      const first = await skills.invoke(
        "guided-code-review",
        context,
        {},
        { allowHumanQuestions: true },
      );
      if (first.status !== "paused") throw new Error("Expected the first question");

      const second = await skills.resume({
        context,
        pauseId: first.pauseId,
        questionId: first.questionId,
        answer: "First answer",
      });

      expect(second).toMatchObject({ status: "paused", invocationId: first.invocationId });
      if (second.status !== "paused") throw new Error("Expected the second question");
      expect(second.pauseId).not.toBe(first.pauseId);
      expect(second.questionId).not.toBe(first.questionId);
      expect(scripted.invocations[1]?.options.resume).toBe("scripted-session-1");
      await expect(
        skills.resume({
          context,
          pauseId: first.pauseId,
          questionId: first.questionId,
          answer: "Stale answer",
        }),
      ).rejects.toThrow();
      const completed = await skills.resume({
        context,
        pauseId: second.pauseId,
        questionId: second.questionId,
        answer: "Second answer",
      });
      expect(completed.status).toBe("completed");
    });
  });

  it("rejects every unavailable operation effect before the shared handler runs", async () => {
    const calls = vi.fn();
    const limited = {
      ...snapshot(),
      permissions: {
        ...snapshot().permissions,
        shell: { state: "denied", evidence: "No shell grant", remedy: "Ask host" },
        web: { state: "denied", evidence: "No web grant", remedy: "Ask host" },
      },
    } satisfies RuntimeSnapshot;
    const { skills } = runtimeFor(
      { turns: [[operationCall()]] },
      {
        observe: async () => limited,
        operationCalls: calls,
        operationEffects: ["write", "process", "network"],
      },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("shell grant");
    expect(calls).not.toHaveBeenCalled();

    const networkCalls = vi.fn();
    const networkResult = await runtimeFor(
      { turns: [[operationCall()]] },
      {
        observe: async () => ({
          ...snapshot(),
          permissions: {
            ...snapshot().permissions,
            web: { state: "denied", evidence: "No network grant", remedy: "Ask host" },
          },
        }),
        operationCalls: networkCalls,
        operationEffects: ["network"],
      },
    ).skills.invoke("guided-code-review", context, {});
    expect(networkResult).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(networkResult.status === "failed" && networkResult.failure.message).toContain(
      "web grant",
    );
    expect(networkCalls).not.toHaveBeenCalled();
  });

  it("retains explicit failure when a shared operation reports a provider error", async () => {
    const { skills } = runtimeFor(
      { turns: [[operationCall()]] },
      { operationFailure: new Error("provider failed after tool invocation") },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("provider failed");
  });

  it("runs no further tool work after a tool failure", async () => {
    const hostCalls = vi.fn(async () => "host evidence");
    const { skills, scripted } = runtimeFor(
      { turns: [[operationCall()], [hostCall]] },
      { operationFailure: new Error("provider failed"), hostTool: hostTool(hostCalls) },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(hostCalls).not.toHaveBeenCalled();
    expect(scripted.denials[0]?.reason).toContain("already failed");
  });

  it("preserves validated partial write data and operation identity in the terminal failure", async () => {
    const { skills, operationCalls } = runtimeFor(
      { turns: [[operationCall("test-create")]] },
      { partialOperationIds: ["test-create"] },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(operationCalls).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "failed",
      failure: {
        code: "TOOL_FAILED",
        operations: [
          {
            operationId: "test-create",
            status: "partial",
            data: { createdId: "CREATED-417", state: "created" },
            error: { name: "AttachmentUploadError", message: "Upload failed" },
          },
        ],
      },
    });
  });

  it("preserves a sibling skill's partial operation result through parent failure", async () => {
    const { skills, operationCalls } = runtimeFor(
      {
        turns: [[siblingCall]],
        nestedTurns: [[operationCall("test-create")]],
      },
      { partialOperationIds: ["test-create"] },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(operationCalls).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "failed",
      failure: {
        code: "TOOL_FAILED",
        operations: [
          {
            operationId: "test-create",
            status: "partial",
            data: { createdId: "CREATED-417", state: "created" },
          },
        ],
      },
    });
  });

  it("retains every partial write identity when concurrent calls include an ordinary failure", async () => {
    const operationIds = ["test-create-a", "test-create-b", "test-error"];
    let arrived = 0;
    let everyoneArrived: (() => void) | undefined;
    const allArrived = new Promise<void>((resolve) => {
      everyoneArrived = resolve;
    });
    const arrival = async () => {
      if (++arrived === operationIds.length) everyoneArrived?.();
      await allArrived;
    };
    const { skills, operationCalls } = runtimeFor(
      { turns: [operationIds.map((id) => operationCall(id))] },
      { partialOperationIds: operationIds, partialArrival: arrival },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(operationCalls).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "failed",
      failure: {
        code: "TOOL_FAILED",
        operations: [
          { operationId: "test-create-a", data: { createdId: "CREATED-417" } },
          { operationId: "test-create-b", data: { createdId: "CREATED-418" } },
        ],
      },
    });
  });

  it("retains explicit failure when a supplied host tool throws and the model reports completion", async () => {
    const { skills } = runtimeFor(
      { turns: [[hostCall]] },
      {
        hostTool: hostTool(async () => {
          throw new Error("host provider failed");
        }),
      },
    );

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("host provider failed");
  });

  it("applies the repository path guard to built-in tools and fails the run on a denial", async () => {
    const { skills, scripted } = runtimeFor({
      turns: [[{ name: "Read", input: { file_path: "/etc/passwd" } }]],
    });

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain(
      "outside the repository root",
    );
    expect(scripted.executedBuiltIns).toEqual([]);
  });

  it("fails the run when the model reaches for a tool outside the allowlist", async () => {
    const { skills, scripted } = runtimeFor({ turns: [[{ name: "Agent", input: {} }]] });

    const result = await skills.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(scripted.executedBuiltIns).toEqual([]);
  });

  it("returns an explicit failure for an error result and a query that ends without one", async () => {
    const maxTurns = await runtimeFor({
      turns: [],
      resultSubtype: "error_max_turns",
    }).skills.invoke("guided-code-review", context, {});
    expect(maxTurns).toMatchObject({ status: "failed", failure: { code: "EXECUTION_FAILED" } });
    expect(maxTurns.status === "failed" && maxTurns.failure.message).toContain("maxTurns");

    const thrown = await runtimeFor({
      turns: [],
      failure: new Error("provider down"),
    }).skills.invoke("guided-code-review", context, {});
    expect(thrown).toMatchObject({
      status: "failed",
      failure: { code: "EXECUTION_FAILED", message: "provider down" },
    });
  });

  it("returns an explicit cancellation when a running query is aborted", async () => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { skills, operationCalls } = runtimeFor({
      turns: [[operationCall()]],
      wait: async () => {
        started?.();
        await waiting;
      },
    });
    const controller = new AbortController();
    const execution = skills.invoke(
      "guided-code-review",
      context,
      {},
      { signal: controller.signal },
    );
    await running;
    controller.abort();
    release?.();

    const result = await execution;

    expect(result).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(operationCalls).not.toHaveBeenCalled();
  });

  it("retains the running invocation until an uncooperative operation handler settles after abort", async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    let settled = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { skills } = runtimeFor(
      { turns: [[operationCall()]] },
      {
        operationWait: async () => {
          entered?.();
          await gate;
        },
      },
    );
    const controller = new AbortController();
    const run = skills
      .invoke("guided-code-review", context, {}, { signal: controller.signal })
      .finally(() => {
        settled = true;
      });
    await started;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    release?.();

    const result = await run;

    expect(result).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(settled).toBe(true);
  });

  it("rejects construction without a standard model", () => {
    expect(
      () =>
        new ClaudeAgentSkillRuntime({
          instructions: instructionCatalog,
          agents,
          models: { escalated: "x" },
          operations: new MapOperationRegistry({
            operations: [],
            policy: new LaunchOperationAccessPolicy({ allowedOperationIds: [] }),
          }),
          workers: idleWorkers,
          observe: async () => snapshot(),
          toolGrants: () => ({}),
        }),
    ).toThrow("standard");
  });
});
