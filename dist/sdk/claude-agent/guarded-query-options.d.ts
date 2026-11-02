import type { HookInput, HookJSONOutput, McpSdkServerConfigWithInstance, Options } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeToolGuardContract } from "./tool-policy.js";
export interface GuardedQueryProps {
    cwd: string;
    model: string;
    systemPrompt?: string;
    builtInTools: readonly string[];
    disallowedTools: readonly string[];
    mcpServers: Readonly<Record<string, McpSdkServerConfigWithInstance>>;
    guard: ClaudeToolGuardContract;
    preToolUse?: (input: HookInput) => Promise<HookJSONOutput>;
    maxTurns: number;
    controller: AbortController;
    persistSession: boolean;
    resume?: string;
}
/** Builds the options every Claude binding runs under: no user, project or plugin configuration can widen access, and the run's guard decides every tool call. */
export declare class GuardedQueryOptions {
    build(props: GuardedQueryProps): Options;
}
export declare const guardedQueryOptions: GuardedQueryOptions;
