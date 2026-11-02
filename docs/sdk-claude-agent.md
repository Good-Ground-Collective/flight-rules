# Claude Agent SDK worker binding

`@good-ground-collective/flight-rules/sdk/claude-agent` runs the neutral worker registrations (code-implementation, code-verifier, research-agent and the rest) through the Claude Agent SDK. It is an optional peer entry: applications that only use the root library, review entry, neutral SDK, MCP server or CLI never load `@anthropic-ai/claude-agent-sdk`, and this entry loads no LangChain package.

The package is published to GitHub Packages. Configure the `@good-ground-collective` scope registry and a read token first; [the shared package guide](code-review-package.md#consumer-entry-points) documents that prerequisite. Then install the optional runtime at the version exercised by the consumer proof:

```sh
npm install @good-ground-collective/flight-rules @anthropic-ai/claude-agent-sdk@0.3.316
```

The SDK's own peers (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` and `zod`) must be installable alongside it; `zod` is already a dependency of this package. Root, review and neutral SDK consumers install none of this.

## Construct a runtime

Create one `ClaudeAgentWorkerRuntime` with the registrations from the instruction catalog, a host observation callback and capability-scoped host tools. Each registration's model is fixed when the runtime is constructed; a dispatch request cannot replace it.

```ts
import { ClaudeAgentWorkerRuntime } from "@good-ground-collective/flight-rules/sdk/claude-agent";
import { instructionCatalog } from "@good-ground-collective/flight-rules/sdk";
import { z } from "zod";

const workers = new ClaudeAgentWorkerRuntime({
  agents: instructionCatalog.listAgents().map((name) => instructionCatalog.loadAgent(name)),
  toolGrants: {
    read: [
      {
        name: "ticket_lookup",
        description: "Read a ticket from the tracker",
        inputSchema: { id: z.string() },
        annotations: { readOnlyHint: true },
        handler: async ({ id }, { signal }) => host.readTicket(String(id), signal),
      },
    ],
  },
  observe: (request) => host.observeWorker(request),
  maxTurns: 64,
});

const outcome = await workers.dispatch({
  id: "research-1",
  agent: "research-agent",
  context: callerContext,
  input: { mode: "internal", focus: "Trace the request path" },
});
```

- `models` is optional. By default the tier table shipped at `adapters/claude/model-tiers.json` is loaded from the installed package, wherever the process runs. Pass `{ standard, escalated, expert }` to bind other model names. Construction throws `ClaudeAgentConfigurationError` when a registration's tier has no model.
- `toolGrants` maps a capability (`read`, `edit`, `shell`, `web`) to host tools. Names must be 1-64 letters, digits, underscores or hyphens and unique across all grants; `InvalidClaudeHostToolError` rejects the rest at construction.
- `maxTurns` (default 64) bounds model round trips. It is a different unit from the LangGraph step bound in the Deep Agents binding.
- `query` replaces the SDK's `query` function. Tests use it to script a run without a provider or native binary.

## What each dispatch does

A dispatch is one `query()` call. The registration's canonical agent body is the system prompt; the user prompt carries the unchanged caller context and the JSON dispatch input. Every call sets:

- `settingSources: []`, `plugins: []` and `strictMcpConfig: true`, so user, project and local settings, plugins and `.mcp.json` files cannot add tools, hooks or permissions.
- `permissionMode: "default"`, no `allowedTools`, and `persistSession: false`.
- `cwd` from the caller context.
- `tools`: the Claude built-ins for each capability that is both registered for the worker and observed available (`read`: Glob, Grep, Read; `edit`: Write, Edit; `shell`: Bash; `web`: WebSearch, WebFetch).
- `disallowedTools` including `Agent`, `AskUserQuestion`, `Skill` and `ToolSearch`. `spawn` and `ask` need an orchestration adapter and are never served by this binding.

Host tools are served through an in-process MCP server named `flight-rules-host`, allowlisted as `mcp__flight-rules-host__<name>`. Only tools whose capability is registered and observed available are served. Each handler receives its validated arguments and `{ signal }`, the run's abort signal.

## Guarantees

- **Authoritative guard.** A catch-all `PreToolUse` hook runs before every tool call. It denies any tool outside the run's allowlist and any built-in file path outside `context.repositoryRoot` (relative paths, `~`, `..` globs and symlinks included). A denial stops the run and the outcome is `CAPABILITY_DENIED` (or `CAPABILITY_UNKNOWN`, with no capability named, both for a host tool granted under a capability the registration withholds and for any tool outside the built-in capability map). `canUseTool` is a backstop that applies the same decision, because the SDK skips it for auto-approved calls. A read-only worker never receives Write, Edit, Bash or Agent, and a scripted Write from one is rejected before any handler runs.
- **Validated reports.** The final `result` text goes through the shared report codec. Malformed text is `INVALID_REPORT`; an error result, `error_max_turns` or a thrown query is `EXECUTION_FAILED`; an abort is `CANCELLED`. Dispatch id, agent and context come from the request, never from model output. A host tool that throws fails the dispatch even if the model goes on to report success.
- **Held reservations.** Capacity stays reserved until the `query()` iterator has ended and every host tool promise has settled. Cooperative host tools should watch `signal` and settle when their backing work stops.
- **Shared dispatcher.** Batches re-observe before admission, use the same bounded queue as the Deep Agents binding and return outcomes in request order. `AbortSignal` cancels queued and running work.

## Real filesystem, not a sandbox

Unlike the Deep Agents binding's in-memory filesystem, the Claude built-in tools act on the real checkout. That is intended: a worker that edits a pull request branch edits real files. The path guard confines the built-in file tools to the repository root, but it cannot sandbox a shell command or inspect what a host tool does with its arguments. Bash is granted only to registrations with the `shell` capability. Isolating that shell (container, VM, restricted user, network policy) is the host's responsibility, and host tools must enforce their own access rules.
