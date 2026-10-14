import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { type StructuredTool } from "langchain";
import { z } from "zod";
import { type DispatchOutcome, type DispatchRequest, type RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import { type ValidatedWorkerReport } from "../report-codec.js";
export interface ModelExecutionTracker {
    waitForIdle(): Promise<void>;
}
declare const DeepAgentsRuntimePropsSchema: z.ZodObject<{
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
    toolGrants: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodCustom<StructuredTool<import("@langchain/core/tools").ToolSchemaBase, any, any, any, unknown>, StructuredTool<import("@langchain/core/tools").ToolSchemaBase, any, any, any, unknown>>>>;
    observe: z.ZodCustom<(request: DispatchRequest) => Promise<RuntimeSnapshot>, (request: DispatchRequest) => Promise<RuntimeSnapshot>>;
    maxGraphSteps: z.ZodDefault<z.ZodInt>;
}, z.core.$strict>;
export type DeepAgentsRuntimeProps = z.input<typeof DeepAgentsRuntimePropsSchema>;
export interface DispatchOptions {
    signal?: AbortSignal;
}
export interface BatchDispatchOptions extends DispatchOptions {
    maxConcurrent: number;
}
export declare class DeepAgentsConfigurationError extends Error {
    name: string;
}
export interface DeepAgentsWorkerRuntimeContract {
    dispatch(request: DispatchRequest, options?: DispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>>;
    dispatchMany(requests: DispatchRequest[], options: BatchDispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
}
/** Runs canonical worker registrations as isolated Deep Agents graphs under current host evidence. */
export declare class LangChainDeepAgentsWorkerRuntime implements DeepAgentsWorkerRuntimeContract {
    private readonly agents;
    private readonly models;
    private readonly toolGrants;
    private readonly observe;
    private readonly maxGraphSteps;
    private readonly toolPolicy;
    private readonly reports;
    private readonly activeExecutions;
    constructor(props: DeepAgentsRuntimeProps);
    dispatch(request: DispatchRequest, options?: DispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>>;
    dispatchMany(requests: DispatchRequest[], options: BatchDispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
    private runGraph;
    private executionFailure;
}
export {};
