import { z } from "zod";
export declare const seedCompetencies: readonly ["define-a-schema", "wire-an-endpoint", "write-a-migration", "pure-transform", "write-a-query", "mapper-adapter", "harden-edge-cases", "business-rule", "external-api-client", "reducer-state", "async-coordination", "auth-check"];
export declare const ConfigSchema: z.ZodObject<{
    tracker: z.ZodEnum<{
        github: "github";
        jira: "jira";
    }>;
    repo: z.ZodOptional<z.ZodString>;
    jiraHost: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
    jiraEmail: z.ZodOptional<z.ZodString>;
    jiraProject: z.ZodOptional<z.ZodString>;
    jpdProject: z.ZodOptional<z.ZodString>;
    confluenceSpaceKey: z.ZodOptional<z.ZodString>;
    inProgressStatus: z.ZodOptional<z.ZodString>;
    inReviewStatus: z.ZodOptional<z.ZodString>;
    defaultLabels: z.ZodDefault<z.ZodArray<z.ZodString>>;
    rfcStorage: z.ZodDefault<z.ZodEnum<{
        local: "local";
        global: "global";
    }>>;
    rfcStoragePath: z.ZodOptional<z.ZodString>;
    qaRecipe: z.ZodOptional<z.ZodString>;
    competencies: z.ZodDefault<z.ZodArray<z.ZodString>>;
    "ariadne.url": z.ZodOptional<z.ZodURL>;
    "ariadne.enabled": z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type Config = z.infer<typeof ConfigSchema>;
export declare function parseFrontmatter(contents: string): Record<string, unknown>;
export declare function readConfig(configPath: string): Config;
export declare function getRfcDir(config: Config, cwd: string): string;
export interface PathProbe {
    isFile(path: string): boolean;
    isDirectory(path: string): boolean;
}
export declare class NodePathProbe implements PathProbe {
    isFile(path: string): boolean;
    isDirectory(path: string): boolean;
}
/**
 * Resolves the config location without reading its contents. Precedence is:
 * FLIGHT_RULES_CONFIG (relative to cwd), an existing .claude config, an existing
 * .agents config, a create-path in an existing .claude directory, a create-path
 * in an existing .agents directory, then .claude/flight-rules.local.md.
 */
export declare function resolveConfigPath(// eslint-disable-line preflight/no-loose-functions -- resolveConfigPath is module-level behaviour awaiting a home on a service; tracked in KAN-39
cwd: string, override: string | undefined, probe?: PathProbe): string;
export declare function getQaRecipePath(config: Config, configPath: string): string;
