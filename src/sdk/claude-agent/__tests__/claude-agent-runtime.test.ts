import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import type {
  DispatchRequest,
  RuntimeSnapshot,
} from "../../../orchestration/orchestration.schema.js";
import {
  ClaudeAgentConfigurationError,
  ClaudeAgentWorkerRuntime,
} from "../claude-agent-runtime.js";
import { InvalidClaudeHostToolError, type WorkerHostTool } from "../tool-policy.js";
import { ScriptedClaudeQuery, type QueryScript } from "./scripted-claude-query.js";

const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../../agents", import.meta.url)),
);
const context = {
  runId: "claude-agent-test",
  taskId: "worker-contract",
  cwd: "/repo",
  repositoryRoot: "/repo",
  baseRef: "main",
  skill: "execute-work",
  attempt: 1,
};
const available = {
  state: "available",
  evidence: "Host observed this capability for the active checkout.",
} as const;
const tierModels = { standard: "sonnet", escalated: "opus", expert: "fable" };

function runtimeSnapshot(request: DispatchRequest): RuntimeSnapshot {
  return {
    context: request.context,
    host: { name: "test-host", version: "1" },
    observedAt: new Date().toISOString(),
    agent: request.agent,
    spawn: available,
    ask: available,
    permissions: {
      read: available,
      edit: available,
      shell: available,
      web: available,
      spawn: available,
      ask: available,
    },
    limits: {
      maxConcurrent: 3,
      activeWorkers: 0,
      currentDepth: 0,
      maxDepth: 1,
      source: "Test host observation",
    },
  };
}

function request(id: string, agent: string, mode: string): DispatchRequest {
  return { id, agent, context, input: { mode, focus: id } };
}

function hostTool(
  name: string,
  handler: WorkerHostTool["handler"] = async () => "Repository contents",
): WorkerHostTool {
  return { name, description: `Host tool ${name}`, inputSchema: {}, handler };
}

function runtimeFor(
  script: QueryScript,
  overrides: Partial<ConstructorParameters<typeof ClaudeAgentWorkerRuntime>[0]> = {},
) {
  const scripted = new ScriptedClaudeQuery(script);
  const workers = new ClaudeAgentWorkerRuntime({
    agents,
    models: tierModels,
    toolGrants: {},
    observe: async (dispatch) => runtimeSnapshot(dispatch),
    query: scripted.query,
    ...overrides,
  });
  return { scripted, workers };
}

const implementationReport =
  "```yaml\nsummary: Done\nfilesChanged: []\ntestsRun: []\napproach: Scripted report\n```";
const verificationReport =
  "```yaml\nsummary: Verified\ncriteria:\n  - criterion: Contract works\n    verdict: PASS\n    evidence: The actual query returned this report\nverified: true\n```";
const triageReport = `\`\`\`yaml\nsummary: No actionable findings\nheadSha: "${"a".repeat(40)}"\nfindings: []\n\`\`\``;
const qaVerificationReport =
  "```yaml\nsummary: Verified\nitems: []\nevidence:\n  dir: /tmp/evidence\n  items: []\nverified: true\n```";
const researchReport =
  "```yaml\nsummary: Findings\nconfidence: high\ninternal:\n  files: []\n  patterns: []\n  integrationPoints: []\n  risks: []\n```";
const reproduceReport =
  "```yaml\nsummary: Reproduced\nreproduced: false\nreason: No symptom in fixture\nevidence:\n  dir: /tmp/evidence\n  items: []\n```";
const authorReport =
  "```yaml\nsummary: Authored\nwhatWasChanged:\n  - Wrote the requested artifact\nwhyWasItChanged: The contract requested it\notsMaterials: No additional materials\n```";

describe("Claude Agent worker runtime", () => {
  it.each([
    ["code-implementation", "implement", "sonnet", implementationReport],
    ["code-implementation-escalated", "implement", "opus", implementationReport],
    ["code-verifier", "verify", "sonnet", verificationReport],
    ["code-verifier", "triage", "sonnet", triageReport],
    ["research-agent", "internal", "opus", researchReport],
    ["qa-engineer", "reproduce", "opus", reproduceReport],
    ["qa-engineer-verify", "verify", "sonnet", qaVerificationReport],
    ["tech-writer", "author", "opus", authorReport],
  ])("runs the named %s registration on its bound %s model", async (agent, mode, model, report) => {
    const { scripted, workers } = runtimeFor({ response: report });

    const outcome = await workers.dispatch(request(`dispatch-${agent}`, agent, mode));

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "completed",
      agent,
      dispatchId: `dispatch-${agent}`,
      context,
    });
    expect(scripted.invocations).toHaveLength(1);
    const [call] = scripted.invocations;
    expect(call?.options.model).toBe(model);
    expect(call?.options.systemPrompt).toBe(
      agents.find((entry) => entry.frontmatter.name === agent)?.body,
    );
    expect(call?.prompt).toContain(`dispatch-${agent}`);
  });

  it("binds models from the shipped Claude tier table by default", async () => {
    const scripted = new ScriptedClaudeQuery({ response: researchReport });
    const workers = new ClaudeAgentWorkerRuntime({
      agents,
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
      query: scripted.query,
    });

    await workers.dispatch(request("default-tier", "research-agent", "internal"));

    expect(scripted.invocations[0]?.options.model).toBe("opus");
  });

  it("never lets host settings, plugins or project MCP configuration into a query", async () => {
    const { scripted, workers } = runtimeFor({ response: authorReport }, { maxTurns: 7 });

    await workers.dispatch(request("isolated", "tech-writer", "author"));

    const options = scripted.invocations[0]?.options;
    expect(options).toMatchObject({
      cwd: "/repo",
      settingSources: [],
      strictMcpConfig: true,
      plugins: [],
      permissionMode: "default",
      persistSession: false,
      maxTurns: 7,
      tools: ["Glob", "Grep", "Read"],
    });
    expect(options).not.toHaveProperty("allowedTools");
    expect(options).not.toHaveProperty("settings");
    expect(options).not.toHaveProperty("mcpServers");
    expect(options).not.toHaveProperty("outputFormat");
    expect(options?.disallowedTools).toEqual(
      expect.arrayContaining(["Agent", "AskUserQuestion", "Skill", "ToolSearch"]),
    );
  });

  it("does not grant write, shell or spawn tools to a read-only worker and rejects a scripted write before any handler runs", async () => {
    let backingCalls = 0;
    const hostWriteTool = hostTool("repository_write", async () => {
      backingCalls++;
      return "host write ran";
    });
    const { scripted, workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "Write", input: { file_path: "/repo/output.ts", content: "changed" } }],
      },
      { toolGrants: { read: [], edit: [hostWriteTool] } },
    );

    const outcome = await workers.dispatch(request("readonly", "tech-writer", "author"));

    const options = scripted.invocations[0]?.options;
    expect(options?.tools).toEqual(["Glob", "Grep", "Read"]);
    expect(options?.tools).not.toEqual(expect.arrayContaining(["Write", "Edit", "Bash", "Agent"]));
    expect(options).not.toHaveProperty("mcpServers");
    expect(scripted.executedBuiltIns).toEqual([]);
    expect(backingCalls).toBe(0);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "failed",
      failure: { code: "CAPABILITY_DENIED", capability: "edit" },
    });
  });

  it("executes only a host tool covered by both the named worker and the observed grant", async () => {
    const calls: Array<{ args: Record<string, unknown>; signal: AbortSignal }> = [];
    const repositoryRead = hostTool("repository_read", async (args, { signal }) => {
      calls.push({ args, signal });
      return { text: "Repository contents" };
    });
    const { scripted, workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "mcp__flight-rules-host__repository_read", input: {} }],
      },
      { toolGrants: { read: [repositoryRead] } },
    );

    const outcome = await workers.dispatch(request("permitted-read", "tech-writer", "author"));

    expect(outcome.status).toBe("completed");
    expect(calls).toHaveLength(1);
    const options = scripted.invocations[0]?.options;
    expect(options?.mcpServers).toMatchObject({ "flight-rules-host": { type: "sdk" } });
    expect(options).not.toHaveProperty("allowedTools");
  });

  it("serves no host tool for a capability the registration withholds", async () => {
    const calls: string[] = [];
    const web = hostTool("web_search", async () => {
      calls.push("web");
      return "results";
    });
    const { scripted, workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "mcp__flight-rules-host__web_search", input: {} }],
      },
      { toolGrants: { web: [web] } },
    );

    const outcome = await workers.dispatch(request("unregistered-web", "tech-writer", "author"));

    expect(outcome).toMatchObject({ status: "failed", failure: { code: "CAPABILITY_UNKNOWN" } });
    expect(calls).toEqual([]);
    expect(scripted.invocations[0]?.options).not.toHaveProperty("mcpServers");
  });

  it("rejects duplicate and invalid host tool names at construction", () => {
    const build =
      (toolGrants: ConstructorParameters<typeof ClaudeAgentWorkerRuntime>[0]["toolGrants"]) => () =>
        runtimeFor({ response: authorReport }, { toolGrants }).workers;

    expect(build({ read: [hostTool("lookup")], edit: [hostTool("lookup")] })).toThrow(
      InvalidClaudeHostToolError,
    );
    expect(build({ read: [hostTool("not valid!")] })).toThrow(ClaudeAgentConfigurationError);
    expect(
      build({ read: [{ ...hostTool("ok"), inputSchema: { value: "string" } as never }] }),
    ).toThrow(ClaudeAgentConfigurationError);
  });

  it("hands each host tool its validated arguments", async () => {
    const received: Array<Record<string, unknown>> = [];
    const lookup: WorkerHostTool = {
      name: "lookup",
      description: "Look up a symbol",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: true },
      handler: async (args) => {
        received.push(args);
        return "found";
      },
    };
    const { workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "mcp__flight-rules-host__lookup", input: { symbol: "Foo" } }],
      },
      { toolGrants: { read: [lookup] } },
    );

    await workers.dispatch(request("host-args", "tech-writer", "author"));

    expect(received).toEqual([{ symbol: "Foo" }]);
  });

  it("denies a file path outside the repository root and stops the run", async () => {
    const { scripted, workers } = runtimeFor({
      response: authorReport,
      calls: [
        { name: "Read", input: { file_path: "/repo/src/index.ts" } },
        { name: "Read", input: { file_path: "/etc/passwd" } },
      ],
    });

    const outcome = await workers.dispatch(request("outside-root", "tech-writer", "author"));

    expect(scripted.executedBuiltIns).toEqual(["Read"]);
    expect(scripted.deniedTools).toEqual(["Read"]);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "failed",
      failure: { code: "CAPABILITY_DENIED", capability: "read" },
    });
  });

  it("preserves structured guard failures without matching provider error text", async () => {
    let backingCalls = 0;
    const repositoryRead = hostTool("repository_read", async () => {
      backingCalls++;
      return "Repository contents";
    });
    const unknown = runtimeFor(
      { response: "", calls: [{ name: "unregistered_read", input: {} }] },
      { toolGrants: { read: [repositoryRead] } },
    );
    const provider = runtimeFor(
      {
        response: authorReport,
        failure: new Error("The worker attempted repository_read without an effective read grant."),
      },
      { toolGrants: { read: [repositoryRead] } },
    );

    const unknownTool = await unknown.workers.dispatch(
      request("unknown-tool", "tech-writer", "author"),
    );
    const providerFailure = await provider.workers.dispatch(
      request("similar-provider-error", "tech-writer", "author"),
    );

    expect(unknownTool).toMatchObject({
      status: "failed",
      failure: { code: "CAPABILITY_UNKNOWN", capability: undefined },
    });
    expect(providerFailure).toMatchObject({
      status: "failed",
      failure: { code: "EXECUTION_FAILED" },
    });
    expect(backingCalls).toBe(0);
  });

  it("keeps actual query concurrency bounded and returns reports in input order", async () => {
    let active = 0;
    let peak = 0;
    const instrumented = new ScriptedClaudeQuery({
      response: authorReport,
      wait: async (prompt) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, prompt.includes('"slow"') ? 30 : 10));
        active--;
      },
    });
    const bounded = new ClaudeAgentWorkerRuntime({
      agents,
      models: tierModels,
      toolGrants: {},
      observe: async (dispatch) => runtimeSnapshot(dispatch),
      query: instrumented.query,
    });

    const outcomes = await bounded.dispatchMany(
      [
        request("slow", "tech-writer", "author"),
        request("fast", "tech-writer", "author"),
        request("last", "tech-writer", "author"),
      ],
      { maxConcurrent: 2 },
    );

    expect(outcomes.map((outcome) => outcome.dispatchId)).toEqual(["slow", "fast", "last"]);
    expect(peak).toBe(2);
  });

  it("cancels queued requests and keeps the running reservation until its query stops", async () => {
    const { scripted, workers } = runtimeFor({ response: authorReport, delay: () => 50 });
    const controller = new AbortController();
    const pending = workers.dispatchMany(
      [request("running", "tech-writer", "author"), request("queued", "tech-writer", "author")],
      { maxConcurrent: 1, signal: controller.signal },
    );
    await vi.waitFor(() => expect(scripted.invocations).toHaveLength(1));
    controller.abort();

    const outcomes = await pending;

    expect(outcomes.map((outcome) => [outcome.dispatchId, outcome.status])).toEqual([
      ["running", "failed"],
      ["queued", "failed"],
    ]);
    expect(outcomes.map((outcome) => outcome.status === "failed" && outcome.failure.code)).toEqual([
      "CANCELLED",
      "CANCELLED",
    ]);
    expect(scripted.completed).toBe(1);
    expect(scripted.invocations[0]?.options.abortController?.signal.aborted).toBe(true);
  });

  it("shares host capacity across overlapping dispatch calls until an aborted query settles", async () => {
    const { scripted, workers } = runtimeFor(
      { response: authorReport, delay: () => 100 },
      {
        observe: async (dispatch) => {
          const snapshot = runtimeSnapshot(dispatch);
          return { ...snapshot, limits: { ...snapshot.limits, maxConcurrent: 1 } };
        },
      },
    );
    const controller = new AbortController();
    const first = workers.dispatch(request("overlap-first", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(scripted.invocations).toHaveLength(1));
    controller.abort();
    const second = workers.dispatch(request("overlap-second", "tech-writer", "author"));

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(scripted.invocations).toHaveLength(1);
    expect(scripted.completed).toBe(0);

    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(secondOutcome).toMatchObject({ status: "completed", dispatchId: "overlap-second" });
    expect(scripted.invocations).toHaveLength(2);
    expect(scripted.completed).toBe(2);
  });

  it("returns cancellation for a queued overlapping call before an unrelated query settles", async () => {
    let releaseFirst: (() => void) | undefined;
    let secondObserved = false;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { scripted, workers } = runtimeFor(
      {
        response: authorReport,
        wait: (prompt) => (prompt.includes("queued-first") ? firstGate : Promise.resolve()),
      },
      {
        observe: async (dispatch) => {
          if (dispatch.id === "queued-second") secondObserved = true;
          const snapshot = runtimeSnapshot(dispatch);
          return { ...snapshot, limits: { ...snapshot.limits, maxConcurrent: 1 } };
        },
      },
    );
    const first = workers.dispatch(request("queued-first", "tech-writer", "author"));
    await vi.waitFor(() => expect(scripted.invocations).toHaveLength(1));
    const controller = new AbortController();
    const second = workers.dispatch(request("queued-second", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(secondObserved).toBe(true));
    controller.abort();

    const secondOutcome = await second;

    expect(secondOutcome).toMatchObject({
      status: "failed",
      dispatchId: "queued-second",
      failure: { code: "CANCELLED" },
    });
    expect(scripted.invocations).toHaveLength(1);
    expect(scripted.completed).toBe(0);

    releaseFirst?.();
    await expect(first).resolves.toMatchObject({ status: "completed", dispatchId: "queued-first" });
    expect(scripted.completed).toBe(1);
  });

  it("keeps capacity reserved until an aborted host tool promise settles", async () => {
    let releaseFirstTool: (() => void) | undefined;
    let toolAbortSignal: AbortSignal | undefined;
    let toolCalls = 0;
    const repositoryRead = hostTool("repository_read", async (_args, { signal }) => {
      toolCalls++;
      toolAbortSignal = signal;
      if (toolCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstTool = resolve;
        });
      }
      return "Repository contents";
    });
    const { scripted, workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "mcp__flight-rules-host__repository_read", input: {} }],
      },
      {
        toolGrants: { read: [repositoryRead] },
        observe: async (dispatch) => {
          const snapshot = runtimeSnapshot(dispatch);
          return { ...snapshot, limits: { ...snapshot.limits, maxConcurrent: 1 } };
        },
      },
    );
    const controller = new AbortController();
    const first = workers.dispatch(request("pending-tool-first", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(toolCalls).toBe(1));
    controller.abort();
    expect(toolAbortSignal?.aborted).toBe(true);
    const second = workers.dispatch(request("pending-tool-second", "tech-writer", "author"));

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(
      scripted.invocations.filter((call) => call.prompt.includes("pending-tool-second")),
    ).toHaveLength(0);
    expect(toolCalls).toBe(1);

    releaseFirstTool?.();
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
    expect(secondOutcome).toMatchObject({ status: "completed", dispatchId: "pending-tool-second" });
    expect(toolCalls).toBe(2);
  });

  it("propagates caller cancellation to cooperative host tools", async () => {
    let toolAbortSignal: AbortSignal | undefined;
    const repositoryRead = hostTool("repository_read", async (_args, { signal }) => {
      toolAbortSignal = signal;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return "The host operation stopped";
    });
    const { workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "mcp__flight-rules-host__repository_read", input: {} }],
      },
      { toolGrants: { read: [repositoryRead] } },
    );
    const controller = new AbortController();
    const pending = workers.dispatch(request("cooperative-tool", "tech-writer", "author"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(toolAbortSignal).toBeDefined());
    controller.abort();

    const outcome = await pending;

    expect(toolAbortSignal?.aborted).toBe(true);
    expect(outcome).toMatchObject({ status: "failed", failure: { code: "CANCELLED" } });
  });

  it("fails the dispatch when a host tool throws even if the model still reports success", async () => {
    const repositoryRead = hostTool("repository_read", async () => {
      throw new Error("checkout unreadable");
    });
    const { workers } = runtimeFor(
      {
        response: authorReport,
        calls: [{ name: "mcp__flight-rules-host__repository_read", input: {} }],
      },
      { toolGrants: { read: [repositoryRead] } },
    );

    const outcome = await workers.dispatch(request("tool-failure", "tech-writer", "author"));

    expect(outcome).toMatchObject({
      status: "failed",
      failure: { code: "EXECUTION_FAILED", message: "checkout unreadable" },
    });
  });

  it("maps SDK error results, turn limits and a throw after an error result to EXECUTION_FAILED", async () => {
    const errored = runtimeFor({ resultSubtype: "error_during_execution" });
    const turnLimited = runtimeFor({ resultSubtype: "error_max_turns" }, { maxTurns: 3 });
    const flagged = runtimeFor({ response: "model refused", isError: true });
    const thrown = runtimeFor({
      resultSubtype: "error_during_execution",
      throwAfterResult: new Error("process exited with code 1"),
    });

    const outcomes = await Promise.all([
      errored.workers.dispatch(request("errored", "tech-writer", "author")),
      turnLimited.workers.dispatch(request("turn-limited", "tech-writer", "author")),
      flagged.workers.dispatch(request("flagged", "tech-writer", "author")),
      thrown.workers.dispatch(request("thrown", "tech-writer", "author")),
    ]);

    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ status: "failed", failure: { code: "EXECUTION_FAILED" } });
    }
    expect(outcomes[1]?.status === "failed" && outcomes[1].failure.message).toContain(
      "maxTurns (3)",
    );
  });

  it("returns named failures for unknown workers and malformed reports without escalation", async () => {
    const { scripted, workers } = runtimeFor({ response: "```yaml\nsummary: Missing fields\n```" });

    const unknown = await workers.dispatch(request("unknown", "unregistered-worker", "author"));
    const malformed = await workers.dispatch(request("malformed", "tech-writer", "author"));
    const invalidMode = await workers.dispatch(
      request("invalid-mode", "tech-writer", "unsupported"),
    );

    expect(unknown).toMatchObject({ status: "unavailable", failure: { code: "UNKNOWN_AGENT" } });
    expect(malformed).toMatchObject({
      status: "failed",
      failure: { code: "INVALID_REPORT" },
      context,
    });
    expect(invalidMode).toMatchObject({ status: "failed", failure: { code: "INVALID_REPORT" } });
    expect(scripted.invocations).toHaveLength(1);
  });

  it("rejects an invalid caller context before starting a query", async () => {
    const { scripted, workers } = runtimeFor({ response: authorReport });

    await expect(
      workers.dispatch({
        ...request("invalid-context", "tech-writer", "author"),
        context: { ...context, cwd: "/elsewhere" },
      }),
    ).rejects.toThrow();
    expect(scripted.invocations).toHaveLength(0);
  });

  it("rejects unbound tiers at construction and retains restriction and limit failures", async () => {
    expect(() =>
      runtimeFor({ response: authorReport }, { models: { standard: "sonnet" } }),
    ).toThrow(ClaudeAgentConfigurationError);

    const restrictedAgents = agents.map((agent) =>
      agent.frontmatter.name === "tech-writer"
        ? {
            ...agent,
            frontmatter: { ...agent.frontmatter, dispatch: { maxConcurrent: 1, maxDepth: 1 } },
          }
        : agent,
    );
    const restricted = runtimeFor({ response: authorReport }, { agents: restrictedAgents });
    const unknownLimits = runtimeFor(
      { response: authorReport },
      {
        observe: async (dispatch) => {
          const snapshot = runtimeSnapshot(dispatch);
          return {
            ...snapshot,
            limits: { ...snapshot.limits, maxConcurrent: null, maxDepth: null },
          };
        },
      },
    );

    expect(
      await restricted.workers.dispatch(request("restricted", "tech-writer", "author")),
    ).toMatchObject({ status: "unavailable", failure: { code: "UNSUPPORTED_AGENT_SETTINGS" } });
    expect(
      await unknownLimits.workers.dispatch(request("unknown-limits", "tech-writer", "author")),
    ).toMatchObject({ status: "unavailable", failure: { code: "LIMITS_UNKNOWN" } });
    expect(restricted.scripted.invocations).toHaveLength(0);
    expect(unknownLimits.scripted.invocations).toHaveLength(0);
  });

  it("surfaces a single dispatch without an outcome as ClaudeAgentConfigurationError", async () => {
    const { workers } = runtimeFor({ response: authorReport });
    const dispatcher = (workers as unknown as { dispatcher: object }).dispatcher;
    const dispatchMany = vi
      .spyOn(
        Object.getPrototypeOf(dispatcher) as { dispatchMany: () => Promise<unknown[]> },
        "dispatchMany",
      )
      .mockResolvedValue([]);
    try {
      const failure = await workers.dispatch(request("no-outcome", "tech-writer", "author")).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ClaudeAgentConfigurationError);
      expect((failure as Error).name).toBe("ClaudeAgentConfigurationError");
    } finally {
      dispatchMany.mockRestore();
    }
  });
});
