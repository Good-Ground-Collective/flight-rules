import { fileURLToPath } from "node:url";
import {
  AIMessage,
  HumanMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { tool, type StructuredTool } from "langchain";
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
import { DeepAgentsSkillRuntime, type DeepAgentsSkillRuntimeObserver } from "../skill-runtime.js";
import type { DeepAgentsWorkerRuntimeContract } from "../deepagents-runtime.js";
import { describe, expect, it, vi } from "vitest";

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
const workers: DeepAgentsWorkerRuntimeContract = {
  dispatch: async () => {
    throw new Error("This test does not dispatch a named worker.");
  },
  dispatchMany: async () => [],
};

class ScriptedSkillModel extends BaseChatModel {
  readonly prompts: string[] = [];
  private readonly firstTool: string;
  private readonly concurrentTool: string | undefined;
  private readonly nestedTool: string | undefined;
  private readonly followUpTool: string | undefined;
  private readonly operationId: string;
  private readonly operationIds: readonly string[];
  private readonly dispatchAgents: readonly string[];
  private readonly turns: readonly (readonly string[])[] | undefined;
  private readonly beforeResponse: (() => Promise<void>) | undefined;
  private readonly onStart: (() => void) | undefined;
  private toolCalls = 0;
  constructor(props: {
    firstTool: string;
    concurrentTool?: string;
    nestedTool?: string;
    followUpTool?: string;
    operationId?: string;
    operationIds?: readonly string[];
    dispatchAgents?: readonly string[];
    turns?: readonly (readonly string[])[];
    beforeResponse?: () => Promise<void>;
    onStart?: () => void;
  }) {
    super({});
    this.firstTool = props.firstTool;
    this.concurrentTool = props.concurrentTool;
    this.nestedTool = props.nestedTool;
    this.followUpTool = props.followUpTool;
    this.operationId = props.operationId ?? "test-read";
    this.operationIds = props.operationIds ?? [];
    this.dispatchAgents = props.dispatchAgents ?? [];
    this.turns = props.turns;
    this.beforeResponse = props.beforeResponse;
    this.onStart = props.onStart;
  }
  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    void tools;
    void kwargs;
    return this as unknown as Runnable<
      BaseLanguageModelInput,
      AIMessageChunk,
      BaseChatModelCallOptions
    >;
  }
  override _llmType(): string {
    return "flight-rules-skill-test";
  }
  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    void options;
    void runManager;
    this.onStart?.();
    await this.beforeResponse?.();
    const human = messages.find((message) => HumanMessage.isInstance(message))?.content;
    this.prompts.push(typeof human === "string" ? human : JSON.stringify(human));
    const nestedSkill = typeof human === "string" && human.includes('"nested":true');
    const name =
      nestedSkill && this.nestedTool !== undefined
        ? this.nestedTool
        : this.toolCalls === 0
          ? this.firstTool
          : this.toolCalls === 1
            ? this.followUpTool
            : undefined;
    const names =
      this.turns !== undefined
        ? (this.turns[this.toolCalls] ?? [])
        : name === undefined
          ? []
          : this.toolCalls === 0 && this.concurrentTool !== undefined
            ? [name, this.concurrentTool]
            : [name];
    const message =
      names.length === 0
        ? new AIMessage({ content: "The human answer was recorded." })
        : new AIMessage({
            content: "",
            tool_calls: names.map((toolName, index) => ({
              name: toolName,
              args:
                toolName === "flight_rules_operation"
                  ? {
                      operationId: this.operationIds[index] ?? this.operationId,
                      input: { value: "ok" },
                    }
                  : toolName === "flight_rules_sibling_skill"
                    ? { siblingSkill: "guided-code-review", input: { nested: true } }
                    : toolName === "flight_rules_dispatch"
                      ? {
                          agent: this.dispatchAgents[index] ?? "code-implementation",
                          dispatchId: "dependent-worker",
                          input: {},
                        }
                      : toolName === "unused_read"
                        ? {}
                        : { question: "May I continue?" },
              id: `skill-tool-call-${this.toolCalls}-${index}`,
              type: "tool_call",
            })),
          });
    if (name !== undefined || this.turns !== undefined) this.toolCalls++;
    return {
      generations: [{ text: typeof message.content === "string" ? message.content : "", message }],
    };
  }
}

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

function runtime(
  model: ScriptedSkillModel,
  observe: DeepAgentsSkillRuntimeObserver = vi.fn(async () => snapshot()),
  operationCalls = vi.fn(),
  options: {
    operationEffects?: OperationEffect[];
    operationFailure?: Error;
    operationWait?: () => Promise<void>;
    hostTool?: StructuredTool;
    workers?: DeepAgentsWorkerRuntimeContract;
  } = {},
): DeepAgentsSkillRuntime {
  const operation = {
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
  const operations = new MapOperationRegistry({
    operations: [operation],
    policy: new LaunchOperationAccessPolicy({ allowedOperationIds: ["test-read"] }),
  });
  const noOp =
    options.hostTool ??
    tool(async () => "unused", {
      name: "unused_read",
      description: "Unused host read",
      schema: z.object({}),
    });
  return new DeepAgentsSkillRuntime({
    instructions: instructionCatalog,
    agents,
    models: { standard: model, escalated: model, expert: model },
    operations,
    workers: options.workers ?? workers,
    observe,
    toolGrants: () => ({ read: [noOp] }),
  });
}

function partialOperationRuntime(
  model: ScriptedSkillModel,
  onWrite: (operationId: string) => void,
  operationIds: readonly string[] = ["test-create"],
) {
  const operations = new MapOperationRegistry({
    operations: operationIds.map((operationId, index) => ({
      id: operationId,
      description: "Create a record and report a later upload failure",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ createdId: z.string(), state: z.string() }),
      effects: ["write"] as OperationEffect[],
      cli: { path: ["test", "create", String(index)], aliases: [] },
      handler: () => {
        onWrite(operationId);
        if (operationId === "test-error") throw new Error("Post-write audit failed");
        return {
          status: "partial" as const,
          data: { createdId: `CREATED-${417 + index}`, state: "created" },
          error: { name: "AttachmentUploadError", message: "Upload failed" },
        };
      },
    })),
    policy: new LaunchOperationAccessPolicy({ allowedOperationIds: [...operationIds] }),
  });
  return new DeepAgentsSkillRuntime({
    instructions: instructionCatalog,
    agents,
    models: { standard: model, escalated: model, expert: model },
    operations,
    workers,
    observe: async () => snapshot(),
    toolGrants: () => ({}),
  });
}

describe("Deep Agents skill runtime", () => {
  it("loads the canonical body unchanged and invokes the shared operation in an actual graph", async () => {
    const model = new ScriptedSkillModel({ firstTool: "flight_rules_operation" });
    const calls = vi.fn();
    const graphRuntime = runtime(model, undefined, calls);
    const canonical = instructionCatalog.loadSkill("guided-code-review").contents;

    const result = await graphRuntime.invoke("guided-code-review", context, { focus: "contract" });

    expect(result.status).toBe("completed");
    expect(model.prompts).toHaveLength(2);
    expect(model.prompts[0]).toContain(canonical);
    expect(model.prompts[0]).toContain(JSON.stringify(context));
    expect(calls).toHaveBeenCalledWith({ value: "ok" });
  });

  it("runs sibling instructions with the same caller context in a separate skill invocation", async () => {
    const model = new ScriptedSkillModel({ firstTool: "flight_rules_sibling_skill" });
    const graphRuntime = runtime(model);

    const result = await graphRuntime.invoke("guided-code-review", context, { focus: "parent" });

    expect(result.status).toBe("completed");
    expect(model.prompts).toHaveLength(3);
    expect(model.prompts[1]).toContain(JSON.stringify(context));
    expect(model.prompts[1]).toContain('"nested":true');
  });

  it("observes each selected registered worker before dispatch", async () => {
    const observedRegistrations: (string | null)[] = [];
    const observe: DeepAgentsSkillRuntimeObserver = async (caller, registration) => {
      const name = registration?.frontmatter.name ?? null;
      observedRegistrations.push(name);
      return { ...snapshot(), context: caller, agent: name };
    };
    const dispatch = vi.fn<DeepAgentsWorkerRuntimeContract["dispatch"]>(async (request) => ({
      status: "completed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      report: { summary: "Completed", filesChanged: [], testsRun: [], approach: "Fixture" },
    }));
    const workerRuntime = { dispatch, dispatchMany: async () => [] };
    const invokeWorker = (agent: string) =>
      runtime(
        new ScriptedSkillModel({
          firstTool: "flight_rules_dispatch",
          dispatchAgents: [agent],
          turns: [["flight_rules_dispatch"]],
        }),
        observe,
        vi.fn(),
        { workers: workerRuntime },
      ).invoke("guided-code-review", context, {});

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
    const observe: DeepAgentsSkillRuntimeObserver = async (caller) => ({
      ...snapshot(),
      context: caller,
      agent: "code-implementation",
    });
    const dispatch = vi.fn<DeepAgentsWorkerRuntimeContract["dispatch"]>();
    const graphRuntime = runtime(
      new ScriptedSkillModel({
        firstTool: "flight_rules_dispatch",
        dispatchAgents: ["code-verifier"],
        turns: [["flight_rules_dispatch"]],
      }),
      observe,
      vi.fn(),
      { workers: { dispatch, dispatchMany: async () => [] } },
    );

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("CONTEXT_MISMATCH");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects dispatch when selected worker capabilities are denied", async () => {
    const observe: DeepAgentsSkillRuntimeObserver = async (caller, registration) => ({
      ...snapshot(),
      context: caller,
      agent: registration?.frontmatter.name ?? null,
      permissions: {
        ...snapshot().permissions,
        shell: { state: "denied", evidence: "No worker shell access", remedy: "Ask the host" },
      },
    });
    const dispatch = vi.fn<DeepAgentsWorkerRuntimeContract["dispatch"]>();
    const graphRuntime = runtime(
      new ScriptedSkillModel({
        firstTool: "flight_rules_dispatch",
        dispatchAgents: ["code-implementation"],
        turns: [["flight_rules_dispatch"]],
      }),
      observe,
      vi.fn(),
      { workers: { dispatch, dispatchMany: async () => [] } },
    );

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("CAPABILITY_DENIED");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("propagates a sibling question as the parent skill pause and resumes the nested checkpoint", async () => {
    const model = new ScriptedSkillModel({
      firstTool: "flight_rules_sibling_skill",
      nestedTool: "flight_rules_ask_human",
    });
    const graphRuntime = runtime(model);
    const paused = await graphRuntime.invoke(
      "guided-code-review",
      context,
      {},
      { allowHumanQuestions: true },
    );
    expect(paused).toMatchObject({ status: "paused", context, question: "May I continue?" });
    if (paused.status !== "paused")
      throw new Error("Expected a sibling question to pause its parent");

    const completed = await graphRuntime.resume({
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
  });

  it("requires opt-in and a supported channel before interrupt, then resumes the same checkpoint with the answer", async () => {
    const operationCalls = vi.fn();
    const model = new ScriptedSkillModel({
      firstTool: "flight_rules_ask_human",
      followUpTool: "flight_rules_operation",
    });
    const observe = vi.fn(async () => snapshot());
    const graphRuntime = runtime(model, observe, operationCalls);
    const denied = await graphRuntime.invoke("guided-code-review", context, {});
    expect(denied.status).toBe("failed");
    expect(denied.status === "failed" && denied.failure.message).toContain("QUESTIONS_DISABLED");
    expect(operationCalls).not.toHaveBeenCalled();

    const enabledModel = new ScriptedSkillModel({
      firstTool: "flight_rules_ask_human",
      concurrentTool: "flight_rules_operation",
      followUpTool: "flight_rules_operation",
    });
    const enabledRuntime = runtime(enabledModel, observe, operationCalls);
    const paused = await enabledRuntime.invoke(
      "guided-code-review",
      context,
      {},
      { allowHumanQuestions: true },
    );
    expect(paused).toMatchObject({ status: "paused", context, question: "May I continue?" });
    expect(operationCalls).not.toHaveBeenCalled();
    if (paused.status !== "paused") throw new Error("Expected a checkpointed question");
    const completed = await enabledRuntime.resume({
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
    expect(observe.mock.calls.length).toBeGreaterThanOrEqual(5);
    await expect(
      enabledRuntime.resume({
        context,
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "duplicate",
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["flight_rules_operation", false],
    ["flight_rules_operation", true],
    ["unused_read", false],
    ["unused_read", true],
    ["flight_rules_dispatch", false],
    ["flight_rules_dispatch", true],
  ])(
    "blocks %s alongside a sibling question with reversed call order %s",
    async (dependent, reversed) => {
      const batch = ["flight_rules_sibling_skill", dependent];
      const model = new ScriptedSkillModel({
        firstTool: "flight_rules_sibling_skill",
        turns: [reversed ? batch.toReversed() : batch, ["flight_rules_ask_human"], [dependent]],
      });
      const operationCalls = vi.fn();
      const hostCalls = vi.fn(async () => "host evidence");
      const dispatch = vi.fn<DeepAgentsWorkerRuntimeContract["dispatch"]>(async (request) => ({
        status: "completed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        report: { summary: "Completed", filesChanged: [], testsRun: [], approach: "Fixture" },
      }));
      const graphRuntime = runtime(
        model,
        async () => ({ ...snapshot(), agent: "code-implementation" }),
        operationCalls,
        {
          operationEffects: ["write"],
          hostTool: tool(hostCalls, {
            name: "unused_read",
            description: "Read host evidence",
            schema: z.object({}),
          }),
          workers: { dispatch, dispatchMany: async () => [] },
        },
      );

      const paused = await graphRuntime.invoke(
        "guided-code-review",
        context,
        {},
        {
          allowHumanQuestions: true,
        },
      );

      expect(paused).toMatchObject({ status: "paused", context });
      expect(operationCalls).not.toHaveBeenCalled();
      expect(hostCalls).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      if (paused.status !== "paused") throw new Error("Expected a sibling question");

      const resumed = await graphRuntime.resume({
        context,
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "Yes, continue.",
      });

      expect(resumed, JSON.stringify(resumed)).toMatchObject({
        status: "completed",
        invocationId: paused.invocationId,
      });
      const calls =
        dependent === "flight_rules_operation"
          ? operationCalls
          : dependent === "unused_read"
            ? hostCalls
            : dispatch;
      expect(calls).toHaveBeenCalledTimes(1);
      if (dependent === "flight_rules_dispatch") {
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ context }));
      }
    },
  );

  it("keeps successive sibling questions paused until each actual answer resumes their checkpoints", async () => {
    const operationCalls = vi.fn();
    const model = new ScriptedSkillModel({
      firstTool: "flight_rules_sibling_skill",
      turns: [
        ["flight_rules_sibling_skill", "flight_rules_operation"],
        ["flight_rules_ask_human"],
        ["flight_rules_ask_human"],
        ["flight_rules_operation"],
      ],
    });
    const graphRuntime = runtime(model, undefined, operationCalls, { operationEffects: ["write"] });
    const first = await graphRuntime.invoke(
      "guided-code-review",
      context,
      {},
      {
        allowHumanQuestions: true,
      },
    );
    expect(first.status).toBe("paused");
    expect(operationCalls).not.toHaveBeenCalled();
    if (first.status !== "paused") throw new Error("Expected the first sibling question");
    const second = await graphRuntime.resume({
      context,
      pauseId: first.pauseId,
      questionId: first.questionId,
      answer: "First answer",
    });
    expect(second).toMatchObject({ status: "paused", invocationId: first.invocationId });
    expect(operationCalls).not.toHaveBeenCalled();
    if (second.status !== "paused") throw new Error("Expected the second sibling question");
    expect(second.questionId).not.toBe(first.questionId);
    expect(second.pauseId).not.toBe(first.pauseId);
    await expect(
      graphRuntime.resume({
        context,
        pauseId: first.pauseId,
        questionId: first.questionId,
        answer: "Stale answer",
      }),
    ).rejects.toThrow();
    const completed = await graphRuntime.resume({
      context,
      pauseId: second.pauseId,
      questionId: second.questionId,
      answer: "Second answer",
    });
    expect(completed).toMatchObject({ status: "completed", invocationId: first.invocationId });
    expect(operationCalls).toHaveBeenCalledTimes(1);
  });

  it.each(["disabled", "unavailable"])(
    "blocks sibling-dependent writes when human questions are %s",
    async (policy) => {
      const operationCalls = vi.fn();
      const model = new ScriptedSkillModel({
        firstTool: "flight_rules_sibling_skill",
        turns: [
          ["flight_rules_sibling_skill", "flight_rules_operation"],
          ["flight_rules_ask_human"],
        ],
      });
      const observe = async (): Promise<RuntimeSnapshot> => ({
        ...snapshot(),
        ask:
          policy === "unavailable"
            ? { state: "denied", evidence: "No human channel", remedy: "Supply a channel" }
            : allowed,
      });
      const result = await runtime(model, observe, operationCalls, {
        operationEffects: ["write"],
      }).invoke("guided-code-review", context, {}, { allowHumanQuestions: policy !== "disabled" });

      expect(result.status).toBe("failed");
      expect(operationCalls).not.toHaveBeenCalled();
    },
  );

  it("rejects foreign and missing resume identities and explicitly cancels paused work", async () => {
    const model = new ScriptedSkillModel({ firstTool: "flight_rules_ask_human" });
    const graphRuntime = runtime(model);
    const paused = await graphRuntime.invoke(
      "guided-code-review",
      context,
      {},
      { allowHumanQuestions: true },
    );
    if (paused.status !== "paused") throw new Error("Expected a checkpointed question");
    await expect(
      graphRuntime.resume({
        context: { ...context, attempt: 2 },
        pauseId: paused.pauseId,
        questionId: paused.questionId,
        answer: "foreign",
      }),
    ).rejects.toThrow();
    await expect(
      graphRuntime.resume({
        context,
        pauseId: paused.pauseId,
        questionId: "stale-question",
        answer: "stale",
      }),
    ).rejects.toThrow();
    expect(graphRuntime.cancel(context, paused.pauseId)).toMatchObject({
      status: "failed",
      failure: { code: "CANCELLED" },
    });
  });

  it("returns an explicit cancellation when a running graph is aborted", async () => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const operationCalls = vi.fn();
    const model = new ScriptedSkillModel({
      firstTool: "flight_rules_operation",
      beforeResponse: () => waiting,
      onStart: () => started?.(),
    });
    const graphRuntime = runtime(model, undefined, operationCalls);
    const controller = new AbortController();
    const execution = graphRuntime.invoke(
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

  it("reserves a paused question before awaiting fresh access so concurrent resumes cannot share its checkpoint", async () => {
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
    const model = new ScriptedSkillModel({
      firstTool: "flight_rules_ask_human",
      followUpTool: "flight_rules_operation",
    });
    const graphRuntime = runtime(model, observe);
    const paused = await graphRuntime.invoke(
      "guided-code-review",
      context,
      {},
      { allowHumanQuestions: true },
    );
    if (paused.status !== "paused") throw new Error("Expected a checkpointed question");
    racing = true;
    const request = {
      context,
      pauseId: paused.pauseId,
      questionId: paused.questionId,
      answer: "Yes",
    };
    const first = graphRuntime.resume(request);
    await observing;
    await expect(graphRuntime.resume(request)).rejects.toThrow("missing, stale or does not match");
    release?.();
    await expect(first).resolves.toMatchObject({
      status: "completed",
      invocationId: paused.invocationId,
    });
  });

  it("rejects every unavailable operation effect before the shared handler runs", async () => {
    const model = new ScriptedSkillModel({ firstTool: "flight_rules_operation" });
    const calls = vi.fn();
    const limited = {
      ...snapshot(),
      permissions: {
        ...snapshot().permissions,
        shell: { state: "denied", evidence: "No shell grant", remedy: "Ask host" },
        web: { state: "denied", evidence: "No web grant", remedy: "Ask host" },
      },
    } satisfies RuntimeSnapshot;
    const graphRuntime = runtime(model, async () => limited, calls, {
      operationEffects: ["write", "process", "network"],
    });

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("shell grant");
    expect(calls).not.toHaveBeenCalled();

    const webDenied = {
      ...snapshot(),
      permissions: {
        ...snapshot().permissions,
        web: { state: "denied", evidence: "No network grant", remedy: "Ask host" },
      },
    } satisfies RuntimeSnapshot;
    const networkCalls = vi.fn();
    const networkRuntime = runtime(
      new ScriptedSkillModel({ firstTool: "flight_rules_operation" }),
      async () => webDenied,
      networkCalls,
      { operationEffects: ["network"] },
    );
    const networkResult = await networkRuntime.invoke("guided-code-review", context, {});
    expect(networkResult).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(networkResult.status === "failed" && networkResult.failure.message).toContain(
      "web grant",
    );
    expect(networkCalls).not.toHaveBeenCalled();
  });

  it("retains explicit failure when a shared operation reports a provider error", async () => {
    const graphRuntime = runtime(
      new ScriptedSkillModel({ firstTool: "flight_rules_operation" }),
      undefined,
      vi.fn(),
      { operationFailure: new Error("provider failed after tool invocation") },
    );

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("provider failed");
  });

  it("preserves validated partial write data and operation identity in the terminal failure", async () => {
    const write = vi.fn();
    const graphRuntime = partialOperationRuntime(
      new ScriptedSkillModel({ firstTool: "flight_rules_operation", operationId: "test-create" }),
      write,
    );

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(write).toHaveBeenCalledOnce();
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
    const write = vi.fn();
    const graphRuntime = partialOperationRuntime(
      new ScriptedSkillModel({
        firstTool: "flight_rules_sibling_skill",
        nestedTool: "flight_rules_operation",
        operationId: "test-create",
      }),
      write,
    );

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(write).toHaveBeenCalledOnce();
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

  it("retains every partial write identity when concurrent calls include an ordinary failure", async () => {
    const write = vi.fn();
    const operationIds = ["test-create-a", "test-create-b", "test-error"];
    const graphRuntime = partialOperationRuntime(
      new ScriptedSkillModel({
        firstTool: "flight_rules_operation",
        operationIds,
        turns: [["flight_rules_operation", "flight_rules_operation", "flight_rules_operation"]],
      }),
      write,
      operationIds,
    );

    const result = await graphRuntime.invoke("guided-code-review", context, {});

    expect(write).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "failed",
      failure: {
        code: "TOOL_FAILED",
        operations: [
          {
            operationId: "test-create-a",
            status: "partial",
            data: { createdId: "CREATED-417", state: "created" },
          },
          {
            operationId: "test-create-b",
            status: "partial",
            data: { createdId: "CREATED-418", state: "created" },
          },
        ],
      },
    });
  });

  it("retains explicit failure when a supplied host tool throws and the model reports completion", async () => {
    const failedTool = tool(
      async () => {
        throw new Error("host provider failed");
      },
      {
        name: "unused_read",
        description: "Read host evidence",
        schema: z.object({}),
      },
    );
    const result = await runtime(
      new ScriptedSkillModel({ firstTool: "unused_read" }),
      undefined,
      vi.fn(),
      { hostTool: failedTool },
    ).invoke("guided-code-review", context, {});

    expect(result).toMatchObject({ status: "failed", failure: { code: "TOOL_FAILED" } });
    expect(result.status === "failed" && result.failure.message).toContain("host provider failed");
  });

  it("retains the running invocation until an uncooperative operation handler settles after abort", async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    let sideEffectCount = 0;
    let settled = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const operationCalls = vi.fn(() => {
      sideEffectCount++;
    });
    const graphRuntime = runtime(
      new ScriptedSkillModel({ firstTool: "flight_rules_operation" }),
      undefined,
      operationCalls,
      {
        operationWait: async () => {
          entered?.();
          await gate;
          sideEffectCount++;
        },
      },
    );
    const controller = new AbortController();
    const run = graphRuntime
      .invoke("guided-code-review", context, {}, { signal: controller.signal })
      .finally(() => {
        settled = true;
      });
    await started;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();

    const result = await run;

    expect(result).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(settled).toBe(true);
    expect(sideEffectCount).toBeGreaterThanOrEqual(1);
  });
});
