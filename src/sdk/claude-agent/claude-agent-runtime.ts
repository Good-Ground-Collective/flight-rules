import {
  query as claudeAgentQuery,
  type Options,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  AgentDefinitionSchema,
  ModelBindingsSchema,
} from "../../agents/agent-emitter/agent-emitter.schema.js";
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
  type CapabilityToolDeniedError,
  type DispatchOptions,
  type WorkerRuntimeContract,
} from "../worker-runtime-core.js";
import { claudeModelTiers, type ModelTierCatalog } from "./model-tiers.js";
import {
  CapabilityScopedClaudeToolPolicy,
  HostToolExecutionTracker,
  WorkerToolGrantsSchema,
  flightRulesHostServerName,
  type ClaudeToolPolicyContract,
  type WorkerToolGrants,
} from "./tool-policy.js";

export type ClaudeAgentQuery = typeof claudeAgentQuery;
export type { BatchDispatchOptions, DispatchOptions };

const PartialModelBindingsSchema = ModelBindingsSchema.partial();
const ClaudeAgentRuntimePropsSchema = z.strictObject({
  agents: z.array(AgentDefinitionSchema).min(1),
  models: PartialModelBindingsSchema.optional(),
  toolGrants: WorkerToolGrantsSchema,
  observe: z.custom<(request: DispatchRequest) => Promise<RuntimeSnapshot>>(
    (value) => typeof value === "function",
  ),
  maxTurns: z.int().positive().default(64),
  query: z.custom<ClaudeAgentQuery>((value) => typeof value === "function").optional(),
});

export type ClaudeAgentRuntimeProps = z.input<typeof ClaudeAgentRuntimePropsSchema>;

export class ClaudeAgentConfigurationError extends WorkerDispatchConfigurationError {
  override name = "ClaudeAgentConfigurationError";
}

export class ClaudeAgentExecutionError extends Error {
  override name = "ClaudeAgentExecutionError";
}

export type ClaudeAgentWorkerRuntimeContract = WorkerRuntimeContract;

/** Runs canonical worker registrations as isolated Claude Agent SDK queries under current host evidence. */
export class ClaudeAgentWorkerRuntime implements ClaudeAgentWorkerRuntimeContract {
  private readonly models: ReadonlyMap<string, string>;
  private readonly toolGrants: WorkerToolGrants;
  private readonly maxTurns: number;
  private readonly query: ClaudeAgentQuery;
  private readonly toolPolicy: ClaudeToolPolicyContract = new CapabilityScopedClaudeToolPolicy();
  private readonly dispatcher: QueuedWorkerDispatcher;

  constructor(props: ClaudeAgentRuntimeProps) {
    const parsed = ClaudeAgentRuntimePropsSchema.safeParse(props);
    if (!parsed.success) {
      throw new ClaudeAgentConfigurationError(parsed.error.message);
    }
    const agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.toolGrants = parsed.data.toolGrants;
    this.maxTurns = parsed.data.maxTurns;
    this.query = parsed.data.query ?? claudeAgentQuery;
    this.toolPolicy.validateGrants(this.toolGrants);
    this.models = this.bindModels(
      agents,
      parsed.data.models ?? this.defaultModels(claudeModelTiers),
    );

    this.dispatcher = new QueuedWorkerDispatcher({
      agents,
      observe: parsed.data.observe,
      run: (admission, snapshot, signal) => this.runQuery(admission, snapshot, signal),
      createError: (message) => new ClaudeAgentConfigurationError(message),
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

  private defaultModels(catalog: ModelTierCatalog): z.output<typeof ModelBindingsSchema> {
    try {
      return catalog.load();
    } catch (cause) {
      throw new ClaudeAgentConfigurationError(
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
    }
  }

  private bindModels(
    agents: readonly AgentDefinition[],
    bindings: z.output<typeof PartialModelBindingsSchema>,
  ): ReadonlyMap<string, string> {
    const models = new Map<string, string>();
    for (const agent of agents) {
      const tier = agent.frontmatter.model;
      const model = bindings[tier];
      if (model === undefined) {
        throw new ClaudeAgentConfigurationError(`No model is bound for the ${tier} tier.`);
      }
      models.set(agent.frontmatter.name, model);
    }
    return models;
  }

  private async runQuery(
    admission: AdmittedDispatch,
    snapshot: RuntimeSnapshot,
    signal: AbortSignal,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>> {
    const { request, definition } = admission;
    const prepared = workerRunProtocol.prepare(admission);
    if (prepared.status === "rejected") return prepared.outcome;

    const model = this.models.get(definition.frontmatter.name);
    if (model === undefined) {
      throw new ClaudeAgentConfigurationError(
        `No model is bound for the ${request.agent} registration.`,
      );
    }

    const builtInTools = this.toolPolicy.builtInToolsFor(definition, snapshot);
    const hostTools = this.toolPolicy.hostToolsFor(definition, this.toolGrants, snapshot);
    const controller = new AbortController();
    const relayCancellation = () => controller.abort(signal.reason);
    if (signal.aborted) relayCancellation();
    signal.addEventListener("abort", relayCancellation, { once: true });

    const tracker = new HostToolExecutionTracker();
    let denial: CapabilityToolDeniedError | undefined;
    const guard = this.toolPolicy.guardFor({
      allowedTools: this.toolPolicy.allowlistFor(builtInTools, hostTools),
      cwd: request.context.cwd,
      repositoryRoot: request.context.repositoryRoot,
      onDenied: (error) => {
        denial ??= error;
        controller.abort(error);
      },
    });
    const options: Options = {
      cwd: request.context.cwd,
      model,
      systemPrompt: definition.body,
      tools: builtInTools,
      disallowedTools: this.toolPolicy.disallowedTools(),
      ...(hostTools.length === 0
        ? {}
        : {
            mcpServers: {
              [flightRulesHostServerName]: this.toolPolicy.serverFor(hostTools, {
                signal: controller.signal,
                tracker,
              }),
            },
          }),
      strictMcpConfig: true,
      settingSources: [],
      plugins: [],
      permissionMode: "default",
      hooks: { PreToolUse: [{ hooks: [(input) => guard.preToolUse(input)] }] },
      canUseTool: (toolName, input) => guard.canUseTool(toolName, input),
      maxTurns: this.maxTurns,
      abortController: controller,
      persistSession: false,
    };

    let result: SDKResultMessage | undefined;
    let queryFailure: { cause: unknown } | undefined;
    try {
      for await (const message of this.query({ prompt: prepared.task, options })) {
        if (message.type === "result") result = message;
      }
    } catch (cause) {
      queryFailure = { cause };
    } finally {
      signal.removeEventListener("abort", relayCancellation);
      await tracker.waitForIdle();
    }

    if (signal.aborted) return workerRunProtocol.cancelled(request);
    if (denial !== undefined) {
      return workerRunProtocol.failed(request, workerRunProtocol.executionFailure(denial, signal));
    }
    const hostFailure = tracker.failure();
    if (hostFailure !== undefined) {
      return workerRunProtocol.failed(
        request,
        workerRunProtocol.executionFailure(hostFailure.cause, signal),
      );
    }

    if (result === undefined) {
      if (queryFailure === undefined) {
        throw new ClaudeAgentExecutionError("The Claude Agent SDK ended without a result message.");
      }
      throw queryFailure.cause instanceof Error
        ? queryFailure.cause
        : new ClaudeAgentExecutionError(String(queryFailure.cause), { cause: queryFailure.cause });
    }
    if (result.subtype === "success" && !result.is_error) {
      return workerRunProtocol.finish(request, result.result, prepared.mode);
    }
    return workerRunProtocol.failed(
      request,
      workerRunProtocol.executionFailure(
        new ClaudeAgentExecutionError(this.describeFailure(result)),
        signal,
      ),
    );
  }

  private describeFailure(result: SDKResultMessage): string {
    if (result.subtype === "success") return result.result;
    if (result.subtype === "error_max_turns") {
      return `The worker stopped after reaching maxTurns (${this.maxTurns}) without a final report.`;
    }
    return `The Claude Agent SDK ended with ${result.subtype}: ${result.errors.join("; ")}`;
  }
}
