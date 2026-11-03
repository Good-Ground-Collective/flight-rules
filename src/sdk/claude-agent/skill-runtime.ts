import { randomUUID } from "node:crypto";
import {
  createSdkMcpServer,
  query as claudeAgentQuery,
  tool,
  type HookJSONOutput,
  type McpSdkServerConfigWithInstance,
  type Options,
  type SDKResultMessage,
  type SDKResultSuccess,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  AgentDefinitionSchema,
  ModelBindingsSchema,
} from "../../agents/agent-emitter/agent-emitter.schema.js";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type { OperationRegistry } from "../../operations/operation-registry.js";
import { RegistryOrchestrationPolicy } from "../../orchestration/orchestration-policy.js";
import {
  CallerContextSchema,
  RuntimeSnapshotSchema,
  type CallerContext,
} from "../../orchestration/orchestration.schema.js";
import type { InstructionCatalog } from "../instruction-catalog.js";
import {
  callerContexts,
  CodedSkillError,
  FreshQuestionAccess,
  PendingPauseRegistry,
  SharedSkillToolHandlers,
  SkillConfigurationError,
  SkillExecution,
  SkillOperationRoutes,
  skillWorkerModes,
  skillAgentDefinitions,
  skillFailures,
  skillToolNames,
  type PausedSkillResult,
  type SkillInvocationOptions,
  type SkillResult,
  type SkillResumeRequest,
  type SkillRuntimeObserver,
  type SkillWorkerDispatcher,
} from "../skill-runtime-core.js";
import { guardedQueryOptions } from "./guarded-query-options.js";
import { claudeModelTiers } from "./model-tiers.js";
import { QuestionBoundary, ToolTurnObserver } from "./skill-boundary.js";
import {
  CapabilityScopedClaudeToolPolicy,
  HostToolExecutionTracker,
  flightRulesHostServerName,
  type ClaudeToolPolicyContract,
  type WorkerToolGrants,
} from "./tool-policy.js";
import { ClaudeAgentExecutionError, type ClaudeAgentQuery } from "./claude-agent-runtime.js";

export const flightRulesServerName = "flight-rules";

const PartialModelBindingsSchema = ModelBindingsSchema.partial();
const ClaudeAgentSkillRuntimePropsSchema = z.strictObject({
  instructions: z.custom<InstructionCatalog>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "loadSkill" in value &&
      typeof value.loadSkill === "function",
  ),
  agents: z.array(AgentDefinitionSchema).min(1),
  models: PartialModelBindingsSchema.optional(),
  operations: z.custom<OperationRegistry>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "invoke" in value &&
      typeof value.invoke === "function" &&
      "list" in value &&
      typeof value.list === "function",
  ),
  workers: z.custom<SkillWorkerDispatcher>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "dispatch" in value &&
      typeof value.dispatch === "function",
  ),
  observe: z.custom<ClaudeAgentSkillRuntimeObserver>((value) => typeof value === "function"),
  toolGrants: z.custom<(context: CallerContext) => WorkerToolGrants>(
    (value) => typeof value === "function",
  ),
  maxTurns: z.int().positive().default(64),
  query: z.custom<ClaudeAgentQuery>((value) => typeof value === "function").optional(),
});

export type ClaudeAgentSkillRuntimeProps = z.input<typeof ClaudeAgentSkillRuntimePropsSchema>;
export type ClaudeAgentSkillRuntimeObserver = SkillRuntimeObserver;
export type ClaudeAgentSkillResult<T = unknown> = SkillResult<T>;
export type { PausedSkillResult, SkillInvocationOptions, SkillResumeRequest };

export interface ClaudeAgentSkillRuntimeContract {
  invoke(
    skill: string,
    context: CallerContext,
    input: Record<string, unknown>,
    options?: SkillInvocationOptions,
  ): Promise<ClaudeAgentSkillResult>;
  resume(request: SkillResumeRequest): Promise<ClaudeAgentSkillResult>;
  cancel(context: CallerContext, pauseId: string): ClaudeAgentSkillResult;
}

export class ClaudeAgentSkillConfigurationError extends SkillConfigurationError {
  override name = "ClaudeAgentSkillConfigurationError";
}

/** A sibling skill asked a human question; the parent cannot carry that pause, so it fails instead of guessing. */
export class NestedSkillPauseError extends CodedSkillError {
  override name = "NestedSkillPauseError";

  constructor(props: { siblingSkill: string }) {
    super({
      failureCode: "NESTED_PAUSE_UNSUPPORTED",
      message: `The sibling skill ${props.siblingSkill} paused for a human answer. A paused sibling cannot be carried by its parent skill, so the parent failed.`,
    });
  }
}

/** The model called the question tool and the host did not pause it, so no human answer exists to return. */
export class UnansweredQuestionError extends CodedSkillError {
  override name = "UnansweredQuestionError";

  constructor() {
    super({
      failureCode: "QUESTION_NOT_PAUSED",
      message: "The human question was not paused, so there is no answer to return.",
    });
  }
}

interface ClaudeSkillSession {
  sessionId: string;
  toolUseId: string;
}

interface SkillRun {
  options: Options;
  execution: SkillExecution;
  hostTools: HostToolExecutionTracker;
  turns: ToolTurnObserver;
  boundary: QuestionBoundary;
  controller: AbortController;
  detach: () => void;
}

interface RunRequest {
  skill: string;
  caller: CallerContext;
  allowHumanQuestions: boolean;
  signal: AbortSignal | undefined;
  resume?: { session: ClaudeSkillSession; answer: string };
}

interface SkillOutcomeIdentity {
  caller: CallerContext;
  invocationId: string;
  skill: string;
  allowHumanQuestions: boolean;
  signal: AbortSignal | undefined;
}

/** Executes canonical workflow instructions as one Claude Agent SDK conversation, pausing at human questions through the SDK's deferred tool calls. */
export class ClaudeAgentSkillRuntime implements ClaudeAgentSkillRuntimeContract {
  private readonly instructions: InstructionCatalog;
  private readonly agents: AgentDefinition[];
  private readonly model: string;
  private readonly operations: OperationRegistry;
  private readonly workers: SkillWorkerDispatcher;
  private readonly observe: ClaudeAgentSkillRuntimeObserver;
  private readonly toolGrants: (context: CallerContext) => WorkerToolGrants;
  private readonly maxTurns: number;
  private readonly query: ClaudeAgentQuery;
  private readonly pauses = new PendingPauseRegistry<ClaudeSkillSession>();
  private readonly questionAccess: FreshQuestionAccess;
  private readonly toolPolicy: ClaudeToolPolicyContract = new CapabilityScopedClaudeToolPolicy();
  private readonly orchestration: RegistryOrchestrationPolicy;

  constructor(props: ClaudeAgentSkillRuntimeProps) {
    const parsed = ClaudeAgentSkillRuntimePropsSchema.safeParse(props);
    if (!parsed.success) throw new ClaudeAgentSkillConfigurationError(parsed.error.message);
    this.instructions = parsed.data.instructions;
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.operations = parsed.data.operations;
    this.workers = parsed.data.workers;
    this.observe = parsed.data.observe;
    this.toolGrants = parsed.data.toolGrants;
    this.maxTurns = parsed.data.maxTurns;
    this.query = parsed.data.query ?? claudeAgentQuery;
    this.orchestration = new RegistryOrchestrationPolicy({ agents: this.agents });
    this.questionAccess = new FreshQuestionAccess({ observe: this.observe });
    this.model = this.standardModel(parsed.data.models);
  }

  async invoke(
    skill: string,
    context: CallerContext,
    input: Record<string, unknown>,
    options: SkillInvocationOptions = {},
  ): Promise<ClaudeAgentSkillResult> {
    const caller = CallerContextSchema.parse(context);
    const invocationId = randomUUID();
    const allowHumanQuestions = options.allowHumanQuestions === true;
    let run: SkillRun | undefined;
    try {
      const instruction = this.instructions.loadSkill(skill);
      run = await this.prepareRun({ skill, caller, allowHumanQuestions, signal: options.signal });
      const operationsSection = new SkillOperationRoutes({
        operations: this.operations.admitted?.() ?? [],
      }).promptSection();
      const workersSection = skillWorkerModes.promptSection(this.agents);
      const sections = [operationsSection, workersSection].filter((section) => section !== "");
      const prompt = `${instruction.contents}\n\n${sections.map((section) => `${section}\n\n`).join("")}## Invocation context\n${JSON.stringify(caller)}\n\n## Invocation input\n${JSON.stringify(input)}`;
      return await this.execute(run, prompt, {
        caller,
        invocationId,
        skill,
        allowHumanQuestions,
        signal: options.signal,
      });
    } catch (cause) {
      await this.settle(run);
      return skillFailures.failed({
        context: caller,
        invocationId,
        signal: options.signal,
        execution: run?.execution,
        cause,
      });
    }
  }

  async resume(request: SkillResumeRequest): Promise<ClaudeAgentSkillResult> {
    const caller = CallerContextSchema.parse(request.context);
    const pending = this.pauses.reserve({ ...request, context: caller });
    let run: SkillRun | undefined;
    let continuationStarted = false;
    try {
      await this.questionAccess.assertAvailable(caller);
      run = await this.prepareRun({
        skill: pending.skill,
        caller,
        allowHumanQuestions: pending.allowHumanQuestions,
        signal: request.signal,
        resume: { session: pending.session, answer: request.answer },
      });
      this.pauses.consume(pending);
      continuationStarted = true;
      return await this.execute(run, this.noNewPrompt(), {
        caller,
        invocationId: pending.invocationId,
        skill: pending.skill,
        allowHumanQuestions: pending.allowHumanQuestions,
        signal: request.signal,
      });
    } catch (cause) {
      await this.settle(run);
      if (!continuationStarted) this.pauses.release(pending);
      return skillFailures.failed({
        context: caller,
        invocationId: pending.invocationId,
        signal: request.signal,
        execution: run?.execution,
        cause,
      });
    }
  }

  cancel(context: CallerContext, pauseId: string): ClaudeAgentSkillResult {
    const caller = CallerContextSchema.parse(context);
    const pending = this.pauses.cancel(caller, pauseId);
    return skillFailures.cancelled(caller, pending.invocationId);
  }

  private standardModel(bindings: z.output<typeof PartialModelBindingsSchema> | undefined): string {
    try {
      const model = (bindings ?? claudeModelTiers.load()).standard;
      if (model === undefined) throw new Error("No model is bound for the standard tier.");
      return model;
    } catch (cause) {
      throw new ClaudeAgentSkillConfigurationError(
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
    }
  }

  /** The SDK needs a prompt even when a deferred call resumes; an empty stream sends no new user message. */
  private noNewPrompt(): AsyncIterable<SDKUserMessage> {
    return (async function* () {})();
  }

  private async prepareRun(request: RunRequest): Promise<SkillRun> {
    const { skill, caller, allowHumanQuestions, signal } = request;
    const instruction = this.instructions.loadSkill(skill);
    const observed = RuntimeSnapshotSchema.parse(await this.observe(caller));
    if (!callerContexts.matches(observed.context, caller)) {
      throw new ClaudeAgentSkillConfigurationError(
        "Runtime evidence belongs to a different caller context.",
      );
    }

    const definition = skillAgentDefinitions.forSkill(instruction, observed);
    const builtInTools = this.toolPolicy.builtInToolsFor(definition, observed);
    const hostTools = this.toolPolicy.hostToolsFor(definition, this.toolGrants(caller), observed);
    const questionsOffered = allowHumanQuestions && observed.ask.state === "available";

    const controller = new AbortController();
    const relayCancellation = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayCancellation();
    signal?.addEventListener("abort", relayCancellation, { once: true });

    const execution = new SkillExecution();
    const hostTracker = new HostToolExecutionTracker();
    const turns = new ToolTurnObserver();
    const handlers = new SharedSkillToolHandlers({
      context: caller,
      allowHumanQuestions,
      launch: observed,
      agents: this.agents,
      operations: this.operations,
      workers: this.workers,
      observe: this.observe,
      orchestration: this.orchestration,
      execution,
      signal: controller.signal,
    });
    const boundary = new QuestionBoundary({
      askTool: this.qualified(skillToolNames.ask),
      aloneTools: [this.qualified(skillToolNames.ask), this.qualified(skillToolNames.sibling)],
      turns,
      ask: (args) => handlers.ask(args),
      resumed:
        request.resume === undefined
          ? undefined
          : { toolUseId: request.resume.session.toolUseId, answer: request.resume.answer },
    });

    const sharedTools = this.sharedToolNames(questionsOffered);
    const guard = this.toolPolicy.guardFor({
      allowedTools: [
        ...this.toolPolicy.allowlistFor(builtInTools, hostTools),
        ...sharedTools.map((name) => this.qualified(name)),
      ],
      cwd: caller.cwd,
      repositoryRoot: caller.repositoryRoot,
      shellRedirects: new SkillOperationRoutes({ operations: this.operations.admitted?.() ?? [] }),
      onDenied: (error) => {
        execution.recordFailure(error);
        controller.abort(error);
      },
    });

    const options = guardedQueryOptions.build({
      cwd: caller.cwd,
      model: this.model,
      builtInTools,
      disallowedTools: this.toolPolicy.disallowedTools(),
      mcpServers: {
        [flightRulesServerName]: this.sharedServer({
          handlers,
          boundary,
          execution,
          questionsOffered,
          allowHumanQuestions,
          signal: controller.signal,
        }),
        ...(hostTools.length === 0
          ? {}
          : {
              [flightRulesHostServerName]: this.toolPolicy.serverFor(hostTools, {
                signal: controller.signal,
                tracker: hostTracker,
              }),
            }),
      },
      guard,
      preToolUse: async (input) => {
        if (execution.failure !== undefined) return this.denyAfterFailure(execution.failure);

        const denied = await guard.preToolUse(input);
        if (this.isDenial(denied)) return denied;
        return boundary.preToolUse(input);
      },
      maxTurns: this.maxTurns,
      controller,
      persistSession: true,
      ...(request.resume === undefined ? {} : { resume: request.resume.session.sessionId }),
    });

    return {
      options,
      execution,
      hostTools: hostTracker,
      turns,
      boundary,
      controller,
      detach: () => signal?.removeEventListener("abort", relayCancellation),
    };
  }

  private async execute(
    run: SkillRun,
    prompt: string | AsyncIterable<SDKUserMessage>,
    identity: SkillOutcomeIdentity,
  ): Promise<ClaudeAgentSkillResult> {
    let result: SDKResultMessage | undefined;
    let queryFailure: { cause: unknown } | undefined;
    try {
      for await (const message of this.query({ prompt, options: run.options })) {
        run.turns.observe(message);
        if (message.type === "result") result = message;
      }
    } catch (cause) {
      queryFailure = { cause };
    } finally {
      await this.settle(run);
    }

    const hostFailure = run.hostTools.failure();
    if (hostFailure !== undefined) run.execution.recordFailure(hostFailure.cause);
    if (run.execution.failure !== undefined) throw run.execution.failure;
    if (identity.signal?.aborted)
      throw identity.signal.reason ?? new Error("The skill was cancelled.");

    if (result === undefined) {
      throw (
        queryFailure?.cause ??
        new ClaudeAgentExecutionError("The Claude Agent SDK ended without a result message.")
      );
    }
    if (result.subtype === "success" && result.deferred_tool_use !== undefined) {
      return this.pause(run, result, identity);
    }
    if (result.subtype === "success" && !result.is_error) {
      return {
        status: "completed",
        context: identity.caller,
        invocationId: identity.invocationId,
        report: result.result,
      };
    }
    throw new ClaudeAgentExecutionError(this.describeFailure(result));
  }

  private pause(
    run: SkillRun,
    result: SDKResultSuccess,
    identity: SkillOutcomeIdentity,
  ): ClaudeAgentSkillResult {
    const deferredCall = result.deferred_tool_use;
    const question = run.boundary.deferred;
    if (
      deferredCall === undefined ||
      question === undefined ||
      deferredCall.id !== question.toolUseId
    ) {
      throw new ClaudeAgentExecutionError(
        `The Claude Agent SDK deferred ${deferredCall?.name ?? "a tool call"} that this runtime did not pause.`,
      );
    }

    const pause = this.pauses.register({
      context: identity.caller,
      invocationId: identity.invocationId,
      questionId: question.questionId,
      skill: identity.skill,
      allowHumanQuestions: identity.allowHumanQuestions,
      runKey: result.session_id,
      session: { sessionId: result.session_id, toolUseId: question.toolUseId },
    });
    return {
      status: "paused",
      context: identity.caller,
      invocationId: identity.invocationId,
      pauseId: pause.pauseId,
      questionId: question.questionId,
      question: question.question,
    };
  }

  private async settle(run: SkillRun | undefined): Promise<void> {
    if (run === undefined) return;
    run.turns.close();
    run.detach();
    await run.execution.waitForIdle();
    await run.hostTools.waitForIdle();
  }

  private describeFailure(result: SDKResultMessage): string {
    if (result.subtype === "success") return result.result;
    if (result.subtype === "error_max_turns") {
      return `The skill stopped after reaching maxTurns (${this.maxTurns}) without a final answer.`;
    }
    return `The Claude Agent SDK ended with ${result.subtype}: ${result.errors.join("; ")}`;
  }

  private qualified(toolName: string): string {
    return `mcp__${flightRulesServerName}__${toolName}`;
  }

  private sharedToolNames(questionsOffered: boolean): string[] {
    return [
      skillToolNames.operation,
      skillToolNames.dispatch,
      skillToolNames.sibling,
      ...(questionsOffered ? [skillToolNames.ask] : []),
    ];
  }

  private isDenial(output: HookJSONOutput): boolean {
    const specific = "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
    return (
      specific !== undefined &&
      "permissionDecision" in specific &&
      specific.permissionDecision === "deny"
    );
  }

  private denyAfterFailure(failure: Error) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: `This skill already failed (${failure.message}); no further tool work runs.`,
      },
    };
  }

  private sharedServer(props: {
    handlers: SharedSkillToolHandlers;
    boundary: QuestionBoundary;
    execution: SkillExecution;
    questionsOffered: boolean;
    allowHumanQuestions: boolean;
    signal: AbortSignal;
  }): McpSdkServerConfigWithInstance {
    const { handlers, boundary, execution } = props;
    const text = (value: unknown) => ({
      content: [
        { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) },
      ],
    });
    const failed = (cause: unknown) => ({
      isError: true,
      content: [
        { type: "text" as const, text: cause instanceof Error ? cause.message : String(cause) },
      ],
    });
    const tools = [
      tool(
        skillToolNames.operation,
        "Run a launch-authorized shared flight-rules operation.",
        { operationId: z.string(), input: z.record(z.string(), z.unknown()) },
        async (args) => handlers.operation(args).then(text, failed),
        { alwaysLoad: true },
      ),
      tool(
        skillToolNames.dispatch,
        "Dispatch one registered named worker under observed host grants.",
        { agent: z.string(), dispatchId: z.string(), input: z.record(z.string(), z.json()) },
        async (args) => handlers.dispatch(args).then(text, failed),
        { alwaysLoad: true },
      ),
      tool(
        skillToolNames.sibling,
        "Invoke another canonical skill with this same caller context. Call it alone in its turn.",
        { siblingSkill: z.string(), input: z.record(z.string(), z.json()) },
        async (args) =>
          handlers
            .sibling(args, (sibling) =>
              this.runSibling(sibling.skill, sibling.context, sibling.input, props),
            )
            .then(text, failed),
        { alwaysLoad: true },
      ),
    ];
    const askTools = props.questionsOffered
      ? [
          tool(
            skillToolNames.ask,
            "Pause this skill and wait for an actual answer from the human caller. Call it alone in its turn and never supply the answer field.",
            { question: z.string().min(1), answer: z.string().optional() },
            async () => {
              const answer = boundary.takeAnswer();
              if (answer === undefined) {
                const unanswered = new UnansweredQuestionError();
                execution.recordFailure(unanswered);
                return failed(unanswered);
              }
              return text(answer);
            },
            { alwaysLoad: true },
          ),
        ]
      : [];
    return createSdkMcpServer({
      name: flightRulesServerName,
      alwaysLoad: true,
      tools: [...tools, ...askTools],
    });
  }

  private async runSibling(
    skill: string,
    context: CallerContext,
    input: Record<string, unknown>,
    props: { allowHumanQuestions: boolean; signal: AbortSignal },
  ): Promise<ClaudeAgentSkillResult> {
    const result = await this.invoke(skill, context, input, {
      allowHumanQuestions: props.allowHumanQuestions,
      signal: props.signal,
    });
    if (result.status !== "paused") return result;

    this.cancel(result.context, result.pauseId);
    throw new NestedSkillPauseError({ siblingSkill: skill });
  }
}
