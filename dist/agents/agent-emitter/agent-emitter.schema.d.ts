import { z } from "zod";
export declare const ModelBindingsSchema: z.ZodObject<{
    standard: z.ZodString;
    escalated: z.ZodString;
    expert: z.ZodString;
}, z.core.$strict>;
export declare const AgentDefinitionSchema: z.ZodObject<{
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
}, z.core.$strict>;
