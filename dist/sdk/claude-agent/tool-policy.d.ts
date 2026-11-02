import { type HookInput, type HookJSONOutput, type McpSdkServerConfigWithInstance, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type { RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import { CapabilityToolDeniedError, WorkerCapabilitySchema, WorkerDispatchConfigurationError, type WorkerCapability } from "../worker-runtime-core.js";
export { CapabilityToolDeniedError, WorkerCapabilitySchema };
export type { WorkerCapability };
export declare const flightRulesHostServerName = "flight-rules-host";
export type HostToolResult = string | object;
export interface HostToolContext {
    signal: AbortSignal;
}
export type HostToolHandler = (args: Record<string, unknown>, context: HostToolContext) => Promise<HostToolResult>;
declare const HostToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodRecord<z.ZodString, z.ZodCustom<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    annotations: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        readOnlyHint: z.ZodOptional<z.ZodBoolean>;
        destructiveHint: z.ZodOptional<z.ZodBoolean>;
        idempotentHint: z.ZodOptional<z.ZodBoolean>;
        openWorldHint: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
    handler: z.ZodCustom<HostToolHandler, HostToolHandler>;
}, z.core.$strip>;
/** A host-enforced capability a worker may call, described once and served to the Claude Agent SDK in process. */
export type WorkerHostTool = z.output<typeof HostToolSchema>;
export type WorkerToolGrants = Partial<Record<WorkerCapability, readonly WorkerHostTool[]>>;
export declare const WorkerToolGrantsSchema: z.ZodRecord<z.ZodEnum<{
    edit: "edit";
    read: "read";
    shell: "shell";
    web: "web";
    spawn: "spawn";
    ask: "ask";
}> & z.core.$partial, z.ZodArray<z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodRecord<z.ZodString, z.ZodCustom<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    annotations: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        readOnlyHint: z.ZodOptional<z.ZodBoolean>;
        destructiveHint: z.ZodOptional<z.ZodBoolean>;
        idempotentHint: z.ZodOptional<z.ZodBoolean>;
        openWorldHint: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
    handler: z.ZodCustom<HostToolHandler, HostToolHandler>;
}, z.core.$strip>>>;
export declare class InvalidClaudeHostToolError extends WorkerDispatchConfigurationError {
    name: string;
}
/** A built-in file tool reached for a path outside the repository the worker was dispatched into. */
export declare class RepositoryPathDeniedError extends CapabilityToolDeniedError {
    name: string;
    constructor(props: {
        toolName: string;
        capability: WorkerCapability | undefined;
        path: string;
        repositoryRoot: string;
    });
}
/** Tracks every host tool promise of one run so its capacity reservation outlives the model loop. */
export declare class HostToolExecutionTracker {
    private readonly pending;
    private firstFailure;
    track<T>(execution: () => Promise<T>): Promise<T>;
    recordFailure(cause: unknown): void;
    failure(): {
        cause: unknown;
    } | undefined;
    waitForIdle(): Promise<void>;
}
declare const ClaudeToolGuardPropsSchema: z.ZodObject<{
    allowedTools: z.ZodArray<z.ZodString>;
    capabilities: z.ZodCustom<ReadonlyMap<string, "edit" | "read" | "shell" | "web" | "spawn" | "ask">, ReadonlyMap<string, "edit" | "read" | "shell" | "web" | "spawn" | "ask">>;
    cwd: z.ZodString;
    repositoryRoot: z.ZodString;
    onDenied: z.ZodCustom<(error: CapabilityToolDeniedError) => void, (error: CapabilityToolDeniedError) => void>;
}, z.core.$strict>;
export type ClaudeToolGuardProps = z.input<typeof ClaudeToolGuardPropsSchema>;
export interface ClaudeToolGuardContract {
    preToolUse(input: HookInput): Promise<HookJSONOutput>;
    canUseTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult>;
}
/** Denies any tool outside one run's allowlist and any built-in file access outside its repository, and reports the denial so the run stops. */
export declare class RepositoryConfinedToolGuard implements ClaudeToolGuardContract {
    private readonly allowedTools;
    private readonly capabilities;
    private readonly cwd;
    private readonly repositoryRoot;
    private readonly realRepositoryRoot;
    private readonly onDenied;
    constructor(props: ClaudeToolGuardProps);
    preToolUse(input: HookInput): Promise<HookJSONOutput>;
    canUseTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult>;
    private evaluate;
    private inputRecord;
    private escapingPath;
    private globEscapes;
    private isOutside;
    private realPath;
}
export interface HostToolServerRun {
    signal: AbortSignal;
    tracker: HostToolExecutionTracker;
}
export interface ClaudeToolPolicyContract {
    validateGrants(grants: WorkerToolGrants): void;
    builtInToolsFor(definition: AgentDefinition, runtime: RuntimeSnapshot): string[];
    hostToolsFor(definition: AgentDefinition, grants: WorkerToolGrants, runtime: RuntimeSnapshot): WorkerHostTool[];
    allowlistFor(builtInTools: readonly string[], hostTools: readonly WorkerHostTool[]): string[];
    disallowedTools(): string[];
    guardFor(props: Omit<ClaudeToolGuardProps, "capabilities">): ClaudeToolGuardContract;
    serverFor(hostTools: readonly WorkerHostTool[], run: HostToolServerRun): McpSdkServerConfigWithInstance;
}
/** Derives one run's built-in tools, host tools and guard from registered capabilities and fresh host observation. */
export declare class CapabilityScopedClaudeToolPolicy implements ClaudeToolPolicyContract {
    private readonly capabilities;
    constructor();
    validateGrants(grants: WorkerToolGrants): void;
    builtInToolsFor(definition: AgentDefinition, runtime: RuntimeSnapshot): string[];
    hostToolsFor(definition: AgentDefinition, grants: WorkerToolGrants, runtime: RuntimeSnapshot): WorkerHostTool[];
    allowlistFor(builtInTools: readonly string[], hostTools: readonly WorkerHostTool[]): string[];
    disallowedTools(): string[];
    guardFor(props: Omit<ClaudeToolGuardProps, "capabilities">): ClaudeToolGuardContract;
    serverFor(hostTools: readonly WorkerHostTool[], run: HostToolServerRun): McpSdkServerConfigWithInstance;
    private assertValid;
    private effectiveCapabilities;
    private invoke;
}
