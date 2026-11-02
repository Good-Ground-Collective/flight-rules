import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DispatchOutcome, DispatchRequest, RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import type { ValidatedWorkerReport } from "../report-codec.js";
import { WorkerDispatchConfigurationError, type BatchDispatchOptions, type DispatchOptions, type WorkerRuntimeContract } from "../worker-runtime-core.js";
export type ClaudeAgentQuery = typeof claudeAgentQuery;
export type { BatchDispatchOptions, DispatchOptions };
declare const ClaudeAgentRuntimePropsSchema: z.ZodObject<{
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
    toolGrants: z.ZodRecord<z.ZodEnum<{
        edit: "edit";
        read: "read";
        shell: "shell";
        web: "web";
        spawn: "spawn";
        ask: "ask";
    }> & z.core.$partial, z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodRecord<z.ZodString, z.ZodCustom<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        annotations: z.ZodOptional<z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
            readOnlyHint: z.ZodOptional<z.ZodBoolean>;
            destructiveHint: z.ZodOptional<z.ZodBoolean>;
            idempotentHint: z.ZodOptional<z.ZodBoolean>;
            openWorldHint: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>;
        handler: z.ZodCustom<import("./tool-policy.js").HostToolHandler, import("./tool-policy.js").HostToolHandler>;
    }, z.core.$strip>>>;
    observe: z.ZodCustom<(request: DispatchRequest) => Promise<RuntimeSnapshot>, (request: DispatchRequest) => Promise<RuntimeSnapshot>>;
    maxTurns: z.ZodDefault<z.ZodInt>;
    query: z.ZodOptional<z.ZodCustom<typeof claudeAgentQuery, typeof claudeAgentQuery>>;
}, z.core.$strict>;
export type ClaudeAgentRuntimeProps = z.input<typeof ClaudeAgentRuntimePropsSchema>;
export declare class ClaudeAgentConfigurationError extends WorkerDispatchConfigurationError {
    name: string;
}
export declare class ClaudeAgentExecutionError extends Error {
    name: string;
}
export type ClaudeAgentWorkerRuntimeContract = WorkerRuntimeContract;
/** Runs canonical worker registrations as isolated Claude Agent SDK queries under current host evidence. */
export declare class ClaudeAgentWorkerRuntime implements ClaudeAgentWorkerRuntimeContract {
    private readonly models;
    private readonly toolGrants;
    private readonly maxTurns;
    private readonly query;
    private readonly toolPolicy;
    private readonly dispatcher;
    constructor(props: ClaudeAgentRuntimeProps);
    dispatch(request: DispatchRequest, options?: DispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>>;
    dispatchMany(requests: DispatchRequest[], options: BatchDispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
    private defaultModels;
    private bindModels;
    private runQuery;
    private describeFailure;
}
