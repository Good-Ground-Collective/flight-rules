import type {
  HookInput,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  Options,
} from "@anthropic-ai/claude-agent-sdk";
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
export class GuardedQueryOptions {
  build(props: GuardedQueryProps): Options {
    const preToolUse = props.preToolUse ?? ((input: HookInput) => props.guard.preToolUse(input));
    return {
      cwd: props.cwd,
      model: props.model,
      ...(props.systemPrompt === undefined ? {} : { systemPrompt: props.systemPrompt }),
      tools: [...props.builtInTools],
      disallowedTools: [...props.disallowedTools],
      ...(Object.keys(props.mcpServers).length === 0
        ? {}
        : { mcpServers: { ...props.mcpServers } }),
      strictMcpConfig: true,
      settingSources: [],
      plugins: [],
      permissionMode: "default",
      hooks: { PreToolUse: [{ hooks: [(input) => preToolUse(input)] }] },
      canUseTool: (toolName, input) => props.guard.canUseTool(toolName, input),
      maxTurns: props.maxTurns,
      abortController: props.controller,
      persistSession: props.persistSession,
      ...(props.resume === undefined ? {} : { resume: props.resume }),
    };
  }
}

export const guardedQueryOptions = new GuardedQueryOptions();
