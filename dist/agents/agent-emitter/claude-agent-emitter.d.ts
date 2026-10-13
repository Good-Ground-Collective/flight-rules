import { z } from "zod";
import type { AgentDefinition } from "../agent-registry/agent-registry.js";
import { type AgentEmitter } from "./agent-emitter.js";
declare const ClaudeAgentEmitterPropsSchema: z.ZodObject<{
    models: z.ZodObject<{
        standard: z.ZodString;
        escalated: z.ZodString;
        expert: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
type ClaudeAgentEmitterProps = z.infer<typeof ClaudeAgentEmitterPropsSchema>;
/** Host bindings are separate from canonical prompts and do not silently weaken execution restrictions. */
export declare class MarkdownClaudeAgentEmitter implements AgentEmitter {
    private readonly models;
    constructor(props: ClaudeAgentEmitterProps);
    emit(agent: AgentDefinition): string;
    private tools;
}
export {};
