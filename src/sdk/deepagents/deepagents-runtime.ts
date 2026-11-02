import { createDeepAgent } from "deepagents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { tool, type StructuredTool } from "langchain";
import { z } from "zod";
import { AgentDefinitionSchema } from "../../agents/agent-emitter/agent-emitter.schema.js";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type {
  DispatchOutcome,
  DispatchRequest,
  RuntimeSnapshot,
} from "../../orchestration/orchestration.schema.js";
import type { ValidatedWorkerReport } from "../report-codec.js";
import {
  QueuedWorkerDispatcher,
  WorkerDispatchConfigurationError,
  workerRunProtocol,
  type AdmittedDispatch,
  type BatchDispatchOptions,
  type DispatchOptions,
  type WorkerRuntimeContract,
} from "../worker-runtime-core.js";
import {
  CapabilityScopedDeepAgentsToolPolicy,
  flightRulesAbortSignalConfigKey,
  type CapabilityToolDeniedError,
  type DeepAgentsToolPolicyContract,
  type WorkerToolGrants,
} from "./tool-policy.js";

export interface ModelExecutionTracker {
  waitForIdle(): Promise<void>;
}

class InFlightModelTracker extends BaseCallbackHandler implements ModelExecutionTracker {
  override name = "FlightRulesModelExecutionTracker";
  private readonly activeRuns = new Set<string | symbol>();
  private nextExecution = 0;
  private idleWaiters: Array<() => void> = [];

  override handleChatModelStart(_model: unknown, _messages: unknown, runId: string): void {
    this.activeRuns.add(runId);
  }

  override handleLLMEnd(_result: LLMResult, runId: string): void {
    this.finishRun(runId);
  }

  override handleLLMError(_error: Error, runId: string): void {
    this.finishRun(runId);
  }

  async track<T>(execution: () => Promise<T>): Promise<T> {
    const executionId = Symbol(`tool-${this.nextExecution++}`);
    this.activeRuns.add(executionId);
    try {
      return await execution();
    } finally {
      this.finishRun(executionId);
    }
  }

  waitForIdle(): Promise<void> {
    if (this.activeRuns.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private finishRun(runId: string | symbol): void {
    this.activeRuns.delete(runId);
    if (this.activeRuns.size === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}

const ModelInstancesSchema = z.strictObject({
  standard: z.instanceof(BaseChatModel),
  escalated: z.instanceof(BaseChatModel),
  expert: z.instanceof(BaseChatModel),
});
const DeepAgentsRuntimePropsSchema = z.strictObject({
  agents: z.array(AgentDefinitionSchema).min(1),
  models: ModelInstancesSchema,
  toolGrants: z.record(
    z.string(),
    z.array(
      z.custom<StructuredTool>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "name" in value &&
          typeof value.name === "string" &&
          "invoke" in value &&
          typeof value.invoke === "function",
      ),
    ),
  ),
  observe: z.custom<(request: DispatchRequest) => Promise<RuntimeSnapshot>>(
    (value) => typeof value === "function",
  ),
  maxGraphSteps: z.int().positive().default(64),
});

export type DeepAgentsRuntimeProps = z.input<typeof DeepAgentsRuntimePropsSchema>;
export type { BatchDispatchOptions, DispatchOptions };

export class DeepAgentsConfigurationError extends WorkerDispatchConfigurationError {
  override name = "DeepAgentsConfigurationError";
}

export type DeepAgentsWorkerRuntimeContract = WorkerRuntimeContract;

/** Runs canonical worker registrations as isolated Deep Agents graphs under current host evidence. */
export class LangChainDeepAgentsWorkerRuntime implements DeepAgentsWorkerRuntimeContract {
  private readonly agents: AgentDefinition[];
  private readonly models: z.output<typeof ModelInstancesSchema>;
  private readonly toolGrants: WorkerToolGrants;
  private readonly maxGraphSteps: number;
  private readonly toolPolicy: DeepAgentsToolPolicyContract =
    new CapabilityScopedDeepAgentsToolPolicy();
  private readonly dispatcher: QueuedWorkerDispatcher;

  constructor(props: DeepAgentsRuntimeProps) {
    const parsed = DeepAgentsRuntimePropsSchema.safeParse(props);
    if (!parsed.success) {
      throw new DeepAgentsConfigurationError(parsed.error.message);
    }
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.models = Object.freeze({ ...parsed.data.models });
    this.toolGrants = parsed.data.toolGrants;
    this.maxGraphSteps = parsed.data.maxGraphSteps;

    const tiers = new Set(this.agents.map((agent) => agent.frontmatter.model));
    for (const tier of tiers) {
      if (this.models[tier] === undefined) {
        throw new DeepAgentsConfigurationError(`No model instance is bound for the ${tier} tier.`);
      }
    }

    this.dispatcher = new QueuedWorkerDispatcher({
      agents: this.agents,
      observe: parsed.data.observe,
      run: (admission, snapshot, signal) => this.runGraph(admission, snapshot, signal),
      createError: (message) => new DeepAgentsConfigurationError(message),
    });
  }

  dispatch(
    request: DispatchRequest,
    options: DispatchOptions = {},
  ): Promise<DispatchOutcome<ValidatedWorkerReport>> {
    return this.dispatcher.dispatch(request, options);
  }

  dispatchMany(
    requests: DispatchRequest[],
    options: BatchDispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>[]> {
    return this.dispatcher.dispatchMany(requests, options);
  }

  private async runGraph(
    admission: AdmittedDispatch,
    snapshot: RuntimeSnapshot,
    signal: AbortSignal,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>> {
    const { request, definition } = admission;
    const prepared = workerRunProtocol.prepare(admission);
    if (prepared.status === "rejected") return prepared.outcome;

    const model = this.models[definition.frontmatter.model];
    const hostTools = this.toolPolicy.toolsFor(definition, this.toolGrants, snapshot);
    const modelTracker = new InFlightModelTracker();
    const trackedTools = hostTools.map((hostTool) =>
      tool(
        (input, runtime) => {
          const hostRuntime = {
            ...runtime,
            signal: new AbortController().signal,
            configurable: {
              ...runtime.configurable,
              [flightRulesAbortSignalConfigKey]: signal,
            },
          };
          return modelTracker.track(() => hostTool.invoke(input, hostRuntime));
        },
        {
          name: hostTool.name,
          description: hostTool.description,
          schema: hostTool.schema,
        },
      ),
    );
    let capabilityFailure: CapabilityToolDeniedError | undefined;
    const middleware = this.toolPolicy.middlewareFor(
      model,
      definition,
      hostTools,
      (execution) => modelTracker.track(execution),
      (error) => {
        capabilityFailure = error;
      },
    );
    const graph = createDeepAgent({
      model,
      tools: trackedTools,
      middleware,
      name: request.agent,
    });
    let result: Awaited<ReturnType<typeof graph.invoke>>;
    try {
      result = await graph.invoke(
        { messages: [new HumanMessage(prepared.prompt)] },
        {
          recursionLimit: this.maxGraphSteps,
          signal,
          callbacks: [modelTracker],
        },
      );
    } catch (cause) {
      if (capabilityFailure !== undefined) {
        return workerRunProtocol.failed(
          request,
          workerRunProtocol.executionFailure(capabilityFailure, signal),
        );
      }
      throw cause;
    } finally {
      await modelTracker.waitForIdle();
    }
    if (signal.aborted) return workerRunProtocol.cancelled(request);
    const finalMessage = result.messages.toReversed().find((message) => isAIMessage(message));
    if (finalMessage === undefined || typeof finalMessage.content !== "string") {
      throw new DeepAgentsConfigurationError("Deep Agents returned no final text report.");
    }

    return workerRunProtocol.finish(request, finalMessage.content, prepared.mode);
  }
}
