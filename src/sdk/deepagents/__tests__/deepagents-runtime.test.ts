import { fileURLToPath } from "node:url";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type { AIMessageChunk } from "@langchain/core/messages";
import { tool } from "langchain";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import type {
  DispatchRequest,
  RuntimeSnapshot,
} from "../../../orchestration/orchestration.schema.js";
import {
  DeepAgentsConfigurationError,
  LangChainDeepAgentsWorkerRuntime,
} from "../deepagents-runtime.js";
import { flightRulesAbortSignalConfigKey } from "../tool-policy.js";

const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../../agents", import.meta.url)),
);
const context = {
  runId: "deepagents-test",
  taskId: "worker-contract",
  cwd: "/repo",
  repositoryRoot: "/repo",
  baseRef: "main",
  skill: "execute-work",
  attempt: 1,
};
const available = {
  state: "available",
  evidence: "Host observed this capability for the active checkout.",
} as const;

class ScriptedModel extends BaseChatModel {
  readonly advertisedTools: string[][] = [];
  readonly prompts: string[] = [];
  readonly invocations: string[] = [];
  completed = 0;
  private readonly response: string;
  private readonly delay: (prompt: string) => number;
  private readonly toolCall: string | undefined;

  constructor(props: { response: string; delay?: (prompt: string) => number; toolCall?: string }) {
    super({});
    this.response = props.response;
    this.delay = props.delay ?? (() => 0);
    this.toolCall = props.toolCall;
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    this.advertisedTools.push(
      tools.map((value) => ("name" in value ? String(value.name) : "unknown")),
    );
    void kwargs;
    return this as unknown as Runnable<
      BaseLanguageModelInput,
      AIMessageChunk,
      BaseChatModelCallOptions
    >;
  }

  override _llmType(): string {
    return "flight-rules-scripted-test-model";
  }

  override async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    void _options;
    void _runManager;
    const prompt = messages.find((message) => HumanMessage.isInstance(message))?.content;
    const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    this.prompts.push(promptText);
    this.invocations.push(promptText);
    const delay = this.delay(promptText);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.completed++;
    const message =
      this.toolCall === undefined || messages.some((item) => ToolMessage.isInstance(item))
        ? new AIMessage({ content: this.response })
        : new AIMessage({
            content: "",
            tool_calls: [
              {
                name: this.toolCall,
                args: { file_path: "/repo/output.ts", content: "changed" },
                id: "hallucinated-call",
                type: "tool_call",
              },
            ],
          });
    return {
      generations: [{ text: typeof message.content === "string" ? message.content : "", message }],
    };
  }
}

function runtimeSnapshot(request: DispatchRequest): RuntimeSnapshot {
  return {
    context: request.context,
    host: { name: "test-host", version: "1" },
    observedAt: new Date().toISOString(),
    agent: request.agent,
    spawn: available,
    ask: available,
    permissions: {
      read: available,
      edit: available,
      shell: available,
      web: available,
      spawn: available,
      ask: available,
    },
    limits: {
      maxConcurrent: 3,
      activeWorkers: 0,
      currentDepth: 0,
      maxDepth: 1,
      source: "Test host observation",
    },
  };
}

function request(id: string, agent: string, mode: string): DispatchRequest {
  return { id, agent, context, input: { mode, focus: id } };
}

const implementationReport =
  "```yaml\nsummary: Done\nfilesChanged: []\ntestsRun: []\napproach: Scripted report\n```";
const verificationReport =
  "```yaml\nsummary: Verified\ncriteria:\n  - criterion: Contract works\n    verdict: PASS\n    evidence: The actual graph returned this report\nverified: true\n```";
const qaVerificationReport =
  "```yaml\nsummary: Verified\nitems: []\nevidence:\n  dir: /tmp/evidence\n  items: []\nverified: true\n```";
const researchReport =
  "```yaml\nsummary: Findings\nconfidence: high\ninternal:\n  files: []\n  patterns: []\n  integrationPoints: []\n  risks: []\n```";
const reproduceReport =
  "```yaml\nsummary: Reproduced\nreproduced: false\nreason: No symptom in fixture\nevidence:\n  dir: /tmp/evidence\n  items: []\n```";
const authorReport =
  "```yaml\nsummary: Authored\nwhatWasChanged:\n  - Wrote the requested artifact\nwhyWasItChanged: The contract requested it\notsMaterials: No additional materials\n```";

describe("Deep Agents worker runtime", () => {
  it.each([
    ["code-implementation", "implement", "standard", implementationReport],
    ["code-implementation-escalated", "implement", "escalated", implementationReport],
    ["code-verifier", "verify", "standard", verificationReport],
    ["research-agent", "internal", "escalated", researchReport],
    ["qa-engineer", "reproduce", "escalated", reproduceReport],
    ["qa-engineer-verify", "verify", "standard", qaVerificationReport],
    ["tech-writer", "author", "escalated", authorReport],
  ])("runs the named %s registration on its bound %s tier", async (agent, mode, tier, report) => {
    const standard = new ScriptedModel({ response: report });
    const escalated = new ScriptedModel({ response: report });
    const expert = new ScriptedModel({ response: report });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard, escalated, expert },
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });

    const outcome = await workers.dispatch(request(`dispatch-${agent}`, agent, mode));

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "completed",
      agent,
      dispatchId: `dispatch-${agent}`,
      context,
    });
    const expectedModel =
      tier === "standard" ? standard : tier === "escalated" ? escalated : expert;
    expect(expectedModel.invocations).toHaveLength(1);
    expect([standard, escalated, expert].filter((model) => model.invocations.length > 0)).toEqual([
      expectedModel,
    ]);
    expect(expectedModel.prompts[0]).toContain(
      agents.find((entry) => entry.frontmatter.name === agent)?.body.trim(),
    );
  });

  it("does not advertise write, execute or task tools to a read-only graph and rejects a hallucinated write before execution", async () => {
    const model = new ScriptedModel({ response: "", toolCall: "write_file" });
    let backingCalls = 0;
    const hostWriteTool = tool(
      async () => {
        backingCalls++;
        return "host write ran";
      },
      {
        name: "repository_write",
        description: "Write to the active checkout",
        schema: z.object({}),
      },
    );
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: { read: [], edit: [hostWriteTool] },
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });

    const outcome = await workers.dispatch(request("readonly", "tech-writer", "author"));

    expect(model.advertisedTools.at(-1)).toEqual(
      expect.arrayContaining(["read_file", "ls", "glob", "grep"]),
    );
    expect(model.advertisedTools.at(-1)).not.toEqual(
      expect.arrayContaining([
        "write_file",
        "edit_file",
        "delete",
        "execute",
        "task",
        "repository_write",
      ]),
    );
    expect(backingCalls).toBe(0);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "failed",
      failure: { code: "CAPABILITY_DENIED", capability: "edit" },
    });
  });

  it("executes only a host tool covered by both the named worker and the observed grant", async () => {
    let backingCalls = 0;
    const repositoryReadTool = tool(
      async () => {
        backingCalls++;
        return "Repository contents";
      },
      { name: "repository_read", description: "Read the active checkout", schema: z.object({}) },
    );
    const model = new ScriptedModel({ response: authorReport, toolCall: "repository_read" });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: { read: [repositoryReadTool] },
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });

    const outcome = await workers.dispatch(request("permitted-read", "tech-writer", "author"));

    expect(outcome.status).toBe("completed");
    expect(backingCalls).toBe(1);
    expect(model.advertisedTools[0]).toContain("repository_read");
  });

  it("keeps actual graph concurrency bounded and returns reports in input order", async () => {
    let active = 0;
    let peak = 0;
    const delayed = new ScriptedModel({ response: authorReport });
    const selectedModel = new InstrumentedDelayModel({
      model: delayed,
      onStart: () => {
        active++;
        peak = Math.max(peak, active);
      },
      onFinish: () => {
        active--;
      },
    });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: selectedModel, escalated: selectedModel, expert: selectedModel },
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });
    const requests = [
      request("slow", "tech-writer", "author"),
      request("fast", "tech-writer", "author"),
      request("last", "tech-writer", "author"),
    ];

    const outcomes = await workers.dispatchMany(requests, { maxConcurrent: 2 });

    expect(outcomes.map((outcome) => outcome.dispatchId)).toEqual(["slow", "fast", "last"]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });

  it("cancels queued requests and keeps the running reservation until its graph stops", async () => {
    const model = new ScriptedModel({ response: authorReport, delay: () => 50 });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });
    const controller = new AbortController();
    const pending = workers.dispatchMany(
      [request("running", "tech-writer", "author"), request("queued", "tech-writer", "author")],
      { maxConcurrent: 1, signal: controller.signal },
    );
    await vi.waitFor(() => expect(model.invocations).toHaveLength(1));
    controller.abort();

    const outcomes = await pending;

    expect(outcomes.map((outcome) => [outcome.dispatchId, outcome.status])).toEqual([
      ["running", "failed"],
      ["queued", "failed"],
    ]);
    expect(outcomes.map((outcome) => outcome.status === "failed" && outcome.failure.code)).toEqual([
      "CANCELLED",
      "CANCELLED",
    ]);
    expect(model.completed).toBe(1);
  });

  it("shares host capacity across overlapping dispatch calls until an aborted model promise settles", async () => {
    const model = new ScriptedModel({ response: authorReport, delay: () => 100 });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: {},
      observe: async (dispatch) => ({
        ...runtimeSnapshot(dispatch),
        limits: { ...runtimeSnapshot(dispatch).limits, maxConcurrent: 1 },
      }),
    });
    const controller = new AbortController();
    const first = workers.dispatch(request("overlap-first", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(model.invocations).toHaveLength(1));
    controller.abort();
    const second = workers.dispatch(request("overlap-second", "tech-writer", "author"));

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(model.invocations).toHaveLength(1);
    expect(model.completed).toBe(0);

    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(secondOutcome).toMatchObject({ status: "completed", dispatchId: "overlap-second" });
    expect(model.invocations).toHaveLength(2);
    expect(model.completed).toBe(2);
  });

  it("keeps capacity reserved until an aborted host tool promise settles", async () => {
    let releaseFirstTool: (() => void) | undefined;
    let toolAbortSignal: AbortSignal | undefined;
    let toolCalls = 0;
    const repositoryReadTool = tool(
      async (_input, runtime) => {
        toolCalls++;
        const configuredSignal = runtime.configurable?.[flightRulesAbortSignalConfigKey];
        if (configuredSignal instanceof AbortSignal) toolAbortSignal = configuredSignal;
        if (toolCalls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstTool = resolve;
          });
        }
        return "Repository contents";
      },
      { name: "repository_read", description: "Read the active checkout", schema: z.object({}) },
    );
    const model = new ScriptedModel({ response: authorReport, toolCall: "repository_read" });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: { read: [repositoryReadTool] },
      observe: async (dispatch) => {
        const snapshot = runtimeSnapshot(dispatch);
        return { ...snapshot, limits: { ...snapshot.limits, maxConcurrent: 1 } };
      },
    });
    const controller = new AbortController();
    const first = workers.dispatch(request("pending-tool-first", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(toolCalls).toBe(1));
    controller.abort();
    expect(toolAbortSignal?.aborted).toBe(true);
    const second = workers.dispatch(request("pending-tool-second", "tech-writer", "author"));

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(model.prompts.filter((prompt) => prompt.includes("pending-tool-second"))).toHaveLength(
      0,
    );
    expect(toolCalls).toBe(1);

    releaseFirstTool?.();
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(secondOutcome).toMatchObject({ status: "completed", dispatchId: "pending-tool-second" });
    expect(toolCalls).toBe(2);
  });

  it("propagates caller cancellation to cooperative host tools", async () => {
    let toolAbortSignal: AbortSignal | undefined;
    const repositoryReadTool = tool(
      async (_input, runtime) => {
        const configuredSignal = runtime.configurable?.[flightRulesAbortSignalConfigKey];
        if (configuredSignal instanceof AbortSignal) toolAbortSignal = configuredSignal;
        await new Promise<void>((resolve) => {
          if (toolAbortSignal?.aborted) {
            resolve();
          } else {
            toolAbortSignal?.addEventListener("abort", () => resolve(), { once: true });
          }
        });
        return "The host operation stopped";
      },
      { name: "repository_read", description: "Read the active checkout", schema: z.object({}) },
    );
    const model = new ScriptedModel({ response: authorReport, toolCall: "repository_read" });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: { read: [repositoryReadTool] },
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });
    const controller = new AbortController();
    const pending = workers.dispatch(request("cooperative-tool", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(toolAbortSignal).toBeDefined());
    controller.abort();

    const outcome = await pending;

    expect(toolAbortSignal?.aborted).toBe(true);
    expect(outcome).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
  });

  it("returns named failures for unknown workers and malformed reports without model escalation", async () => {
    const model = new ScriptedModel({ response: "```yaml\nsummary: Missing fields\n```" });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });

    const unknown = await workers.dispatch(request("unknown", "unregistered-worker", "author"));
    const malformed = await workers.dispatch(request("malformed", "tech-writer", "author"));
    const invalidMode = await workers.dispatch(
      request("invalid-mode", "tech-writer", "unsupported"),
    );

    expect(unknown).toMatchObject({ status: "unavailable", failure: { code: "UNKNOWN_AGENT" } });
    expect(malformed).toMatchObject({
      status: "failed",
      failure: { code: "INVALID_REPORT" },
      context,
    });
    expect(invalidMode).toMatchObject({ status: "failed", failure: { code: "INVALID_REPORT" } });
    expect(model.invocations).toHaveLength(1);
  });

  it("rejects an invalid caller context before starting a graph", async () => {
    const model = new ScriptedModel({ response: authorReport });
    const workers = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });

    await expect(
      workers.dispatch({
        ...request("invalid-context", "tech-writer", "author"),
        context: { ...context, cwd: "/elsewhere" },
      }),
    ).rejects.toThrow();
    expect(model.invocations).toHaveLength(0);
  });

  it("rejects missing tier models at construction and retains E4 restriction and limit failures", async () => {
    const model = new ScriptedModel({ response: authorReport });
    expect(
      () =>
        new LangChainDeepAgentsWorkerRuntime({
          agents,
          models: { standard: model, escalated: model } as never,
          toolGrants: {},
          observe: async (dispatch) => runtimeSnapshot(dispatch),
        }),
    ).toThrow(DeepAgentsConfigurationError);

    const restrictedAgents = agents.map((agent) =>
      agent.frontmatter.name === "tech-writer"
        ? {
            ...agent,
            frontmatter: { ...agent.frontmatter, dispatch: { maxConcurrent: 1, maxDepth: 1 } },
          }
        : agent,
    );
    const restrictedWorkers = new LangChainDeepAgentsWorkerRuntime({
      agents: restrictedAgents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
    });
    const restricted = await restrictedWorkers.dispatch(
      request("restricted", "tech-writer", "author"),
    );

    const unknownLimits = new LangChainDeepAgentsWorkerRuntime({
      agents,
      models: { standard: model, escalated: model, expert: model },
      toolGrants: {},
      observe: async (dispatch) => {
        const snapshot = runtimeSnapshot(dispatch);
        return { ...snapshot, limits: { ...snapshot.limits, maxConcurrent: null, maxDepth: null } };
      },
    });
    const limited = await unknownLimits.dispatch(
      request("unknown-limits", "tech-writer", "author"),
    );

    expect(restricted).toMatchObject({
      status: "unavailable",
      failure: { code: "UNSUPPORTED_AGENT_SETTINGS" },
    });
    expect(limited).toMatchObject({ status: "unavailable", failure: { code: "LIMITS_UNKNOWN" } });
    expect(model.invocations).toHaveLength(0);
  });
});

function asyncDelay(prompt: string): number {
  return prompt.includes('"slow"') ? 25 : 1;
}

class InstrumentedDelayModel extends BaseChatModel {
  private readonly model: ScriptedModel;
  private readonly onStart: () => void;
  private readonly onFinish: () => void;

  constructor(props: { model: ScriptedModel; onStart: () => void; onFinish: () => void }) {
    super({});
    this.model = props.model;
    this.onStart = props.onStart;
    this.onFinish = props.onFinish;
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
    return "flight-rules-instrumented-delay-model";
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.onStart();
    try {
      const result = await this.model._generate(messages, options, runManager);
      const human = messages.find((message) => HumanMessage.isInstance(message))?.content;
      const prompt = typeof human === "string" ? human : JSON.stringify(human);
      const delay = asyncDelay(prompt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return result;
    } finally {
      this.onFinish();
    }
  }
}
