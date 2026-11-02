import { z } from "zod";
import { BoundedDispatchQueue } from "../orchestration/dispatch-queue.js";
import { type DispatchOutcome, type DispatchRequest, type OrchestrationFailure, type RuntimeSnapshot } from "../orchestration/orchestration.schema.js";
import { type ReportMode, type ValidatedWorkerReport } from "./report-codec.js";
export declare const WorkerCapabilitySchema: z.ZodEnum<{
    edit: "edit";
    read: "read";
    shell: "shell";
    web: "web";
    spawn: "spawn";
    ask: "ask";
}>;
export type WorkerCapability = z.infer<typeof WorkerCapabilitySchema>;
declare const CapabilityToolDeniedPropsSchema: z.ZodObject<{
    toolName: z.ZodString;
    capability: z.ZodOptional<z.ZodEnum<{
        edit: "edit";
        read: "read";
        shell: "shell";
        web: "web";
        spawn: "spawn";
        ask: "ask";
    }>>;
}, z.core.$strict>;
export declare class CapabilityToolDeniedError extends Error {
    name: string;
    readonly capability: WorkerCapability | undefined;
    constructor(props: z.input<typeof CapabilityToolDeniedPropsSchema>);
}
export declare class WorkerDispatchConfigurationError extends Error {
    name: string;
}
export interface DispatchOptions {
    signal?: AbortSignal;
}
export interface BatchDispatchOptions extends DispatchOptions {
    maxConcurrent: number;
}
export interface WorkerRuntimeContract {
    dispatch(request: DispatchRequest, options?: DispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>>;
    dispatchMany(requests: DispatchRequest[], options: BatchDispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
}
export type AdmittedDispatch = Extract<ReturnType<BoundedDispatchQueue["admit"]>, {
    status: "ready";
}>;
export type WorkerRunCallback = (admission: AdmittedDispatch, snapshot: RuntimeSnapshot, signal: AbortSignal) => Promise<DispatchOutcome<ValidatedWorkerReport>>;
export type PreparedWorkerRun = {
    status: "ready";
    mode: ReportMode;
    prompt: string;
    task: string;
} | {
    status: "rejected";
    outcome: DispatchOutcome<ValidatedWorkerReport>;
};
/** Report-mode parsing, prompt assembly and failure mapping shared by every worker runtime binding. */
export interface WorkerRunProtocol {
    prepare(admission: AdmittedDispatch): PreparedWorkerRun;
    cancelled(request: DispatchRequest): DispatchOutcome<ValidatedWorkerReport>;
    failed(request: DispatchRequest, failure: OrchestrationFailure): DispatchOutcome<ValidatedWorkerReport>;
    finish(request: DispatchRequest, finalText: string, mode: ReportMode): DispatchOutcome<ValidatedWorkerReport>;
    executionFailure(cause: unknown, signal: AbortSignal): OrchestrationFailure;
}
export declare class StandardWorkerRunProtocol implements WorkerRunProtocol {
    private readonly reports;
    prepare(admission: AdmittedDispatch): PreparedWorkerRun;
    cancelled(request: DispatchRequest): DispatchOutcome<ValidatedWorkerReport>;
    failed(request: DispatchRequest, failure: OrchestrationFailure): DispatchOutcome<ValidatedWorkerReport>;
    finish(request: DispatchRequest, finalText: string, mode: ReportMode): DispatchOutcome<ValidatedWorkerReport>;
    executionFailure(cause: unknown, signal: AbortSignal): OrchestrationFailure;
    private cancellationFailure;
}
export declare const workerRunProtocol: WorkerRunProtocol;
declare const QueuedWorkerDispatcherPropsSchema: z.ZodObject<{
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
    observe: z.ZodCustom<(request: DispatchRequest) => Promise<RuntimeSnapshot>, (request: DispatchRequest) => Promise<RuntimeSnapshot>>;
    run: z.ZodCustom<WorkerRunCallback, WorkerRunCallback>;
    createError: z.ZodCustom<(message: string) => Error, (message: string) => Error>;
}, z.core.$strict>;
export type QueuedWorkerDispatcherProps = z.input<typeof QueuedWorkerDispatcherPropsSchema>;
/** Admits, observes, queues and settles worker dispatches under current host evidence; the binding supplies only how one admitted worker runs. */
export declare class QueuedWorkerDispatcher implements WorkerRuntimeContract {
    private readonly agents;
    private readonly observe;
    private readonly run;
    private readonly createError;
    private readonly activeExecutions;
    constructor(props: QueuedWorkerDispatcherProps);
    dispatch(request: DispatchRequest, options?: DispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>>;
    dispatchMany(requests: DispatchRequest[], options: BatchDispatchOptions): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
}
export {};
