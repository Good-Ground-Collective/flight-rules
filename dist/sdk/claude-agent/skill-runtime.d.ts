import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { OperationRegistry } from "../../operations/operation-registry.js";
import { type CallerContext } from "../../orchestration/orchestration.schema.js";
import type { InstructionCatalog } from "../instruction-catalog.js";
import { CodedSkillError, SkillConfigurationError, type PausedSkillResult, type SkillInvocationOptions, type SkillResult, type SkillResumeRequest, type SkillRuntimeObserver, type SkillWorkerDispatcher } from "../skill-runtime-core.js";
import { type WorkerToolGrants } from "./tool-policy.js";
export declare const flightRulesServerName = "flight-rules";
declare const ClaudeAgentSkillRuntimePropsSchema: z.ZodObject<{
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
    models: z.ZodOptional<z.ZodObject<{
        standard: z.ZodOptional<z.ZodString>;
        escalated: z.ZodOptional<z.ZodString>;
        expert: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    operations: z.ZodCustom<OperationRegistry, OperationRegistry>;
    workers: z.ZodCustom<SkillWorkerDispatcher, SkillWorkerDispatcher>;
    observe: z.ZodCustom<SkillRuntimeObserver, SkillRuntimeObserver>;
    toolGrants: z.ZodCustom<(context: CallerContext) => WorkerToolGrants, (context: CallerContext) => WorkerToolGrants>;
    maxTurns: z.ZodDefault<z.ZodInt>;
    query: z.ZodOptional<z.ZodCustom<typeof claudeAgentQuery, typeof claudeAgentQuery>>;
}, z.core.$strict>;
export type ClaudeAgentSkillRuntimeProps = z.input<typeof ClaudeAgentSkillRuntimePropsSchema>;
export type ClaudeAgentSkillRuntimeObserver = SkillRuntimeObserver;
export type ClaudeAgentSkillResult<T = unknown> = SkillResult<T>;
export type { PausedSkillResult, SkillInvocationOptions, SkillResumeRequest };
export interface ClaudeAgentSkillRuntimeContract {
    invoke(skill: string, context: CallerContext, input: Record<string, unknown>, options?: SkillInvocationOptions): Promise<ClaudeAgentSkillResult>;
    resume(request: SkillResumeRequest): Promise<ClaudeAgentSkillResult>;
    cancel(context: CallerContext, pauseId: string): ClaudeAgentSkillResult;
}
export declare class ClaudeAgentSkillConfigurationError extends SkillConfigurationError {
    name: string;
}
/** A sibling skill asked a human question; the parent cannot carry that pause, so it fails instead of guessing. */
export declare class NestedSkillPauseError extends CodedSkillError {
    name: string;
    constructor(props: {
        siblingSkill: string;
    });
}
/** The model called the question tool and the host did not pause it, so no human answer exists to return. */
export declare class UnansweredQuestionError extends CodedSkillError {
    name: string;
    constructor();
}
/** Executes canonical workflow instructions as one Claude Agent SDK conversation, pausing at human questions through the SDK's deferred tool calls. */
export declare class ClaudeAgentSkillRuntime implements ClaudeAgentSkillRuntimeContract {
    private readonly instructions;
    private readonly agents;
    private readonly model;
    private readonly operations;
    private readonly workers;
    private readonly observe;
    private readonly toolGrants;
    private readonly maxTurns;
    private readonly query;
    private readonly pauses;
    private readonly questionAccess;
    private readonly toolPolicy;
    private readonly orchestration;
    constructor(props: ClaudeAgentSkillRuntimeProps);
    invoke(skill: string, context: CallerContext, input: Record<string, unknown>, options?: SkillInvocationOptions): Promise<ClaudeAgentSkillResult>;
    resume(request: SkillResumeRequest): Promise<ClaudeAgentSkillResult>;
    cancel(context: CallerContext, pauseId: string): ClaudeAgentSkillResult;
    private standardModel;
    /** The SDK needs a prompt even when a deferred call resumes; an empty stream sends no new user message. */
    private noNewPrompt;
    private prepareRun;
    private execute;
    private pause;
    private settle;
    private describeFailure;
    private qualified;
    private sharedToolNames;
    private isDenial;
    private denyAfterFailure;
    private sharedServer;
    private runSibling;
}
