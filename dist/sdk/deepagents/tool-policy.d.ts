import { createSubAgentMiddleware } from "deepagents";
import { type AnyAgentMiddleware, type StructuredTool } from "langchain";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type { RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import { CapabilityToolDeniedError, WorkerCapabilitySchema, type WorkerCapability } from "../worker-runtime-core.js";
export { CapabilityToolDeniedError, WorkerCapabilitySchema };
export type { WorkerCapability };
export type WorkerToolGrants = Partial<Record<WorkerCapability, readonly StructuredTool[]>>;
export declare const flightRulesAbortSignalConfigKey = "flightRulesAbortSignal";
export declare class InvalidDeepAgentsToolRegistrationError extends Error {
    name: string;
}
export interface DeepAgentsToolPolicyContract {
    toolsFor(definition: AgentDefinition, grants: WorkerToolGrants, runtime: RuntimeSnapshot): StructuredTool[];
    middlewareFor(model: Parameters<typeof createSubAgentMiddleware>[0]["defaultModel"], definition: AgentDefinition, hostTools: readonly StructuredTool[], trackExecution: <T>(execution: () => Promise<T>) => Promise<T>, onCapabilityDenied: (error: CapabilityToolDeniedError) => void, additionalToolNames?: readonly string[]): readonly AnyAgentMiddleware[];
}
/** Builds an instance-local tool stack from observed grants and host-enforced tools. */
export declare class CapabilityScopedDeepAgentsToolPolicy implements DeepAgentsToolPolicyContract {
    toolsFor(definition: AgentDefinition, grants: WorkerToolGrants, runtime: RuntimeSnapshot): StructuredTool[];
    middlewareFor(model: Parameters<typeof createSubAgentMiddleware>[0]["defaultModel"], definition: AgentDefinition, hostTools: readonly StructuredTool[], trackExecution: <T>(execution: () => Promise<T>) => Promise<T>, onCapabilityDenied: (error: CapabilityToolDeniedError) => void, additionalToolNames?: readonly string[]): readonly AnyAgentMiddleware[];
}
