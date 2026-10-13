import { z } from "zod";
import { type DispatchDecision } from "./orchestration-policy.js";
import { type DispatchOutcome, type DispatchRequest, type RuntimeSnapshot } from "./orchestration.schema.js";
import { type ReportHandoffResult } from "./report-handoff.js";
declare const DispatchQueuePropsSchema: z.ZodObject<{
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
    requests: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        agent: z.ZodString;
        context: z.ZodObject<{
            runId: z.ZodString;
            taskId: z.ZodString;
            cwd: z.ZodString;
            repositoryRoot: z.ZodString;
            baseRef: z.ZodString;
            skill: z.ZodString;
            attempt: z.ZodInt;
        }, z.core.$strict>;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        requiredCapabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    maxConcurrent: z.ZodInt;
}, z.core.$strict>;
export type DispatchAdmission = Extract<DispatchDecision, {
    status: "ready";
}> | {
    status: "unavailable";
    outcome: DispatchOutcome<never>;
} | {
    status: "waiting";
    dispatchIds: string[];
} | {
    status: "complete";
    outcomes: DispatchOutcome<unknown>[];
};
export interface DispatchQueue {
    pending(): DispatchRequest | undefined;
    admit(runtime: RuntimeSnapshot, observedDispatchIds: string[]): DispatchAdmission;
    settle<T>(dispatchId: string, outcome: unknown, schema: z.ZodType<T>): ReportHandoffResult<T>;
    cancel(): void;
    results(): DispatchOutcome<unknown>[] | undefined;
}
export declare class InvalidDispatchQueueStateError extends Error {
    name: string;
}
/** Reserves slots synchronously; native adapters execute requests and acknowledge released host capacity. */
export declare class BoundedDispatchQueue implements DispatchQueue {
    private readonly policy;
    private readonly reports;
    private readonly requests;
    private readonly maxConcurrent;
    private readonly active;
    private readonly outcomes;
    private cursor;
    private batchSealed;
    constructor(props: z.infer<typeof DispatchQueuePropsSchema>);
    pending(): DispatchRequest | undefined;
    admit(runtime: RuntimeSnapshot, observedDispatchIds: string[]): DispatchAdmission;
    settle<T>(dispatchId: string, outcome: unknown, schema: z.ZodType<T>): ReportHandoffResult<T>;
    cancel(): void;
    results(): DispatchOutcome<unknown>[] | undefined;
}
export {};
