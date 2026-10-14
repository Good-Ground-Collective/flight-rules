import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import { type CallerContext, type RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import type { OperationRegistry } from "../../operations/operation-registry.js";
import type { InstructionCatalog } from "../instruction-catalog.js";
import type { DeepAgentsWorkerRuntimeContract } from "./deepagents-runtime.js";
import { type WorkerToolGrants } from "./tool-policy.js";
declare const SkillRuntimePropsSchema: z.ZodObject<{
    instructions: z.ZodCustom<InstructionCatalog, InstructionCatalog>;
    agents: z.ZodArray<z.ZodObject<{
        frontmatter: z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            capabilities: z.ZodArray<z.ZodEnum<{
                edit: "edit";
                read: "read";
                shell: "shell";
                web: "web";
                spawn: "spawn";
                ask: "ask";
            }>>;
            model: z.ZodEnum<{
                standard: "standard";
                escalated: "escalated";
                expert: "expert";
            }>;
            modelReason: z.ZodOptional<z.ZodString>;
            reasoning: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            sandbox: z.ZodOptional<z.ZodObject<{
                fs: z.ZodEnum<{
                    "read-only": "read-only";
                    "workspace-write": "workspace-write";
                }>;
                network: z.ZodEnum<{
                    none: "none";
                    enabled: "enabled";
                }>;
            }, z.core.$strict>>;
            dispatch: z.ZodOptional<z.ZodObject<{
                maxConcurrent: z.ZodInt;
                maxDepth: z.ZodInt;
            }, z.core.$strict>>;
            "x-claude": z.ZodOptional<z.ZodObject<{
                color: z.ZodOptional<z.ZodEnum<{
                    red: "red";
                    blue: "blue";
                    green: "green";
                    yellow: "yellow";
                    purple: "purple";
                    orange: "orange";
                    pink: "pink";
                    cyan: "cyan";
                }>>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        body: z.ZodString;
    }, z.core.$strict>>;
    models: z.ZodObject<{
        standard: z.ZodInstanceOf<BaseChatModel<import("@langchain/core/language_models/chat_models").BaseChatModelCallOptions, import("langchain").BaseMessageChunk<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>>>;
        escalated: z.ZodInstanceOf<BaseChatModel<import("@langchain/core/language_models/chat_models").BaseChatModelCallOptions, import("langchain").BaseMessageChunk<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>>>;
        expert: z.ZodInstanceOf<BaseChatModel<import("@langchain/core/language_models/chat_models").BaseChatModelCallOptions, import("langchain").BaseMessageChunk<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>>>;
    }, z.core.$strict>;
    operations: z.ZodCustom<OperationRegistry, OperationRegistry>;
    workers: z.ZodCustom<DeepAgentsWorkerRuntimeContract, DeepAgentsWorkerRuntimeContract>;
    observe: z.ZodCustom<DeepAgentsSkillRuntimeObserver, DeepAgentsSkillRuntimeObserver>;
    toolGrants: z.ZodCustom<(context: CallerContext) => WorkerToolGrants, (context: CallerContext) => WorkerToolGrants>;
    checkpointer: z.ZodDefault<z.ZodCustom<BaseCheckpointSaver<number>, BaseCheckpointSaver<number>>>;
    maxGraphSteps: z.ZodDefault<z.ZodInt>;
}, z.core.$strict>;
export type DeepAgentsSkillRuntimeProps = z.input<typeof SkillRuntimePropsSchema>;
export type DeepAgentsSkillRuntimeObserver = (context: CallerContext, registration?: AgentDefinition) => Promise<RuntimeSnapshot>;
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
export type DeepAgentsSkillResult<T = unknown> = {
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
        operations?: {
            operationId: string;
            status: "partial";
            data: unknown;
            error: {
                name: string;
                message: string;
            };
        }[];
    };
};
export interface DeepAgentsSkillRuntimeContract {
    invoke(skill: string, context: CallerContext, input: Record<string, unknown>, options?: SkillInvocationOptions): Promise<DeepAgentsSkillResult>;
    resume(request: SkillResumeRequest): Promise<DeepAgentsSkillResult>;
    cancel(context: CallerContext, pauseId: string): DeepAgentsSkillResult;
}
export declare class InvalidSkillResumeError extends Error {
    name: string;
}
export declare class DeepAgentsSkillConfigurationError extends Error {
    name: string;
}
/** Executes canonical workflow instructions with shared operations and checkpointed human decisions. */
export declare class LangChainDeepAgentsSkillRuntime implements DeepAgentsSkillRuntimeContract {
    private readonly instructions;
    private readonly agents;
    private readonly models;
    private readonly operations;
    private readonly workers;
    private readonly observe;
    private readonly toolGrants;
    private readonly checkpointer;
    private readonly maxGraphSteps;
    private readonly pending;
    private readonly siblingPauses;
    private readonly policy;
    private readonly orchestration;
    constructor(props: DeepAgentsSkillRuntimeProps);
    invoke(skill: string, context: CallerContext, input: Record<string, unknown>, options?: SkillInvocationOptions): Promise<DeepAgentsSkillResult>;
    resume(request: SkillResumeRequest): Promise<DeepAgentsSkillResult>;
    cancel(context: CallerContext, pauseId: string): DeepAgentsSkillResult;
    private createGraph;
    private permissionForEffect;
    private resumeSibling;
    private questionInterruptionFromError;
    private result;
}
export { LangChainDeepAgentsSkillRuntime as DeepAgentsSkillRuntime };
