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
  turns?: ScriptedToolCall[][];
  nestedTurns?: ScriptedToolCall[][];
  bypassHooks?: boolean;
}

export interface ScriptedCall {
  prompt: string;
  options: Options;
}

export interface ScriptedDenial {
  name: string;
  reason: string;
}

export interface ScriptedToolOutput {
  id: string;
  name: string;
  text: string;
  isError: boolean;
}

interface ScriptedSession {
  turns: ScriptedToolCall[][];
  next: number;
  deferred?: ScriptedUse | undefined;
}

interface ScriptedUse extends ScriptedToolCall {
  id: string;
}

type ScriptedDecision =
  | { decision: "allow"; input: Record<string, unknown> }
  | { decision: "deny"; reason: string }
  | { decision: "defer" };

interface ConnectableServer {
  connect(transport: unknown): Promise<void>;
}

/** Stands in for the Claude Agent SDK query function: it applies the run's own hook and permission callbacks, serves in-process MCP tools and honors the abort controller, without a provider or native binary. */
export class ScriptedClaudeQuery {
  readonly invocations: ScriptedCall[] = [];
  readonly executedBuiltIns: string[] = [];
  readonly deniedTools: string[] = [];
  readonly denials: ScriptedDenial[] = [];
  readonly outputs: ScriptedToolOutput[] = [];
  readonly hookedToolUses: string[] = [];
  completed = 0;
  private readonly sessions = new Map<string, ScriptedSession>();
  private readonly clients = new Map<ConnectableServer, Promise<Client>>();
  private sessionCount = 0;
  private useCount = 0;
  private readonly script: QueryScript;

  constructor(script: QueryScript) {
    this.script = script;
  }

  readonly query = (params: { prompt: unknown; options?: Options }): Query => {
    const prompt = typeof params.prompt === "string" ? params.prompt : "";
    const generator = this.stream(prompt, params.options ?? {});
    return Object.assign(generator, { close: () => undefined }) as unknown as Query;
  };

  private async *stream(prompt: string, options: Options): AsyncGenerator<unknown, void> {
    this.invocations.push({ prompt, options });
    const signal = options.abortController?.signal;
    if (this.script.failure !== undefined) throw this.script.failure;
    if (this.script.turns !== undefined) {
      yield* this.conversation(prompt, options);
      return;
    }

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
    const outcome = await this.decide(options, call, "scripted-call", signal);
    return outcome.decision === "allow";
  }

  private async decide(
    options: Options,
    call: ScriptedToolCall,
    toolUseId: string,
    signal: AbortSignal | undefined,
  ): Promise<ScriptedDecision> {
    const live = signal ?? new AbortController().signal;
    let input = call.input;
    this.hookedToolUses.push(toolUseId);
    for (const matcher of options.hooks?.PreToolUse ?? []) {
      for (const hook of matcher.hooks) {
        const output = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: call.name,
            tool_input: input,
            tool_use_id: toolUseId,
            session_id: "scripted-session",
            transcript_path: "/dev/null",
            cwd: options.cwd ?? "/",
          },
          toolUseId,
          { signal: live },
        );
        if ("hookSpecificOutput" in output && output.hookSpecificOutput !== undefined) {
          const decision = output.hookSpecificOutput;
          if (!("permissionDecision" in decision)) continue;
          if (decision.permissionDecision === "deny") {
            return { decision: "deny", reason: decision.permissionDecisionReason ?? "" };
          }
          if (decision.permissionDecision === "defer") return { decision: "defer" };
          if ("updatedInput" in decision && decision.updatedInput !== undefined) {
            input = decision.updatedInput;
          }
        }
      }
    }
    const permission = await options.canUseTool?.(call.name, input, {
      signal: live,
      toolUseID: toolUseId,
      requestId: "scripted-request",
    });
    if (permission === undefined || permission === null || permission.behavior === "allow") {
      return { decision: "allow", input };
    }
    return { decision: "deny", reason: permission.message };
  }

  private async *conversation(prompt: string, options: Options): AsyncGenerator<unknown, void> {
    const signal = options.abortController?.signal;
    const resumed = options.resume === undefined ? undefined : this.sessions.get(options.resume);
    const sessionId =
      resumed === undefined ? `scripted-session-${++this.sessionCount}` : (options.resume ?? "");
    const nested = prompt.includes('"nested":true') && this.script.nestedTurns !== undefined;
    const session: ScriptedSession = resumed ?? {
      turns: (nested ? this.script.nestedTurns : this.script.turns) ?? [],
      next: 0,
    };
    this.sessions.set(sessionId, session);

    await this.script.wait?.(prompt);
    if (signal?.aborted) throw new Error("aborted");

    if (session.deferred !== undefined) {
      const call = session.deferred;
      session.deferred = undefined;
      const deferred = await this.runUse(options, call);
      if (deferred !== undefined) {
        session.deferred = deferred;
        yield this.deferredResult(sessionId, deferred);
        return;
      }
    }

    while (session.next < session.turns.length) {
      const calls = session.turns[session.next++] ?? [];
      const uses = calls.map((call) => ({ ...call, id: `scripted-use-${++this.useCount}` }));
      const turnId = `scripted-turn-${session.next}-${sessionId}`;
      for (const use of uses) {
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          session_id: sessionId,
          message: {
            id: turnId,
            content: [{ type: "tool_use", id: use.id, name: use.name, input: use.input }],
          },
        };
      }
      const pausing = (await Promise.all(uses.map((use) => this.runUse(options, use)))).find(
        (use) => use !== undefined,
      );
      if (signal?.aborted) throw new Error("aborted");
      if (pausing !== undefined) {
        session.deferred = pausing;
        yield this.deferredResult(sessionId, pausing);
        return;
      }
    }

    this.completed++;
    yield { ...(this.resultMessage() as object), session_id: sessionId };
  }

  private deferredResult(sessionId: string, use: ScriptedUse): unknown {
    return {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      session_id: sessionId,
      terminal_reason: "tool_deferred",
      deferred_tool_use: { id: use.id, name: use.name, input: use.input },
    };
  }

  private async runUse(options: Options, use: ScriptedUse): Promise<ScriptedUse | undefined> {
    const signal = options.abortController?.signal;
    let input = use.input;
    if (this.script.bypassHooks !== true) {
      const outcome = await this.decide(options, use, use.id, signal);
      if (outcome.decision === "defer") return use;
      if (outcome.decision === "deny") {
        this.deniedTools.push(use.name);
        this.denials.push({ name: use.name, reason: outcome.reason });
        return undefined;
      }
      input = outcome.input;
    }
    const aborted = new Promise<never>((_resolve, reject) => {
      const stop = () => reject(new Error("aborted"));
      if (signal?.aborted) stop();
      signal?.addEventListener("abort", stop, { once: true });
    });
    const execution = this.execute(options, { name: use.name, input }, use.id);
    execution.catch(() => undefined);
    await Promise.race([execution, aborted]);
    return undefined;
  }

  private async execute(
    options: Options,
    call: ScriptedToolCall,
    useId = "scripted-call",
  ): Promise<void> {
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
    const client = await this.clientFor(server.instance);
    const output = await client.callTool({ name: toolName ?? "", arguments: call.input });
    const content = Array.isArray(output["content"]) ? output["content"] : [];
    const first: unknown = content[0];
    const text =
      typeof first === "object" && first !== null && "text" in first ? String(first.text) : "";
    this.outputs.push({ id: useId, name: call.name, text, isError: output["isError"] === true });
  }

  private clientFor(instance: ConnectableServer): Promise<Client> {
    const existing = this.clients.get(instance);
    if (existing !== undefined) return existing;

    const connected = (async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "scripted-model", version: "1" });
      await Promise.all([instance.connect(serverTransport), client.connect(clientTransport)]);
      return client;
    })();
    this.clients.set(instance, connected);
    return connected;
  }
}
