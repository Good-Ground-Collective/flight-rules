import { createSubAgentMiddleware } from "deepagents";
import { type AnyAgentMiddleware, type StructuredTool } from "langchain";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type { RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import { z } from "zod";
export declare const WorkerCapabilitySchema: z.ZodEnum<{
    edit: "edit";
    read: "read";
    shell: "shell";
    web: "web";
    spawn: "spawn";
    ask: "ask";
}>;
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
export type WorkerCapability = z.infer<typeof WorkerCapabilitySchema>;
export type WorkerToolGrants = Partial<Record<WorkerCapability, readonly StructuredTool[]>>;
export declare const flightRulesAbortSignalConfigKey = "flightRulesAbortSignal";
export declare class CapabilityToolDeniedError extends Error {
    name: string;
    readonly capability: WorkerCapability | undefined;
    constructor(props: z.input<typeof CapabilityToolDeniedPropsSchema>);
}
export declare class InvalidDeepAgentsToolRegistrationError extends Error {
    name: string;
}
export interface DeepAgentsToolPolicyContract {
    toolsFor(definition: AgentDefinition, grants: WorkerToolGrants, runtime: RuntimeSnapshot): StructuredTool[];
    middlewareFor(model: Parameters<typeof createSubAgentMiddleware>[0]["defaultModel"], definition: AgentDefinition, hostTools: readonly StructuredTool[], trackExecution: <T>(execution: () => Promise<T>) => Promise<T>, onCapabilityDenied: (error: CapabilityToolDeniedError) => void): readonly AnyAgentMiddleware[];
}
/** Builds an instance-local tool stack from observed grants and host-enforced tools. */
export declare class CapabilityScopedDeepAgentsToolPolicy implements DeepAgentsToolPolicyContract {
    toolsFor(definition: AgentDefinition, grants: WorkerToolGrants, runtime: RuntimeSnapshot): StructuredTool[];
    middlewareFor(model: Parameters<typeof createSubAgentMiddleware>[0]["defaultModel"], definition: AgentDefinition, hostTools: readonly StructuredTool[], trackExecution: <T>(execution: () => Promise<T>) => Promise<T>, onCapabilityDenied: (error: CapabilityToolDeniedError) => void): readonly AnyAgentMiddleware[];
}
export {};
