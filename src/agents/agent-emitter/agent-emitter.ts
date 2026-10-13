import type { AgentDefinition } from "../agent-registry/agent-registry.js";

export interface AgentEmitter {
  emit(agent: AgentDefinition): string;
}

export class UnsupportedAgentSettingError extends Error {
  override name = "UnsupportedAgentSettingError";
}
