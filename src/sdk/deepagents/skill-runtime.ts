import { randomUUID } from "node:crypto";
import { Command, interrupt, isGraphInterrupt, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
  type BaseMessage as BaseMessageType,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { createDeepAgent } from "deepagents";
import { createMiddleware, tool, type StructuredTool } from "langchain";
import { z } from "zod";
import { AgentDefinitionSchema } from "../../agents/agent-emitter/agent-emitter.schema.js";
import { AgentFrontmatterSchema } from "../../agents/agent-frontmatter/agent-frontmatter.schema.js";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import { RegistryOrchestrationPolicy } from "../../orchestration/orchestration-policy.js";
import {
  CallerContextSchema,
  DispatchRequestSchema,
  RuntimeSnapshotSchema,
  type CallerContext,
  type DispatchOutcome,
  type RuntimeSnapshot,
} from "../../orchestration/orchestration.schema.js";
import type { OperationRegistry } from "../../operations/operation-registry.js";
import type { OperationEffect } from "../../operations/operation.schema.js";
import type { InstructionCatalog } from "../instruction-catalog.js";
import type { ValidatedWorkerReport } from "../report-codec.js";
import type { DeepAgentsWorkerRuntimeContract } from "./deepagents-runtime.js";
import {
  CapabilityToolDeniedError,
  CapabilityScopedDeepAgentsToolPolicy,
  type WorkerToolGrants,
} from "./tool-policy.js";

const SkillRuntimePropsSchema = z.strictObject({
  instructions: z.custom<InstructionCatalog>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "loadSkill" in value &&
      typeof value.loadSkill === "function",
  ),
  agents: z.array(AgentDefinitionSchema).min(1),
  models: z.strictObject({
    standard: z.instanceof(BaseChatModel),
    escalated: z.instanceof(BaseChatModel),
    expert: z.instanceof(BaseChatModel),
  }),
  operations: z.custom<OperationRegistry>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "invoke" in value &&
      typeof value.invoke === "function" &&
      "list" in value &&
      typeof value.list === "function",
  ),
  workers: z.custom<DeepAgentsWorkerRuntimeContract>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "dispatch" in value &&
      typeof value.dispatch === "function",
  ),
  observe: z.custom<DeepAgentsSkillRuntimeObserver>((value) => typeof value === "function"),
  toolGrants: z.custom<(context: CallerContext) => WorkerToolGrants>(
    (value) => typeof value === "function",
  ),
  checkpointer: z
    .custom<BaseCheckpointSaver>(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "getTuple" in value &&
        typeof value.getTuple === "function",
    )
    .default(() => new MemorySaver()),
  maxGraphSteps: z.int().positive().default(128),
});

export type DeepAgentsSkillRuntimeProps = z.input<typeof SkillRuntimePropsSchema>;
export type DeepAgentsSkillRuntimeObserver = (
  context: CallerContext,
  registration?: AgentDefinition,
) => Promise<RuntimeSnapshot>;
export interface SkillInvocationOptions {
  allowHumanQuestions?: boolean;
  signal?: AbortSignal;
}
export interface SkillResumeRequest {
  context: CallerContext;
  pauseId: string;
  questionId: string;
  answer: string;
  signal?: AbortSignal;
}
export type PausedSkillResult = {
  status: "paused";
  context: CallerContext;
  invocationId: string;
  pauseId: string;
  questionId: string;
  question: string;
};
export type DeepAgentsSkillResult<T = unknown> =
  | { status: "completed"; context: CallerContext; invocationId: string; report: T }
  | PausedSkillResult
  | {
      status: "failed";
      context: CallerContext;
      invocationId: string;
      failure: {
        code: string;
        message: string;
        operations?: {
          operationId: string;
          status: "partial";
          data: unknown;
          error: { name: string; message: string };
        }[];
      };
    };

const PartialOperationSchema = z.strictObject({
  operationId: z.string().min(1),
  status: z.literal("partial"),
  data: z.unknown(),
  error: z.strictObject({ name: z.string().min(1), message: z.string() }),
});
const PartialOperationFailurePropsSchema = z.strictObject({
  operations: z.array(PartialOperationSchema).min(1),
});

class PartialOperationFailure extends Error {
  override name = "PartialOperationFailure";
  readonly operations: z.output<typeof PartialOperationFailurePropsSchema>["operations"];

  constructor(props: z.input<typeof PartialOperationFailurePropsSchema>) {
    const parsed = PartialOperationFailurePropsSchema.parse(props);
    super(parsed.operations.map(({ error }) => `${error.name}: ${error.message}`).join("; "));
    this.operations = parsed.operations;
  }
}

export interface DeepAgentsSkillRuntimeContract {
  invoke(
    skill: string,
    context: CallerContext,
    input: Record<string, unknown>,
    options?: SkillInvocationOptions,
  ): Promise<DeepAgentsSkillResult>;
  resume(request: SkillResumeRequest): Promise<DeepAgentsSkillResult>;
  cancel(context: CallerContext, pauseId: string): DeepAgentsSkillResult;
}

interface PendingQuestion {
  context: CallerContext;
  invocationId: string;
  pauseId: string;
  questionId: string;
  threadId: string;
  skill: string;
  allowHumanQuestions: boolean;
  state: "paused" | "resuming";
}

interface SkillToolExecutionTracker {
  track<T>(execution: () => Promise<T>): Promise<T>;
  waitForIdle(): Promise<void>;
}

class InFlightSkillToolExecutionTracker implements SkillToolExecutionTracker {
  private readonly active = new Set<Promise<unknown>>();

  async track<T>(execution: () => Promise<T>): Promise<T> {
    const promise = Promise.resolve().then(execution);
    this.active.add(promise);
    try {
      return await promise;
    } finally {
      this.active.delete(promise);
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.active.size > 0) await Promise.allSettled([...this.active]);
  }
}

export class InvalidSkillResumeError extends Error {
  override name = "InvalidSkillResumeError";
}
export class DeepAgentsSkillConfigurationError extends Error {
  override name = "DeepAgentsSkillConfigurationError";
}

/** Executes canonical workflow instructions with shared operations and checkpointed human decisions. */
export class LangChainDeepAgentsSkillRuntime implements DeepAgentsSkillRuntimeContract {
  private readonly instructions: InstructionCatalog;
  private readonly agents: AgentDefinition[];
  private readonly models: z.output<typeof SkillRuntimePropsSchema>["models"];
  private readonly operations: OperationRegistry;
  private readonly workers: DeepAgentsWorkerRuntimeContract;
  private readonly observe: DeepAgentsSkillRuntimeObserver;
  private readonly toolGrants: (context: CallerContext) => WorkerToolGrants;
  private readonly checkpointer: BaseCheckpointSaver;
  private readonly maxGraphSteps: number;
  private readonly pending = new Map<string, PendingQuestion>();
  private readonly siblingPauses = new Map<string, PausedSkillResult>();
  private readonly policy: CapabilityScopedDeepAgentsToolPolicy =
    new CapabilityScopedDeepAgentsToolPolicy();
  private readonly orchestration: RegistryOrchestrationPolicy;

  constructor(props: DeepAgentsSkillRuntimeProps) {
    const parsed = SkillRuntimePropsSchema.safeParse(props);
    if (!parsed.success) throw new DeepAgentsSkillConfigurationError(parsed.error.message);
    this.instructions = parsed.data.instructions;
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.models = parsed.data.models;
    this.operations = parsed.data.operations;
    this.workers = parsed.data.workers;
    this.observe = parsed.data.observe;
    this.toolGrants = parsed.data.toolGrants;
    this.checkpointer = parsed.data.checkpointer;
    this.maxGraphSteps = parsed.data.maxGraphSteps;
    this.orchestration = new RegistryOrchestrationPolicy({ agents: this.agents });
  }

  async invoke(
    skill: string,
    context: CallerContext,
    input: Record<string, unknown>,
    options: SkillInvocationOptions = {},
  ): Promise<DeepAgentsSkillResult> {
    const caller = CallerContextSchema.parse(context);
    const invocationId = randomUUID();
    const threadId = randomUUID();
    let execution: Awaited<ReturnType<LangChainDeepAgentsSkillRuntime["createGraph"]>> | undefined;
    try {
      const instruction = this.instructions.loadSkill(skill);
      execution = await this.createGraph(
        skill,
        caller,
        options.allowHumanQuestions === true,
        threadId,
      );
      const result = await execution.graph.invoke(
        {
          messages: [
            new HumanMessage(
              `${instruction.contents}\n\n## Invocation context\n${JSON.stringify(caller)}\n\n## Invocation input\n${JSON.stringify(input)}`,
            ),
          ],
        },
        {
          configurable: { thread_id: threadId },
          recursionLimit: this.maxGraphSteps,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      await execution.tools.waitForIdle();
      if (execution.failure !== undefined) throw execution.failure;
      return this.result(
        execution.graph,
        result,
        caller,
        invocationId,
        threadId,
        skill,
        options.allowHumanQuestions === true,
      );
    } catch (cause) {
      await execution?.tools.waitForIdle();
      const interruption = isGraphInterrupt(cause)
        ? z
            .array(z.object({ id: z.string().optional(), value: z.unknown() }))
            .safeParse(cause.interrupts)
        : this.questionInterruptionFromError(cause);
      const question = interruption.success
        ? z
            .object({ questionId: z.string(), question: z.string() })
            .safeParse(interruption.data[0]?.value)
        : undefined;
      if (question?.success === true && options.allowHumanQuestions === true) {
        if (isGraphInterrupt(cause)) {
          const pauseId = randomUUID();
          this.pending.set(pauseId, {
            context: caller,
            invocationId,
            pauseId,
            questionId: question.data.questionId,
            threadId,
            skill,
            allowHumanQuestions: true,
            state: "paused",
          });
          return {
            status: "paused",
            context: caller,
            invocationId,
            pauseId,
            questionId: question.data.questionId,
            question: question.data.question,
          };
        }
      }
      return {
        status: "failed",
        context: caller,
        invocationId,
        failure: {
          code: options.signal?.aborted
            ? "CANCELLED"
            : execution?.failure === undefined
              ? "EXECUTION_FAILED"
              : "TOOL_FAILED",
          message:
            execution?.failure instanceof Error
              ? execution.failure.message
              : cause instanceof Error
                ? cause.message
                : String(cause),
          ...(execution !== undefined && execution.partialOperations.length > 0
            ? { operations: execution.partialOperations }
            : {}),
        },
      };
    }
  }

  async resume(request: SkillResumeRequest): Promise<DeepAgentsSkillResult> {
    const caller = CallerContextSchema.parse(request.context);
    const pending = this.pending.get(request.pauseId);
    if (
      pending === undefined ||
      pending.questionId !== request.questionId ||
      JSON.stringify(pending.context) !== JSON.stringify(caller) ||
      pending.state !== "paused"
    ) {
      throw new InvalidSkillResumeError(
        "The pause, question or caller context is missing, stale or does not match.",
      );
    }
    if (request.answer.trim().length === 0)
      throw new InvalidSkillResumeError("A human answer is required to resume this question.");
    pending.state = "resuming";
    let execution: Awaited<ReturnType<LangChainDeepAgentsSkillRuntime["createGraph"]>> | undefined;
    let continuationStarted = false;
    try {
      const snapshot = RuntimeSnapshotSchema.parse(await this.observe(caller));
      if (
        JSON.stringify(snapshot.context) !== JSON.stringify(caller) ||
        snapshot.ask.state !== "available"
      ) {
        throw new InvalidSkillResumeError(
          "Fresh question access is unavailable for the original caller context.",
        );
      }
      execution = await this.createGraph(
        pending.skill,
        caller,
        pending.allowHumanQuestions,
        pending.threadId,
      );
      this.pending.delete(request.pauseId);
      continuationStarted = true;
      const result = await execution.graph.invoke(
        new Command({ resume: { questionId: request.questionId, answer: request.answer } }),
        {
          configurable: { thread_id: pending.threadId },
          recursionLimit: this.maxGraphSteps,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      await execution.tools.waitForIdle();
      if (execution.failure !== undefined) throw execution.failure;
      return this.result(
        execution.graph,
        result,
        caller,
        pending.invocationId,
        pending.threadId,
        pending.skill,
        pending.allowHumanQuestions,
      );
    } catch (cause) {
      await execution?.tools.waitForIdle();
      if (!continuationStarted && this.pending.get(request.pauseId) === pending) {
        pending.state = "paused";
      }
      return {
        status: "failed",
        context: caller,
        invocationId: pending.invocationId,
        failure: {
          code: request.signal?.aborted
            ? "CANCELLED"
            : execution?.failure === undefined
              ? "EXECUTION_FAILED"
              : "TOOL_FAILED",
          message:
            execution?.failure instanceof Error
              ? execution.failure.message
              : cause instanceof Error
                ? cause.message
                : String(cause),
          ...(execution !== undefined && execution.partialOperations.length > 0
            ? { operations: execution.partialOperations }
            : {}),
        },
      };
    }
  }

  cancel(context: CallerContext, pauseId: string): DeepAgentsSkillResult {
    const caller = CallerContextSchema.parse(context);
    const pending = this.pending.get(pauseId);
    if (
      pending === undefined ||
      pending.state !== "paused" ||
      JSON.stringify(pending.context) !== JSON.stringify(caller)
    ) {
      throw new InvalidSkillResumeError(
        "The pause is missing or belongs to another caller context.",
      );
    }
    this.pending.delete(pauseId);
    const sibling = this.siblingPauses.get(pending.threadId);
    if (sibling !== undefined) {
      this.siblingPauses.delete(pending.threadId);
      this.cancel(caller, sibling.pauseId);
    }
    return {
      status: "failed",
      context: caller,
      invocationId: pending.invocationId,
      failure: { code: "CANCELLED", message: "The caller cancelled this paused skill." },
    };
  }

  private async createGraph(
    skill: string,
    context: CallerContext,
    allowHumanQuestions: boolean,
    threadId: string,
  ) {
    const instruction = this.instructions.loadSkill(skill);
    const observed = RuntimeSnapshotSchema.parse(await this.observe(context));
    if (JSON.stringify(observed.context) !== JSON.stringify(context))
      throw new DeepAgentsSkillConfigurationError(
        "Runtime evidence belongs to a different caller context.",
      );
    const grants = this.toolGrants(context);
    let executionFailure: Error | undefined;
    const partialOperations: z.output<typeof PartialOperationSchema>[] = [];
    const recordedPartialFailures = new Set<PartialOperationFailure>();
    const tools = new InFlightSkillToolExecutionTracker();
    let propagatingSiblingQuestion = false;
    const recordExecutionFailure = (cause: unknown) => {
      if (isGraphInterrupt(cause)) return;
      if (cause instanceof PartialOperationFailure && !recordedPartialFailures.has(cause)) {
        recordedPartialFailures.add(cause);
        partialOperations.push(...cause.operations);
      }
      executionFailure = cause instanceof Error ? cause : new Error(String(cause));
    };
    const rejectDependentWork = () => {
      if (executionFailure !== undefined) throw executionFailure;
    };
    const shared: StructuredTool[] = [
      tool(
        async ({ operationId, input }) => {
          rejectDependentWork();
          return tools.track(async () => {
            try {
              const descriptor = this.operations.list().find((entry) => entry.id === operationId);
              if (descriptor === undefined) throw new Error(`Unknown operation: ${operationId}`);
              const fresh = RuntimeSnapshotSchema.parse(await this.observe(context));
              if (JSON.stringify(fresh.context) !== JSON.stringify(context)) {
                throw new DeepAgentsSkillConfigurationError(
                  "Operation evidence belongs to a different caller context.",
                );
              }
              for (const effect of descriptor.effects) {
                const capability = this.permissionForEffect(effect);
                if (fresh.permissions[capability]?.state !== "available") {
                  throw new CapabilityToolDeniedError({
                    toolName: `operation:${operationId}`,
                    capability,
                  });
                }
              }
              const result = await this.operations.invoke(operationId, input);
              if (result.status === "partial") {
                throw new PartialOperationFailure({
                  operations: [
                    {
                      operationId,
                      status: "partial",
                      data: result.data,
                      error: result.error,
                    },
                  ],
                });
              }
              if (result.status === "error") {
                throw new Error(`${result.error.name}: ${result.error.message}`);
              }
              return result;
            } catch (cause) {
              recordExecutionFailure(cause);
              throw cause;
            }
          });
        },
        {
          name: "flight_rules_operation",
          description: "Run a launch-authorized shared flight-rules operation.",
          schema: z.object({ operationId: z.string(), input: z.record(z.string(), z.unknown()) }),
        },
      ),
      tool(
        async ({ agent, dispatchId, input }) => {
          rejectDependentWork();
          return tools.track(async () => {
            try {
              const request = DispatchRequestSchema.parse({
                id: dispatchId,
                agent,
                context,
                input,
              });
              const registration = this.agents.find(
                (candidate) => candidate.frontmatter.name === request.agent,
              );
              if (registration === undefined) {
                const decision = this.orchestration.prepare(request, observed);
                if (decision.status !== "ready")
                  throw new Error(`${decision.failure.code}: ${decision.failure.message}`);
              }
              const fresh = RuntimeSnapshotSchema.parse(await this.observe(context, registration));
              if (JSON.stringify(fresh.context) !== JSON.stringify(context)) {
                throw new DeepAgentsSkillConfigurationError(
                  "Worker evidence belongs to a different caller context.",
                );
              }
              const decision = this.orchestration.prepare(request, fresh);
              if (decision.status !== "ready")
                throw new Error(`${decision.failure.code}: ${decision.failure.message}`);
              const outcome: DispatchOutcome<ValidatedWorkerReport> =
                await this.workers.dispatch(request);
              if (outcome.status !== "completed") {
                throw new Error(`${outcome.failure.code}: ${outcome.failure.message}`);
              }
              return outcome;
            } catch (cause) {
              recordExecutionFailure(cause);
              throw cause;
            }
          });
        },
        {
          name: "flight_rules_dispatch",
          description: "Dispatch one registered named worker under observed host grants.",
          schema: z.object({
            agent: z.string(),
            dispatchId: z.string(),
            input: z.record(z.string(), z.json()),
          }),
        },
      ),
      tool(
        async ({ siblingSkill, input }) => {
          rejectDependentWork();
          const sibling = this.orchestration.sibling({ context, skill: siblingSkill, input });
          const pausedSibling = this.siblingPauses.get(threadId);
          if (pausedSibling !== undefined) {
            return tools.track(() => this.resumeSibling(threadId, pausedSibling));
          }
          return tools.track(async () => {
            try {
              const result = await AsyncLocalStorageProviderSingleton.getInstance().run(
                undefined,
                () =>
                  this.invoke(sibling.skill, sibling.context, sibling.input, {
                    allowHumanQuestions,
                  }),
              );
              if (result.status === "paused") {
                this.siblingPauses.set(threadId, result);
                propagatingSiblingQuestion = true;
                return await this.resumeSibling(threadId, result);
              }
              if (result.status === "failed") {
                if (result.failure.operations !== undefined) {
                  throw new PartialOperationFailure({ operations: result.failure.operations });
                }
                throw new Error(result.failure.message);
              }
              return result;
            } catch (cause) {
              if (!propagatingSiblingQuestion && !isGraphInterrupt(cause)) {
                recordExecutionFailure(cause);
              }
              throw cause;
            }
          });
        },
        {
          name: "flight_rules_sibling_skill",
          description: "Invoke another canonical skill with this same caller context.",
          schema: z.object({ siblingSkill: z.string(), input: z.record(z.string(), z.unknown()) }),
        },
      ),
    ];
    shared.push(
      tool(
        async ({ question }) => {
          const questionId = randomUUID();
          const fresh = RuntimeSnapshotSchema.parse(await this.observe(context));
          const decision = this.orchestration.ask(
            { context, question, allowHumanQuestions },
            fresh,
          );
          if (decision.status !== "awaiting-answer") {
            executionFailure = new Error(`${decision.failure.code}: ${decision.failure.message}`);
            throw executionFailure;
          }
          const answer = interrupt({ questionId, question });
          return answer;
        },
        {
          name: "flight_rules_ask_human",
          description: "Pause this skill and wait for an actual answer from the human caller.",
          schema: z.object({ question: z.string().min(1) }),
        },
      ),
    );
    const model = this.models.standard;
    const skillDefinition: AgentDefinition = {
      frontmatter: {
        name: "skill-runtime",
        description: "Execute a canonical workflow skill.",
        model: "standard",
        capabilities: AgentFrontmatterSchema.shape.capabilities.parse(
          ["read", "edit", "shell", "web", "spawn", "ask"].filter(
            (capability) => observed.permissions[capability]?.state === "available",
          ),
        ),
      },
      body: instruction.contents,
    };
    const suppliedHostTools = this.policy.toolsFor(skillDefinition, grants, observed);
    const trackToolExecution = async <T>(execution: () => Promise<T>): Promise<T> =>
      tools.track(async () => {
        try {
          rejectDependentWork();
          return await execution();
        } catch (cause) {
          recordExecutionFailure(cause);
          throw cause;
        }
      });
    const subagents = this.policy.middlewareFor(
      model,
      skillDefinition,
      suppliedHostTools,
      trackToolExecution,
      (error) => {
        recordExecutionFailure(error);
      },
      shared.map((entry) => entry.name),
    );
    const questionBoundary = createMiddleware({
      name: "FlightRulesQuestionBoundary",
      wrapModelCall: async (request, handler) => {
        const response = await handler(request);
        const calls = response.tool_calls ?? [];
        const question = calls.find((call) => call.name === "flight_rules_ask_human");
        // A sibling can ask before returning, so its batch cannot run dependent tools in parallel.
        const boundary =
          question ?? calls.find((call) => call.name === "flight_rules_sibling_skill");
        if (boundary !== undefined) {
          response.tool_calls = [boundary];
        }
        return response;
      },
    });
    const middleware = [
      createMiddleware({ name: "FilesystemMiddleware" }),
      ...subagents.slice(1),
      questionBoundary,
    ];
    return {
      graph: createDeepAgent({
        name: instruction.name,
        model,
        tools: [...shared, ...suppliedHostTools],
        checkpointer: this.checkpointer,
        middleware,
      }),
      get failure() {
        return executionFailure;
      },
      partialOperations,
      tools,
    };
  }

  private permissionForEffect(effect: OperationEffect): "read" | "edit" | "shell" | "web" {
    switch (effect) {
      case "read":
        return "read";
      case "write":
        return "edit";
      case "process":
        return "shell";
      case "network":
        return "web";
    }
  }

  private resumeSibling(
    threadId: string,
    paused: PausedSkillResult,
  ): Promise<DeepAgentsSkillResult> {
    const answerValue = interrupt({ questionId: paused.questionId, question: paused.question });
    const answer = z.object({ questionId: z.string(), answer: z.string() }).parse(answerValue);
    if (answer.questionId !== paused.questionId) {
      throw new InvalidSkillResumeError("The answer belongs to another sibling question.");
    }
    return this.resume({
      context: paused.context,
      pauseId: paused.pauseId,
      questionId: paused.questionId,
      answer: answer.answer,
    }).then((result) => {
      if (result.status === "paused") {
        this.siblingPauses.set(threadId, result);
        return this.resumeSibling(threadId, result);
      }
      this.siblingPauses.delete(threadId);
      if (result.status === "failed") {
        if (result.failure.operations !== undefined) {
          throw new PartialOperationFailure({ operations: result.failure.operations });
        }
        throw new Error(result.failure.message);
      }
      return result;
    });
  }

  private questionInterruptionFromError(cause: unknown) {
    const schema = z.array(z.object({ id: z.string().optional(), value: z.unknown() }));
    if (!(cause instanceof Error)) return schema.safeParse(null);
    try {
      return schema.safeParse(JSON.parse(cause.message));
    } catch {
      return schema.safeParse(null);
    }
  }

  private result(
    graph: ReturnType<typeof createDeepAgent>,
    result: Awaited<ReturnType<typeof graph.invoke>>,
    context: CallerContext,
    invocationId: string,
    threadId: string,
    skill: string,
    allowHumanQuestions: boolean,
  ): DeepAgentsSkillResult {
    const graphResult = z.record(z.string(), z.unknown()).parse(result);
    const messages = z.array(z.instanceof(BaseMessage)).parse(graphResult["messages"]);
    const interruptions = z
      .array(z.object({ value: z.unknown() }))
      .safeParse(graphResult["__interrupt__"]);
    const task = interruptions.success ? interruptions.data[0] : undefined;
    const question =
      task === undefined
        ? undefined
        : z.object({ questionId: z.string(), question: z.string() }).safeParse(task.value);
    if (question?.success === true) {
      const pauseId = randomUUID();
      const value = question.data;
      this.pending.set(pauseId, {
        context,
        invocationId,
        pauseId,
        questionId: value.questionId,
        threadId,
        skill,
        allowHumanQuestions,
        state: "paused",
      });
      return {
        status: "paused",
        context,
        invocationId,
        pauseId,
        questionId: value.questionId,
        question: value.question,
      };
    }
    const finalMessage = messages
      .toReversed()
      .find((message: BaseMessageType) => isAIMessage(message));
    return { status: "completed", context, invocationId, report: finalMessage?.content ?? "" };
  }
}

export { LangChainDeepAgentsSkillRuntime as DeepAgentsSkillRuntime };
