import { z } from "zod";
import type { AgentDefinition } from "../agents/agent-registry/agent-registry.js";
import type { OperationRegistry, OperationSummary } from "../operations/operation-registry.js";
import type { OperationEffect } from "../operations/operation.schema.js";
import type { OrchestrationPolicy } from "../orchestration/orchestration-policy.js";
import { DispatchRequestSchema, type CallerContext, type DispatchOutcome, type SiblingSkillRequest, type RuntimeSnapshot } from "../orchestration/orchestration.schema.js";
import type { CanonicalInstruction } from "./instruction-catalog-core.js";
import type { ValidatedWorkerReport } from "./report-codec.js";
import { type DispatchOptions } from "./worker-runtime-core.js";
export declare const skillToolNames: {
    readonly operation: "flight_rules_operation";
    readonly dispatch: "flight_rules_dispatch";
    readonly sibling: "flight_rules_sibling_skill";
    readonly ask: "flight_rules_ask_human";
};
export type SkillRuntimeObserver = (context: CallerContext, registration?: AgentDefinition) => Promise<RuntimeSnapshot>;
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
declare const PartialOperationSchema: z.ZodObject<{
    operationId: z.ZodString;
    status: z.ZodLiteral<"partial">;
    data: z.ZodUnknown;
    error: z.ZodObject<{
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
declare const PartialOperationFailurePropsSchema: z.ZodObject<{
    operations: z.ZodArray<z.ZodObject<{
        operationId: z.ZodString;
        status: z.ZodLiteral<"partial">;
        data: z.ZodUnknown;
        error: z.ZodObject<{
            name: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PartialOperation = z.output<typeof PartialOperationSchema>;
export type SkillResult<T = unknown> = {
    status: "completed";
    context: CallerContext;
    invocationId: string;
    report: T;
} | PausedSkillResult | {
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
export declare class PartialOperationFailure extends Error {
    name: string;
    readonly operations: PartialOperation[];
    constructor(props: z.input<typeof PartialOperationFailurePropsSchema>);
}
export declare class InvalidSkillResumeError extends Error {
    name: string;
}
export declare class SkillConfigurationError extends Error {
    name: string;
}
/** A failure that reports its own terminal code instead of the generic tool failure code. */
export declare class CodedSkillError extends Error {
    name: string;
    readonly failureCode: string;
    constructor(props: {
        failureCode: string;
        message: string;
    });
}
export interface CallerContextComparison {
    matches(left: CallerContext, right: CallerContext): boolean;
}
export declare class DeepCallerContextComparison implements CallerContextComparison {
    matches(left: CallerContext, right: CallerContext): boolean;
}
export declare const callerContexts: CallerContextComparison;
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
export declare class PendingPauseRegistry<TSession> {
    private readonly pending;
    private readonly siblingPauses;
    register(entry: NewPendingPause<TSession>): PendingPause<TSession>;
    /** Validates the request against its pause and reserves it so a concurrent resume cannot share it. */
    reserve(request: SkillResumeRequest): PendingPause<TSession>;
    release(pause: PendingPause<TSession>): void;
    consume(pause: PendingPause<TSession>): void;
    /** Removes a paused skill for its own caller and cancels any sibling pause it was carrying. */
    cancel(context: CallerContext, pauseId: string): PendingPause<TSession>;
    carrySibling(runKey: string, paused: PausedSkillResult): void;
    siblingOf(runKey: string): PausedSkillResult | undefined;
    releaseSibling(runKey: string): void;
}
/** Confirms the host still offers human questions for the original caller before a paused skill continues. */
export declare class FreshQuestionAccess {
    private readonly observe;
    constructor(props: {
        observe: SkillRuntimeObserver;
    });
    assertAvailable(caller: CallerContext): Promise<void>;
}
export interface SkillExecutionProps {
    ignores?: (cause: unknown) => boolean;
}
/** Tracks one skill run's in-flight tool work and the first failure that must end it, whatever the model reports afterwards. */
export declare class SkillExecution {
    readonly partialOperations: PartialOperation[];
    private readonly active;
    private readonly recordedPartials;
    private readonly ignores;
    private firstFailure;
    constructor(props?: SkillExecutionProps);
    get failure(): Error | undefined;
    track<T>(execution: () => Promise<T>): Promise<T>;
    waitForIdle(): Promise<void>;
    recordFailure(cause: unknown): void;
    rejectDependentWork(): void;
    /** Runs one tool call as tracked work that refuses to start after a failure and records its own. */
    run<T>(execution: () => Promise<T>): Promise<T>;
}
export interface SkillFailureReport {
    context: CallerContext;
    invocationId: string;
    signal?: AbortSignal | undefined;
    execution?: SkillExecution | undefined;
    cause: unknown;
}
/** Builds the terminal failed result: cancellation first, then the recorded tool failure, then the thrown cause. */
export declare class SkillFailureReporter {
    failed(report: SkillFailureReport): Extract<SkillResult, {
        status: "failed";
    }>;
    cancelled(context: CallerContext, invocationId: string): Extract<SkillResult, {
        status: "failed";
    }>;
    private codeFor;
    private messageFor;
}
export declare const skillFailures: SkillFailureReporter;
/** Maps what an operation does to the host capability that must be observed available before it runs. */
export declare class OperationEffectCapabilities {
    capabilityFor(effect: OperationEffect): "read" | "edit" | "shell" | "web";
}
export declare const operationEffectCapabilities: OperationEffectCapabilities;
export interface ShellOperationRedirect {
    route: string;
    operationId: string;
}
export interface ShellOperationRedirects {
    redirectFor(command: string): ShellOperationRedirect | undefined;
}
declare const SkillOperationRoutesPropsSchema: z.ZodObject<{
    operations: z.ZodArray<z.ZodCustom<OperationSummary, OperationSummary>>;
}, z.core.$strict>;
/** Maps the operations a launch admits to the `flight-rules <route>` commands skills write, for the prompt that names them and the guard that redirects shell calls to them. */
export declare class SkillOperationRoutes implements ShellOperationRedirects {
    private readonly routes;
    constructor(props: z.input<typeof SkillOperationRoutesPropsSchema>);
    promptSection(): string;
    redirectFor(command: string): ShellOperationRedirect | undefined;
    private flightRulesArguments;
}
/** Describes the skill run itself to the capability policy as one registration holding every capability the host observed. */
export declare class SkillAgentDefinitions {
    forSkill(instruction: CanonicalInstruction, observed: RuntimeSnapshot): AgentDefinition;
}
export declare const skillAgentDefinitions: SkillAgentDefinitions;
export interface SkillWorkerDispatcher {
    dispatch(request: z.input<typeof DispatchRequestSchema>, options?: DispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>>;
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
export declare class SharedSkillToolHandlers {
    private readonly props;
    constructor(props: SharedSkillToolHandlersProps);
    operation(args: {
        operationId: string;
        input: Record<string, unknown>;
    }): Promise<{
        status: "success";
        data: unknown;
    }>;
    dispatch(args: {
        agent: string;
        dispatchId: string;
        input: DispatchInput;
    }): Promise<{
        status: "completed";
        dispatchId: string;
        agent: string;
        context: CallerContext;
        report: ValidatedWorkerReport;
    }>;
    /** Runs the sibling skill through the binding's `run` and returns its completed or paused result; a failed sibling throws. */
    sibling(args: {
        siblingSkill: string;
        input: SiblingSkillRequest["input"];
    }, run: (sibling: SiblingSkillRequest) => Promise<SkillResult>, shouldRecord?: (cause: unknown) => boolean): Promise<SkillResult>;
    /** Re-checks the host's question policy for this caller and returns the question that must wait for a human. */
    ask(args: {
        question: string;
    }): Promise<PendingQuestion>;
    siblingFailure(result: Extract<SkillResult, {
        status: "failed";
    }>): Error;
}
export {};
