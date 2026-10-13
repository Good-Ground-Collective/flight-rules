import { z } from "zod";
import type { AgentDefinition } from "../agents/agent-registry/agent-registry.js";
import { type DispatchRequest, type OrchestrationFailure, type QuestionRequest, type RuntimeSnapshot, type SiblingSkillRequest } from "./orchestration.schema.js";
declare const RegistryOrchestrationPolicyPropsSchema: z.ZodObject<{
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
}, z.core.$strict>;
export type DispatchDecision = {
    status: "ready";
    request: DispatchRequest;
    definition: AgentDefinition;
} | {
    status: "unavailable";
    failure: OrchestrationFailure;
};
export type QuestionDecision = {
    status: "awaiting-answer";
    request: QuestionRequest;
} | {
    status: "unavailable";
    failure: OrchestrationFailure;
};
export interface OrchestrationPolicy {
    prepare(request: DispatchRequest, runtime: RuntimeSnapshot): DispatchDecision;
    ask(request: QuestionRequest, runtime: RuntimeSnapshot): QuestionDecision;
    sibling(request: SiblingSkillRequest): SiblingSkillRequest;
}
/** Plans native dispatch from registry names and scoped evidence without executing tools or granting permissions. */
export declare class RegistryOrchestrationPolicy implements OrchestrationPolicy {
    private readonly agents;
    constructor(props: z.infer<typeof RegistryOrchestrationPolicyPropsSchema>);
    prepare(request: DispatchRequest, runtime: RuntimeSnapshot): DispatchDecision;
    ask(request: QuestionRequest, runtime: RuntimeSnapshot): QuestionDecision;
    sibling(request: SiblingSkillRequest): SiblingSkillRequest;
}
export {};
