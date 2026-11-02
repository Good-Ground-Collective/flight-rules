import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AgentFrontmatterSchema } from "../agents/agent-frontmatter/agent-frontmatter.schema.js";
import type { AgentDefinition } from "../agents/agent-registry/agent-registry.js";
import type { OperationRegistry } from "../operations/operation-registry.js";
import type { OperationEffect } from "../operations/operation.schema.js";
import type { OrchestrationPolicy } from "../orchestration/orchestration-policy.js";
import {
  DispatchRequestSchema,
  RuntimeSnapshotSchema,
  type CallerContext,
  type DispatchOutcome,
  type SiblingSkillRequest,
  type RuntimeSnapshot,
} from "../orchestration/orchestration.schema.js";
import type { CanonicalInstruction } from "./instruction-catalog-core.js";
import type { ValidatedWorkerReport } from "./report-codec.js";
import { CapabilityToolDeniedError, type DispatchOptions } from "./worker-runtime-core.js";

export const skillToolNames = {
  operation: "flight_rules_operation",
  dispatch: "flight_rules_dispatch",
  sibling: "flight_rules_sibling_skill",
  ask: "flight_rules_ask_human",
} as const;

export type SkillRuntimeObserver = (
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

const PartialOperationSchema = z.strictObject({
  operationId: z.string().min(1),
  status: z.literal("partial"),
  data: z.unknown(),
  error: z.strictObject({ name: z.string().min(1), message: z.string() }),
});
const PartialOperationFailurePropsSchema = z.strictObject({
  operations: z.array(PartialOperationSchema).min(1),
});

export type PartialOperation = z.output<typeof PartialOperationSchema>;

export type SkillResult<T = unknown> =
  | {
      status: "completed";
      context: CallerContext;
      invocationId: string;
      report: T;
    }
  | PausedSkillResult
  | {
      status: "failed";
      context: CallerContext;
      invocationId: string;
      failure: {
        code: string;
        message: string;
        operations?: PartialOperation[];
      };
    };

/** A shared operation that wrote some of its effects before failing; the written data survives into the terminal failure. */
export class PartialOperationFailure extends Error {
  override name = "PartialOperationFailure";
  readonly operations: PartialOperation[];

  constructor(props: z.input<typeof PartialOperationFailurePropsSchema>) {
    const parsed = PartialOperationFailurePropsSchema.parse(props);
    super(parsed.operations.map(({ error }) => `${error.name}: ${error.message}`).join("; "));
    this.operations = parsed.operations;
  }
}

export class InvalidSkillResumeError extends Error {
  override name = "InvalidSkillResumeError";
}

export class SkillConfigurationError extends Error {
  override name = "SkillConfigurationError";
}

/** A failure that reports its own terminal code instead of the generic tool failure code. */
export class CodedSkillError extends Error {
  override name = "CodedSkillError";
  readonly failureCode: string;

  constructor(props: { failureCode: string; message: string }) {
    super(props.message);
    this.failureCode = props.failureCode;
  }
}

export interface CallerContextComparison {
  matches(left: CallerContext, right: CallerContext): boolean;
}

export class DeepCallerContextComparison implements CallerContextComparison {
  matches(left: CallerContext, right: CallerContext): boolean {
    return isDeepStrictEqual(left, right);
  }
}

export const callerContexts: CallerContextComparison = new DeepCallerContextComparison();

export interface PendingPause<TSession> {
  context: CallerContext;
  invocationId: string;
  pauseId: string;
  questionId: string;
  skill: string;
  allowHumanQuestions: boolean;
  runKey: string;
  session: TSession;
  state: "paused" | "resuming";
}

export type NewPendingPause<TSession> = Omit<PendingPause<TSession>, "pauseId" | "state">;

/** Holds every paused skill until a caller answers or cancels it, so one pause can be resumed exactly once. */
export class PendingPauseRegistry<TSession> {
  private readonly pending = new Map<string, PendingPause<TSession>>();
  private readonly siblingPauses = new Map<string, PausedSkillResult>();

  register(entry: NewPendingPause<TSession>): PendingPause<TSession> {
    const pause: PendingPause<TSession> = {
      ...entry,
      pauseId: randomUUID(),
      state: "paused",
    };
    this.pending.set(pause.pauseId, pause);
    return pause;
  }

  /** Validates the request against its pause and reserves it so a concurrent resume cannot share it. */
  reserve(request: SkillResumeRequest): PendingPause<TSession> {
    const pause = this.pending.get(request.pauseId);
    if (
      pause === undefined ||
      pause.questionId !== request.questionId ||
      !callerContexts.matches(pause.context, request.context) ||
      pause.state !== "paused"
    ) {
      throw new InvalidSkillResumeError(
        "The pause, question or caller context is missing, stale or does not match.",
      );
    }
    if (request.answer.trim().length === 0) {
      throw new InvalidSkillResumeError("A human answer is required to resume this question.");
    }
    pause.state = "resuming";
    return pause;
  }

  release(pause: PendingPause<TSession>): void {
    if (this.pending.get(pause.pauseId) === pause) pause.state = "paused";
  }

  consume(pause: PendingPause<TSession>): void {
    this.pending.delete(pause.pauseId);
  }

  /** Removes a paused skill for its own caller and cancels any sibling pause it was carrying. */
  cancel(context: CallerContext, pauseId: string): PendingPause<TSession> {
    const pause = this.pending.get(pauseId);
    if (
      pause === undefined ||
      pause.state !== "paused" ||
      !callerContexts.matches(pause.context, context)
    ) {
      throw new InvalidSkillResumeError(
        "The pause is missing or belongs to another caller context.",
      );
    }
    this.pending.delete(pauseId);
    const sibling = this.siblingPauses.get(pause.runKey);
    if (sibling !== undefined) {
      this.siblingPauses.delete(pause.runKey);
      this.cancel(context, sibling.pauseId);
    }
    return pause;
  }

  carrySibling(runKey: string, paused: PausedSkillResult): void {
    this.siblingPauses.set(runKey, paused);
  }

  siblingOf(runKey: string): PausedSkillResult | undefined {
    return this.siblingPauses.get(runKey);
  }

  releaseSibling(runKey: string): void {
    this.siblingPauses.delete(runKey);
  }
}

/** Confirms the host still offers human questions for the original caller before a paused skill continues. */
export class FreshQuestionAccess {
  private readonly observe: SkillRuntimeObserver;

  constructor(props: { observe: SkillRuntimeObserver }) {
    this.observe = props.observe;
  }

  async assertAvailable(caller: CallerContext): Promise<void> {
    const snapshot = RuntimeSnapshotSchema.parse(await this.observe(caller));
    if (!callerContexts.matches(snapshot.context, caller) || snapshot.ask.state !== "available") {
      throw new InvalidSkillResumeError(
        "Fresh question access is unavailable for the original caller context.",
      );
    }
  }
}

export interface SkillExecutionProps {
  ignores?: (cause: unknown) => boolean;
}

/** Tracks one skill run's in-flight tool work and the first failure that must end it, whatever the model reports afterwards. */
export class SkillExecution {
  readonly partialOperations: PartialOperation[] = [];
  private readonly active = new Set<Promise<unknown>>();
  private readonly recordedPartials = new Set<PartialOperationFailure>();
  private readonly ignores: (cause: unknown) => boolean;
  private firstFailure: Error | undefined;

  constructor(props: SkillExecutionProps = {}) {
    this.ignores = props.ignores ?? (() => false);
  }

  get failure(): Error | undefined {
    return this.firstFailure;
  }

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

  recordFailure(cause: unknown): void {
    if (this.ignores(cause)) return;
    if (cause instanceof PartialOperationFailure && !this.recordedPartials.has(cause)) {
      this.recordedPartials.add(cause);
      this.partialOperations.push(...cause.operations);
    }
    this.firstFailure = cause instanceof Error ? cause : new Error(String(cause));
  }

  rejectDependentWork(): void {
    if (this.firstFailure !== undefined) throw this.firstFailure;
  }

  /** Runs one tool call as tracked work that refuses to start after a failure and records its own. */
  async run<T>(execution: () => Promise<T>): Promise<T> {
    return this.track(async () => {
      try {
        this.rejectDependentWork();
        return await execution();
      } catch (cause) {
        this.recordFailure(cause);
        throw cause;
      }
    });
  }
}

export interface SkillFailureReport {
  context: CallerContext;
  invocationId: string;
  signal?: AbortSignal | undefined;
  execution?: SkillExecution | undefined;
  cause: unknown;
}

/** Builds the terminal failed result: cancellation first, then the recorded tool failure, then the thrown cause. */
export class SkillFailureReporter {
  failed(report: SkillFailureReport): Extract<SkillResult, { status: "failed" }> {
    const recorded = report.execution?.failure;
    const operations = report.execution?.partialOperations ?? [];
    return {
      status: "failed",
      context: report.context,
      invocationId: report.invocationId,
      failure: {
        code: this.codeFor(report.signal, recorded),
        message: this.messageFor(recorded, report.cause),
        ...(operations.length > 0 ? { operations } : {}),
      },
    };
  }

  cancelled(
    context: CallerContext,
    invocationId: string,
  ): Extract<SkillResult, { status: "failed" }> {
    return {
      status: "failed",
      context,
      invocationId,
      failure: {
        code: "CANCELLED",
        message: "The caller cancelled this paused skill.",
      },
    };
  }

  private codeFor(signal: AbortSignal | undefined, recorded: Error | undefined): string {
    if (signal?.aborted) return "CANCELLED";
    if (recorded === undefined) return "EXECUTION_FAILED";
    return recorded instanceof CodedSkillError ? recorded.failureCode : "TOOL_FAILED";
  }

  private messageFor(recorded: Error | undefined, cause: unknown): string {
    if (recorded !== undefined) return recorded.message;
    return cause instanceof Error ? cause.message : String(cause);
  }
}

export const skillFailures = new SkillFailureReporter();

/** Maps what an operation does to the host capability that must be observed available before it runs. */
export class OperationEffectCapabilities {
  capabilityFor(effect: OperationEffect): "read" | "edit" | "shell" | "web" {
    if (effect === "read") return "read";
    if (effect === "write") return "edit";
    if (effect === "process") return "shell";
    return "web";
  }
}

export const operationEffectCapabilities = new OperationEffectCapabilities();

/** Describes the skill run itself to the capability policy as one registration holding every capability the host observed. */
export class SkillAgentDefinitions {
  forSkill(instruction: CanonicalInstruction, observed: RuntimeSnapshot): AgentDefinition {
    return {
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
  }
}

export const skillAgentDefinitions = new SkillAgentDefinitions();

export interface SkillWorkerDispatcher {
  dispatch(
    request: z.input<typeof DispatchRequestSchema>,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>>;
}

export interface SharedSkillToolHandlersProps {
  context: CallerContext;
  allowHumanQuestions: boolean;
  launch: RuntimeSnapshot;
  agents: readonly AgentDefinition[];
  operations: OperationRegistry;
  workers: SkillWorkerDispatcher;
  observe: SkillRuntimeObserver;
  orchestration: OrchestrationPolicy;
  execution: SkillExecution;
  signal?: AbortSignal | undefined;
}

type DispatchInput = z.input<typeof DispatchRequestSchema>["input"];

export interface PendingQuestion {
  questionId: string;
  question: string;
}

/** The operation, dispatch, sibling and ask behavior every runtime binding offers its model, bound to one launch's caller context and evidence. */
export class SharedSkillToolHandlers {
  private readonly props: SharedSkillToolHandlersProps;

  constructor(props: SharedSkillToolHandlersProps) {
    this.props = props;
  }

  async operation(args: { operationId: string; input: Record<string, unknown> }) {
    const { context, operations, observe, execution } = this.props;
    execution.rejectDependentWork();
    return execution.track(async () => {
      try {
        const descriptor = operations.list().find((entry) => entry.id === args.operationId);
        if (descriptor === undefined) throw new Error(`Unknown operation: ${args.operationId}`);

        const fresh = RuntimeSnapshotSchema.parse(await observe(context));
        if (!callerContexts.matches(fresh.context, context)) {
          throw new SkillConfigurationError(
            "Operation evidence belongs to a different caller context.",
          );
        }
        for (const effect of descriptor.effects) {
          const capability = operationEffectCapabilities.capabilityFor(effect);
          if (fresh.permissions[capability]?.state !== "available") {
            throw new CapabilityToolDeniedError({
              toolName: `operation:${args.operationId}`,
              capability,
            });
          }
        }

        const result = await operations.invoke(args.operationId, args.input);
        if (result.status === "partial") {
          throw new PartialOperationFailure({
            operations: [
              {
                operationId: args.operationId,
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
        execution.recordFailure(cause);
        throw cause;
      }
    });
  }

  async dispatch(args: { agent: string; dispatchId: string; input: DispatchInput }) {
    const { context, launch, agents, workers, observe, orchestration, execution, signal } =
      this.props;
    execution.rejectDependentWork();
    return execution.track(async () => {
      try {
        const request = DispatchRequestSchema.parse({
          id: args.dispatchId,
          agent: args.agent,
          context,
          input: args.input,
        });
        const registration = agents.find(
          (candidate) => candidate.frontmatter.name === request.agent,
        );
        if (registration === undefined) {
          const decision = orchestration.prepare(request, launch);
          if (decision.status !== "ready") {
            throw new Error(`${decision.failure.code}: ${decision.failure.message}`);
          }
        }

        const fresh = RuntimeSnapshotSchema.parse(await observe(context, registration));
        if (!callerContexts.matches(fresh.context, context)) {
          throw new SkillConfigurationError(
            "Worker evidence belongs to a different caller context.",
          );
        }
        const decision = orchestration.prepare(request, fresh);
        if (decision.status !== "ready") {
          throw new Error(`${decision.failure.code}: ${decision.failure.message}`);
        }

        const outcome =
          signal === undefined
            ? await workers.dispatch(request)
            : await workers.dispatch(request, { signal });
        if (outcome.status !== "completed") {
          throw new Error(`${outcome.failure.code}: ${outcome.failure.message}`);
        }
        return outcome;
      } catch (cause) {
        execution.recordFailure(cause);
        throw cause;
      }
    });
  }

  /** Runs the sibling skill through the binding's `run` and returns its completed or paused result; a failed sibling throws. */
  async sibling(
    args: { siblingSkill: string; input: SiblingSkillRequest["input"] },
    run: (sibling: SiblingSkillRequest) => Promise<SkillResult>,
    shouldRecord: (cause: unknown) => boolean = () => true,
  ): Promise<SkillResult> {
    const { context, orchestration, execution } = this.props;
    execution.rejectDependentWork();
    const sibling = orchestration.sibling({
      context,
      skill: args.siblingSkill,
      input: args.input,
    });
    return execution.track(async () => {
      try {
        const result = await run(sibling);
        if (result.status === "failed") throw this.siblingFailure(result);
        return result;
      } catch (cause) {
        if (shouldRecord(cause)) execution.recordFailure(cause);
        throw cause;
      }
    });
  }

  /** Re-checks the host's question policy for this caller and returns the question that must wait for a human. */
  async ask(args: { question: string }): Promise<PendingQuestion> {
    const { context, allowHumanQuestions, observe, orchestration, execution } = this.props;
    const questionId = randomUUID();
    const fresh = RuntimeSnapshotSchema.parse(await observe(context));
    const decision = orchestration.ask(
      { context, question: args.question, allowHumanQuestions },
      fresh,
    );
    if (decision.status !== "awaiting-answer") {
      const failure = new Error(`${decision.failure.code}: ${decision.failure.message}`);
      execution.recordFailure(failure);
      throw failure;
    }
    return { questionId, question: args.question };
  }

  siblingFailure(result: Extract<SkillResult, { status: "failed" }>): Error {
    if (result.failure.operations !== undefined) {
      return new PartialOperationFailure({
        operations: result.failure.operations,
      });
    }
    return new Error(result.failure.message);
  }
}
