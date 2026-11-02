import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";

export interface ScriptedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface QueryScript {
  response?: string;
  resultSubtype?: "error_max_turns" | "error_during_execution";
  isError?: boolean;
  calls?: ScriptedToolCall[];
  delay?: (prompt: string) => number;
  wait?: (prompt: string) => Promise<void>;
  failure?: Error;
  throwAfterResult?: Error;
}

export interface ScriptedCall {
  prompt: string;
  options: Options;
}

interface ConnectableServer {
  connect(transport: unknown): Promise<void>;
}

/** Stands in for the Claude Agent SDK query function: it applies the run's own hook and permission callbacks, serves in-process MCP tools and honors the abort controller, without a provider or native binary. */
export class ScriptedClaudeQuery {
  readonly invocations: ScriptedCall[] = [];
  readonly executedBuiltIns: string[] = [];
  readonly deniedTools: string[] = [];
  completed = 0;
  private readonly script: QueryScript;

  constructor(script: QueryScript) {
    this.script = script;
  }

  readonly query = (params: { prompt: unknown; options?: Options }): Query => {
    const generator = this.stream(String(params.prompt), params.options ?? {});
    return Object.assign(generator, { close: () => undefined }) as unknown as Query;
  };

  private async *stream(prompt: string, options: Options): AsyncGenerator<unknown, void> {
    this.invocations.push({ prompt, options });
    const signal = options.abortController?.signal;
    if (this.script.failure !== undefined) throw this.script.failure;

    for (const call of this.script.calls ?? []) {
      if (signal?.aborted) throw new Error("aborted");
      if (!(await this.permits(options, call, signal))) {
        this.deniedTools.push(call.name);
        if (signal?.aborted) throw new Error("aborted");
        continue;
      }
      await this.execute(options, call);
    }

    const delay = this.script.delay?.(prompt) ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    await this.script.wait?.(prompt);
    this.completed++;
    if (signal?.aborted) throw new Error("aborted");

    yield this.resultMessage();
    if (this.script.throwAfterResult !== undefined) throw this.script.throwAfterResult;
  }

  private resultMessage(): unknown {
    if (this.script.resultSubtype !== undefined) {
      return {
        type: "result",
        subtype: this.script.resultSubtype,
        is_error: true,
        errors: ["scripted failure"],
      };
    }
    return {
      type: "result",
      subtype: "success",
      is_error: this.script.isError ?? false,
      result: this.script.response ?? "",
    };
  }

  private async permits(
    options: Options,
    call: ScriptedToolCall,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const live = signal ?? new AbortController().signal;
    for (const matcher of options.hooks?.PreToolUse ?? []) {
      for (const hook of matcher.hooks) {
        const output = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: call.name,
            tool_input: call.input,
            tool_use_id: "scripted-call",
            session_id: "scripted-session",
            transcript_path: "/dev/null",
            cwd: options.cwd ?? "/",
          },
          "scripted-call",
          { signal: live },
        );
        if ("hookSpecificOutput" in output && output.hookSpecificOutput !== undefined) {
          const decision = output.hookSpecificOutput;
          if ("permissionDecision" in decision && decision.permissionDecision === "deny")
            return false;
        }
      }
    }
    const decision = await options.canUseTool?.(call.name, call.input, {
      signal: live,
      toolUseID: "scripted-call",
      requestId: "scripted-request",
    });
    return decision === undefined || decision === null || decision.behavior === "allow";
  }

  private async execute(options: Options, call: ScriptedToolCall): Promise<void> {
    const match = /^mcp__(.+?)__(.+)$/.exec(call.name);
    if (match === null) {
      this.executedBuiltIns.push(call.name);
      return;
    }
    const [, serverName, toolName] = match;
    const server = serverName === undefined ? undefined : options.mcpServers?.[serverName];
    if (server === undefined || !("instance" in server)) {
      throw new Error(`No in-process MCP server for ${call.name}`);
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "scripted-model", version: "1" });
    const instance: ConnectableServer = server.instance;
    await Promise.all([instance.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await client.callTool({ name: toolName ?? "", arguments: call.input });
    } finally {
      await client.close();
    }
  }
}
