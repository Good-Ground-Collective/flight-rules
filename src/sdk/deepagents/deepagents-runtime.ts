import { createDeepAgent } from "deepagents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { tool, type StructuredTool } from "langchain";
import { z } from "zod";
import { AgentDefinitionSchema } from "../../agents/agent-emitter/agent-emitter.schema.js";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import { BoundedDispatchQueue } from "../../orchestration/dispatch-queue.js";
import {
  RuntimeSnapshotSchema,
  DispatchRequestSchema,
  type DispatchOutcome,
  type DispatchRequest,
  type OrchestrationFailure,
  type RuntimeSnapshot,
} from "../../orchestration/orchestration.schema.js";
import {
  WorkerReportCodec,
  ReportModeSchema,
  type ValidatedWorkerReport,
} from "../report-codec.js";
import {
  CapabilityToolDeniedError,
  CapabilityScopedDeepAgentsToolPolicy,
  flightRulesAbortSignalConfigKey,
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
export interface DispatchOptions {
  signal?: AbortSignal;
}
export interface BatchDispatchOptions extends DispatchOptions {
  maxConcurrent: number;
}

export class DeepAgentsConfigurationError extends Error {
  override name = "DeepAgentsConfigurationError";
}

export interface DeepAgentsWorkerRuntimeContract {
  dispatch(
    request: DispatchRequest,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>>;
  dispatchMany(
    requests: DispatchRequest[],
    options: BatchDispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
}

/** Runs canonical worker registrations as isolated Deep Agents graphs under current host evidence. */
export class LangChainDeepAgentsWorkerRuntime implements DeepAgentsWorkerRuntimeContract {
  private readonly agents: AgentDefinition[];
  private readonly models: z.output<typeof ModelInstancesSchema>;
  private readonly toolGrants: WorkerToolGrants;
  private readonly observe: (request: DispatchRequest) => Promise<RuntimeSnapshot>;
  private readonly maxGraphSteps: number;
  private readonly toolPolicy: DeepAgentsToolPolicyContract =
    new CapabilityScopedDeepAgentsToolPolicy();
  private readonly reports = new WorkerReportCodec();
  private readonly activeExecutions = new Map<symbol, Promise<void>>();

  constructor(props: DeepAgentsRuntimeProps) {
    const parsed = DeepAgentsRuntimePropsSchema.safeParse(props);
    if (!parsed.success) {
      throw new DeepAgentsConfigurationError(parsed.error.message);
    }
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.models = Object.freeze({ ...parsed.data.models });
    this.toolGrants = parsed.data.toolGrants;
    this.observe = parsed.data.observe;
    this.maxGraphSteps = parsed.data.maxGraphSteps;

    const tiers = new Set(this.agents.map((agent) => agent.frontmatter.model));
    for (const tier of tiers) {
      if (this.models[tier] === undefined) {
        throw new DeepAgentsConfigurationError(`No model instance is bound for the ${tier} tier.`);
      }
    }
  }

  async dispatch(
    request: DispatchRequest,
    options: DispatchOptions = {},
  ): Promise<DispatchOutcome<ValidatedWorkerReport>> {
    const [outcome] = await this.dispatchMany([request], { maxConcurrent: 1, ...options });
    if (outcome === undefined)
      throw new DeepAgentsConfigurationError("Single dispatch completed without an outcome.");
    return outcome;
  }

  async dispatchMany(
    requests: DispatchRequest[],
    options: BatchDispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>[]> {
    const validatedRequests = z.array(DispatchRequestSchema).parse(requests);
    const queue = new BoundedDispatchQueue({
      agents: this.agents,
      requests: validatedRequests,
      maxConcurrent: options.maxConcurrent,
    });
    const active = new Map<string, { reservation: symbol; promise: Promise<void> }>();
    const controllers = new Map<string, AbortController>();
    const settledOutcomes = new Map<string, DispatchOutcome<ValidatedWorkerReport>>();
    let wakeCancellationWait!: () => void;
    const cancellationWait = new Promise<void>((resolve) => {
      wakeCancellationWait = resolve;
    });
    const cancelActive = () => {
      wakeCancellationWait();
      queue.cancel();
      for (const controller of controllers.values()) controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", cancelActive, { once: true });

    try {
      while (queue.results() === undefined) {
        if (options.signal?.aborted) cancelActive();

        const next = queue.pending();
        if (next === undefined) {
          if (active.size === 0) break;
          await Promise.race([...active.values()].map((entry) => entry.promise));
          continue;
        }
        const snapshot = RuntimeSnapshotSchema.parse(await this.observe(next));
        if (options.signal?.aborted) {
          cancelActive();
          continue;
        }
        const foreignReservations = this.activeExecutions.size - active.size;
        const refreshedSnapshot: RuntimeSnapshot = {
          ...snapshot,
          limits: {
            ...snapshot.limits,
            activeWorkers: snapshot.limits.activeWorkers + foreignReservations,
          },
        };
        if (
          active.size === 0 &&
          foreignReservations > 0 &&
          snapshot.limits.maxConcurrent !== null &&
          refreshedSnapshot.limits.activeWorkers >= snapshot.limits.maxConcurrent
        ) {
          await Promise.race([Promise.race(this.activeExecutions.values()), cancellationWait]);
          continue;
        }
        const admission = queue.admit(refreshedSnapshot, []);
        if (admission.status === "ready") {
          const controller = new AbortController();
          controllers.set(admission.request.id, controller);
          const reservation = Symbol(admission.request.id);
          const run = Promise.resolve()
            .then(() => this.runGraph(admission, snapshot, controller.signal))
            .then((outcome) => {
              const handoff = queue.settle(
                admission.request.id,
                outcome,
                z.record(z.string(), z.json()),
              );
              if (handoff.status === "accepted") {
                settledOutcomes.set(admission.request.id, outcome);
              }
            })
            .catch((cause: unknown) => {
              const failure = this.executionFailure(cause, controller.signal);
              const outcome: DispatchOutcome<ValidatedWorkerReport> = {
                status: "failed",
                dispatchId: admission.request.id,
                agent: admission.request.agent,
                context: admission.request.context,
                failure,
              };
              const handoff = queue.settle(
                admission.request.id,
                outcome,
                z.record(z.string(), z.json()),
              );
              if (handoff.status === "accepted") {
                settledOutcomes.set(admission.request.id, outcome);
              }
            })
            .finally(() => {
              controllers.delete(admission.request.id);
              active.delete(admission.request.id);
              this.activeExecutions.delete(reservation);
            });
          active.set(admission.request.id, { reservation, promise: run });
          this.activeExecutions.set(reservation, run);
          continue;
        }
        if (admission.status === "unavailable") {
          settledOutcomes.set(admission.outcome.dispatchId, admission.outcome);
          continue;
        }
        if (admission.status === "complete") break;
        if (active.size === 0) {
          throw new DeepAgentsConfigurationError(
            "The dispatch queue is waiting without an active graph.",
          );
        }
        await Promise.race([...active.values()].map((entry) => entry.promise));
      }
    } finally {
      options.signal?.removeEventListener("abort", cancelActive);
    }

    const outcomes = queue.results();
    if (outcomes === undefined)
      throw new DeepAgentsConfigurationError(
        "Dispatch stopped before all requests had named outcomes.",
      );
    const orderedOutcomes: DispatchOutcome<ValidatedWorkerReport>[] = [];
    for (const outcome of outcomes) {
      if (outcome.status !== "completed") {
        orderedOutcomes.push(outcome);
        continue;
      }
      const settledOutcome = settledOutcomes.get(outcome.dispatchId);
      if (settledOutcome === undefined) {
        throw new DeepAgentsConfigurationError(
          `Completed dispatch ${outcome.dispatchId} lost its validated report handoff.`,
        );
      }
      orderedOutcomes.push(settledOutcome);
    }
    return orderedOutcomes;
  }

  private async runGraph(
    admission: Extract<ReturnType<BoundedDispatchQueue["admit"]>, { status: "ready" }>,
    snapshot: RuntimeSnapshot,
    signal: AbortSignal,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>> {
    const { request, definition } = admission;
    const parsedMode = ReportModeSchema.safeParse({
      agent: request.agent,
      mode: request.input.mode,
    });
    if (!parsedMode.success) {
      return {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: {
          code: "INVALID_REPORT",
          message: parsedMode.error.message,
          remedy:
            "Choose a report mode supported by the named worker registration before dispatch.",
        },
      };
    }
    const mode = parsedMode.data;
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
        { name: hostTool.name, description: hostTool.description, schema: hostTool.schema },
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
    const prompt = [
      definition.body.trim(),
      "## Dispatch context",
      JSON.stringify(request.context),
      "## Dispatch input",
      JSON.stringify(request.input),
      `Return the canonical final fenced YAML report for mode ${mode.mode}.`,
    ].join("\n\n");
    let result: Awaited<ReturnType<typeof graph.invoke>>;
    try {
      result = await graph.invoke(
        { messages: [new HumanMessage(prompt)] },
        { recursionLimit: this.maxGraphSteps, signal, callbacks: [modelTracker] },
      );
    } catch (cause) {
      if (capabilityFailure !== undefined) {
        return {
          status: "failed",
          dispatchId: request.id,
          agent: request.agent,
          context: request.context,
          failure: this.executionFailure(capabilityFailure, signal),
        };
      }
      throw cause;
    } finally {
      await modelTracker.waitForIdle();
    }
    if (signal.aborted) {
      return {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: {
          code: "CANCELLED",
          message: "The caller cancelled this worker and graph execution has stopped.",
          remedy: "Start a new invocation only when the caller chooses to resume.",
        },
      };
    }
    const finalMessage = result.messages.toReversed().find((message) => isAIMessage(message));
    if (finalMessage === undefined || typeof finalMessage.content !== "string") {
      throw new DeepAgentsConfigurationError("Deep Agents returned no final text report.");
    }

    let report: ValidatedWorkerReport;
    try {
      report = this.reports.parse(finalMessage.content, mode);
    } catch (cause) {
      const rejected: OrchestrationFailure = {
        code: "INVALID_REPORT",
        message: cause instanceof Error ? cause.message : String(cause),
        remedy:
          "Obtain a final report matching the named worker mode; do not infer success from tool activity.",
      };
      return {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: rejected,
      };
    }
    return {
      status: "completed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      report,
    };
  }

  private executionFailure(cause: unknown, signal: AbortSignal): OrchestrationFailure {
    if (signal.aborted) {
      return {
        code: "CANCELLED",
        message: "The caller cancelled this worker and graph execution has stopped.",
        remedy: "Start a new invocation only when the caller chooses to resume.",
      };
    }
    if (cause instanceof CapabilityToolDeniedError) {
      const capability = cause.capability;
      return {
        code: capability === undefined ? "CAPABILITY_UNKNOWN" : "CAPABILITY_DENIED",
        capability,
        message: cause.message,
        remedy: "Refresh effective host grants and provide only tools the host can enforce.",
      };
    }
    return {
      code: "EXECUTION_FAILED",
      message: cause instanceof Error ? cause.message : String(cause),
      remedy: "Inspect the provider or host tool failure, then retry only when the caller chooses.",
    };
  }
}
