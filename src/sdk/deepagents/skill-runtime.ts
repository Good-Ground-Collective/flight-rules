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
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import { RegistryOrchestrationPolicy } from "../../orchestration/orchestration-policy.js";
import {
  CallerContextSchema,
  RuntimeSnapshotSchema,
  type CallerContext,
} from "../../orchestration/orchestration.schema.js";
import type { OperationRegistry } from "../../operations/operation-registry.js";
import type { InstructionCatalog } from "../instruction-catalog.js";
import {
  FreshQuestionAccess,
  InvalidSkillResumeError,
  PendingPauseRegistry,
  SharedSkillToolHandlers,
  SkillConfigurationError,
  SkillExecution,
  skillAgentDefinitions,
  skillFailures,
  skillToolNames,
  type PausedSkillResult,
  type SkillInvocationOptions,
  type SkillResult,
  type SkillResumeRequest,
  type SkillRuntimeObserver,
} from "../skill-runtime-core.js";
import type { DeepAgentsWorkerRuntimeContract } from "./deepagents-runtime.js";
import { CapabilityScopedDeepAgentsToolPolicy, type WorkerToolGrants } from "./tool-policy.js";

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
export type DeepAgentsSkillRuntimeObserver = SkillRuntimeObserver;
export type DeepAgentsSkillResult<T = unknown> = SkillResult<T>;
export type { PausedSkillResult, SkillInvocationOptions, SkillResumeRequest };
export { InvalidSkillResumeError };

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

export class DeepAgentsSkillConfigurationError extends SkillConfigurationError {
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
  private readonly pauses = new PendingPauseRegistry<string>();
  private readonly questionAccess: FreshQuestionAccess;
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
    this.orchestration = new RegistryOrchestrationPolicy({
      agents: this.agents,
    });
    this.questionAccess = new FreshQuestionAccess({ observe: this.observe });
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
      await execution.run.waitForIdle();
      if (execution.run.failure !== undefined) throw execution.run.failure;
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
      await execution?.run.waitForIdle();
      const interruption = isGraphInterrupt(cause)
        ? z
            .array(
              z.object({
                id: z.string().optional(),
                value: z.unknown(),
              }),
            )
            .safeParse(cause.interrupts)
        : this.questionInterruptionFromError(cause);
      const question = interruption.success
        ? z
            .object({
              questionId: z.string(),
              question: z.string(),
            })
            .safeParse(interruption.data[0]?.value)
        : undefined;
      if (
        question?.success === true &&
        options.allowHumanQuestions === true &&
        isGraphInterrupt(cause)
      ) {
        const pause = this.pauses.register({
          context: caller,
          invocationId,
          questionId: question.data.questionId,
          skill,
          allowHumanQuestions: true,
          runKey: threadId,
          session: threadId,
        });
        return {
          status: "paused",
          context: caller,
          invocationId,
          pauseId: pause.pauseId,
          questionId: question.data.questionId,
          question: question.data.question,
        };
      }
      return skillFailures.failed({
        context: caller,
        invocationId,
        signal: options.signal,
        execution: execution?.run,
        cause,
      });
    }
  }

  async resume(request: SkillResumeRequest): Promise<DeepAgentsSkillResult> {
    const caller = CallerContextSchema.parse(request.context);
    const pending = this.pauses.reserve({ ...request, context: caller });
    let execution: Awaited<ReturnType<LangChainDeepAgentsSkillRuntime["createGraph"]>> | undefined;
    let continuationStarted = false;
    try {
      await this.questionAccess.assertAvailable(caller);
      execution = await this.createGraph(
        pending.skill,
        caller,
        pending.allowHumanQuestions,
        pending.session,
      );
      this.pauses.consume(pending);
      continuationStarted = true;
      const result = await execution.graph.invoke(
        new Command({
          resume: {
            questionId: request.questionId,
            answer: request.answer,
          },
        }),
        {
          configurable: { thread_id: pending.session },
          recursionLimit: this.maxGraphSteps,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      await execution.run.waitForIdle();
      if (execution.run.failure !== undefined) throw execution.run.failure;
      return this.result(
        execution.graph,
        result,
        caller,
        pending.invocationId,
        pending.session,
        pending.skill,
        pending.allowHumanQuestions,
      );
    } catch (cause) {
      await execution?.run.waitForIdle();
      if (!continuationStarted) this.pauses.release(pending);
      return skillFailures.failed({
        context: caller,
        invocationId: pending.invocationId,
        signal: request.signal,
        execution: execution?.run,
        cause,
      });
    }
  }

  cancel(context: CallerContext, pauseId: string): DeepAgentsSkillResult {
    const caller = CallerContextSchema.parse(context);
    const pending = this.pauses.cancel(caller, pauseId);
    return skillFailures.cancelled(caller, pending.invocationId);
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
    const run = new SkillExecution({ ignores: isGraphInterrupt });
    let propagatingSiblingQuestion = false;
    const handlers = new SharedSkillToolHandlers({
      context,
      allowHumanQuestions,
      launch: observed,
      agents: this.agents,
      operations: this.operations,
      workers: this.workers,
      observe: this.observe,
      orchestration: this.orchestration,
      execution: run,
    });
    const shared: StructuredTool[] = [
      tool(async ({ operationId, input }) => handlers.operation({ operationId, input }), {
        name: skillToolNames.operation,
        description: "Run a launch-authorized shared flight-rules operation.",
        schema: z.object({
          operationId: z.string(),
          input: z.record(z.string(), z.unknown()),
        }),
      }),
      tool(
        async ({ agent, dispatchId, input }) => handlers.dispatch({ agent, dispatchId, input }),
        {
          name: skillToolNames.dispatch,
          description: "Dispatch one registered named worker under observed host grants.",
          schema: z.object({
            agent: z.string(),
            dispatchId: z.string(),
            input: z.record(z.string(), z.json()),
          }),
        },
      ),
      tool(
        async ({ siblingSkill, input }) =>
          handlers.sibling(
            { siblingSkill, input },
            async (sibling) => {
              const pausedSibling = this.pauses.siblingOf(threadId);
              if (pausedSibling !== undefined) {
                return this.resumeSibling(handlers, threadId, pausedSibling);
              }
              const result = await AsyncLocalStorageProviderSingleton.getInstance().run(
                undefined,
                () =>
                  this.invoke(sibling.skill, sibling.context, sibling.input, {
                    allowHumanQuestions,
                  }),
              );
              if (result.status === "paused") {
                this.pauses.carrySibling(threadId, result);
                propagatingSiblingQuestion = true;
                return await this.resumeSibling(handlers, threadId, result);
              }
              return result;
            },
            (cause) => !propagatingSiblingQuestion && !isGraphInterrupt(cause),
          ),
        {
          name: skillToolNames.sibling,
          description: "Invoke another canonical skill with this same caller context.",
          schema: z.object({
            siblingSkill: z.string(),
            input: z.record(z.string(), z.unknown()),
          }),
        },
      ),
      tool(
        async ({ question }) => {
          const pending = await handlers.ask({ question });
          return interrupt({
            questionId: pending.questionId,
            question: pending.question,
          });
        },
        {
          name: skillToolNames.ask,
          description: "Pause this skill and wait for an actual answer from the human caller.",
          schema: z.object({ question: z.string().min(1) }),
        },
      ),
    ];
    const model = this.models.standard;
    const skillDefinition = skillAgentDefinitions.forSkill(instruction, observed);
    const suppliedHostTools = this.policy.toolsFor(skillDefinition, grants, observed);
    const subagents = this.policy.middlewareFor(
      model,
      skillDefinition,
      suppliedHostTools,
      (execution) => run.run(execution),
      (error) => {
        run.recordFailure(error);
      },
      shared.map((entry) => entry.name),
    );
    const questionBoundary = createMiddleware({
      name: "FlightRulesQuestionBoundary",
      wrapModelCall: async (request, handler) => {
        const response = await handler(request);
        const calls = response.tool_calls ?? [];
        const question = calls.find((call) => call.name === skillToolNames.ask);
        // A sibling can ask before returning, so its batch cannot run dependent tools in parallel.
        const boundary = question ?? calls.find((call) => call.name === skillToolNames.sibling);
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
      run,
    };
  }

  private resumeSibling(
    handlers: SharedSkillToolHandlers,
    threadId: string,
    paused: PausedSkillResult,
  ): Promise<DeepAgentsSkillResult> {
    const answerValue = interrupt({
      questionId: paused.questionId,
      question: paused.question,
    });
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
        this.pauses.carrySibling(threadId, result);
        return this.resumeSibling(handlers, threadId, result);
      }
      this.pauses.releaseSibling(threadId);
      if (result.status === "failed") throw handlers.siblingFailure(result);
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
      const pause = this.pauses.register({
        context,
        invocationId,
        questionId: question.data.questionId,
        skill,
        allowHumanQuestions,
        runKey: threadId,
        session: threadId,
      });
      return {
        status: "paused",
        context,
        invocationId,
        pauseId: pause.pauseId,
        questionId: question.data.questionId,
        question: question.data.question,
      };
    }
    const finalMessage = messages
      .toReversed()
      .find((message: BaseMessageType) => isAIMessage(message));
    return {
      status: "completed",
      context,
      invocationId,
      report: finalMessage?.content ?? "",
    };
  }
}

export { LangChainDeepAgentsSkillRuntime as DeepAgentsSkillRuntime };
