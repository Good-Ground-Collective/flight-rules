import { z } from "zod";
import type { AgentDefinition } from "../agent-registry/agent-registry.js";
import { type AgentEmitter } from "./agent-emitter.js";
declare const CodexAgentEmitterPropsSchema: z.ZodObject<{
    models: z.ZodObject<{
        standard: z.ZodString;
        escalated: z.ZodString;
        expert: z.ZodString;
    }, z.core.$strict>;
    reasoning: z.ZodObject<{
        standard: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
        }>;
        escalated: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
        }>;
        expert: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>;
type CodexAgentEmitterProps = z.infer<typeof CodexAgentEmitterPropsSchema>;
/** Serializes native configuration without turning a capability declaration into a permission grant. */
export declare class TomlCodexAgentEmitter implements AgentEmitter {
    private readonly props;
    constructor(props: CodexAgentEmitterProps);
    emit(agent: AgentDefinition): string;
    diagnostics(agent: AgentDefinition): string[];
}
export {};
