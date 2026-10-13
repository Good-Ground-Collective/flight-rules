import type { AgentDefinition } from "../agent-registry/agent-registry.js";
export interface AgentEmitter {
    emit(agent: AgentDefinition): string;
}
export declare class UnsupportedAgentSettingError extends Error {
    name: string;
}
