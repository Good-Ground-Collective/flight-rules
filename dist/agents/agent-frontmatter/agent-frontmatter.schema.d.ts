import { z } from "zod";
export declare const agentCapabilities: readonly ["read", "edit", "shell", "web", "spawn", "ask"];
export declare const modelTiers: readonly ["standard", "escalated", "expert"];
export declare const reasoningLevels: readonly ["low", "medium", "high"];
export declare const claudeAgentColors: readonly ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
export declare const AgentCapabilitySchema: z.ZodEnum<{
    edit: "edit";
    read: "read";
    shell: "shell";
    web: "web";
    spawn: "spawn";
    ask: "ask";
}>;
export declare const ModelTierSchema: z.ZodEnum<{
    standard: "standard";
    escalated: "escalated";
    expert: "expert";
}>;
/** Host-neutral capabilities and execution preferences shared by agent adapters. */
export declare const AgentFrontmatterSchema: z.ZodObject<{
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
            enabled: "enabled";
            none: "none";
        }>;
    }, z.core.$strict>>;
    dispatch: z.ZodOptional<z.ZodObject<{
        maxConcurrent: z.ZodInt;
        maxDepth: z.ZodInt;
    }, z.core.$strict>>;
    "x-claude": z.ZodOptional<z.ZodObject<{
        color: z.ZodOptional<z.ZodEnum<{
            blue: "blue";
            green: "green";
            yellow: "yellow";
            orange: "orange";
            red: "red";
            pink: "pink";
            purple: "purple";
            cyan: "cyan";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
