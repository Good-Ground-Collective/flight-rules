import { z } from "zod";
export declare const NativeHostSchema: z.ZodEnum<{
    claude: "claude";
    codex: "codex";
}>;
export type NativeHost = z.infer<typeof NativeHostSchema>;
export declare const AgentInstallScopeSchema: z.ZodEnum<{
    user: "user";
    project: "project";
}>;
export type AgentInstallScope = z.infer<typeof AgentInstallScopeSchema>;
export declare const InstallationManifestSchema: z.ZodObject<{
    host: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>;
    agents: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        sha256: z.ZodString;
        registration: z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strict>;
declare const PropsSchema: z.ZodObject<{
    root: z.ZodString;
    cwd: z.ZodString;
    home: z.ZodDefault<z.ZodString>;
    env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>>;
}, z.core.$strip>;
export interface AgentInstallationReport {
    host: "codex";
    scope: AgentInstallScope;
    directory: string;
    agents: {
        name: string;
        path: string;
        status: "present" | "missing" | "conflict";
    }[];
    ok: boolean;
    evidence: "files-only";
    remedy: string;
}
export interface NativeInstallation {
    host(): NativeHost | undefined;
    status(scope: AgentInstallScope): AgentInstallationReport;
    install(scope: AgentInstallScope): AgentInstallationReport;
}
export declare class NativeInstallationError extends Error {
    name: string;
}
/** Registers Codex's separately discovered native agents without replacing existing definitions or changing host permissions. */
export declare class FileNativeInstallation implements NativeInstallation {
    private readonly props;
    constructor(props: z.input<typeof PropsSchema>);
    host(): NativeHost | undefined;
    status(scope: AgentInstallScope): AgentInstallationReport;
    install(scope: AgentInstallScope): AgentInstallationReport;
    private codexRoot;
    private manifest;
    private hash;
    private assertRegularPath;
    static fromInstall(props: {
        moduleUrl: string;
        cwd: string;
        env: NodeJS.ProcessEnv;
    }): FileNativeInstallation;
}
export {};
