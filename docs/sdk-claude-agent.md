# Claude Agent SDK worker binding

`@good-ground-collective/flight-rules/sdk/claude-agent` runs the neutral worker registrations (code-implementation, code-verifier, research-agent and the rest) and canonical skills such as `remediate-review` through the Claude Agent SDK. It is an optional peer entry: applications that only use the root library, review entry, neutral SDK, MCP server or CLI never load `@anthropic-ai/claude-agent-sdk`, and this entry loads no LangChain package.

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

## Run a canonical skill

`ClaudeAgentSkillRuntime` runs one canonical `SKILL.md` body as a single `query()` conversation. It mirrors the Deep Agents skill runtime: the same `invoke`, `resume` and `cancel` methods, the same `completed`, `paused` and `failed` results, and the same partial-operation records on failure. The behavior both bindings share (pause bookkeeping, the operation, dispatch, sibling and ask handlers, failure mapping) lives in a neutral module; only the model loop differs.

```ts
import { ClaudeAgentSkillRuntime } from "@good-ground-collective/flight-rules/sdk/claude-agent";

const skills = new ClaudeAgentSkillRuntime({
  instructions: instructionCatalog,
  agents: instructionCatalog.listAgents().map((name) => instructionCatalog.loadAgent(name)),
  operations,
  workers,
  observe: (context, registration) => host.observe(context, registration),
  toolGrants: (context) => host.toolGrants(context),
});

const result = await skills.invoke("remediate-review", callerContext, input, {
  allowHumanQuestions: false,
  signal,
});
```

- `operations` is the launch-bound operation registry. `workers` is any object with the worker runtime's `dispatch`, usually a `ClaudeAgentWorkerRuntime`. `observe` is called with the caller context, and with the selected registration before a worker dispatch.
- `models` and `maxTurns` behave as they do for the worker runtime. The skill runs on the `standard` tier; construction throws `ClaudeAgentSkillConfigurationError` when it has no model. `query` replaces the SDK function for tests.
- A completed skill's `report` is the final `result` text of the SDK's success message.

### Tools the model sees

The `flight-rules` MCP server is always built. The `flight-rules-host` server is built only when the caller grants host tools. Both are in-process and loaded up front, and nothing shells out to the Claude CLI to serve them.

- `flight-rules` serves `flight_rules_operation`, `flight_rules_dispatch`, `flight_rules_sibling_skill` and, only when the caller passed `allowHumanQuestions: true` and the host observed `ask` available, `flight_rules_ask_human`. With human questions disabled the tool does not exist and nothing ever supplies a default answer.
- `flight-rules-host` serves the caller's host tools exactly as the worker runtime does.

Every operation call re-observes the host and requires `permissionForEffect` evidence for each of the operation's effects (`read`, `write` as edit, `process` as shell, `network` as web) before the handler runs. Worker dispatch goes through the supplied worker runtime after the orchestration evidence check, with the observed registration identity validated against the requested one.

A dispatch the model shaped wrongly before any worker ran (an unknown worker name, or a `mode` the admitted worker's registration does not support) comes back as a tool error naming the dispatchable workers or the worker's valid modes. It is not recorded as a failure and the run continues. A worker that ran and returned an invalid report, an execution failure, a cancellation and any capability or admission denial stay terminal, and their error carries no worker or mode list. The `## Workers` prompt section and the unknown-worker error list every configured registration that has report modes, not only those the host will admit. The prompt's `## Workers` section lists each dispatchable worker with its accepted modes, for example `code-verifier` -> `verify | triage`.

The run uses the same isolation as a worker dispatch: `settingSources: []`, `plugins: []`, `strictMcpConfig: true`, the catch-all `PreToolUse` guard and the `canUseTool` backstop. The only difference is `persistSession: true`, because a paused skill resumes from its saved session. Sessions use the SDK's default storage; a host that needs the session to survive its own process owns that durability.

### Routing `flight-rules` commands to operations

Canonical skills tell the model to run `flight-rules <route>` in a shell, but a host that keeps tracker and GitHub credentials out of the model's shell cannot serve those calls. The runtime routes any route that a registered operation backs to `flight_rules_operation`, which runs with the host's credentials and the launch access policy. `SKILL.md` text is not rewritten.

- **Prompt.** After the canonical instructions and before the invocation context, the runtime adds an "Operations instead of the shell" section listing every operation the launch policy admits as `` `flight-rules doc` -> `doc` `{ id: string }` `` (the input fields derived from the operation's input schema, `?` marking optional ones; nothing is added for an operation with no fields), and saying these commands run through `flight_rules_operation` with the operation id and an input object of the fields that operation expects, never through the shell (an invalid input returns an error naming the expected fields). Alias routes replace only the leaf command name (`hook guard-commit`, not `guard-commit`). Operations the policy denies are not listed. The section is built by `SkillOperationRoutes` in the neutral skill core (`src/sdk/skill-runtime-core.ts`) from `OperationRegistry.admitted()` (optional: a registry without it yields no section and no shell redirects), so the Deep Agents runtime can reuse it; it does not change until that runtime wires it.
- **Guard.** The `PreToolUse` guard (and the `canUseTool` backstop) denies a `Bash` call whose command invokes a backed route through `flight-rules`, `npx flight-rules` or a `bin/flight-rules.mjs` path (optionally after `node`). The reason names the operation id, for example `Use flight_rules_operation with operationId "pr-threads" instead of running "flight-rules pr threads" in the shell.` The command is split on `&&`, `||`, `;`, `|` and newlines, leading `VAR=value` assignments are skipped, and the longest matching route wins (`pr thread-reply` over `pr threads`). A chained command containing a backed route is denied.
- **Tool-level denial.** This denial does not abort the run and records no `CapabilityToolDeniedError`; the model can retry with the operation. A `flight-rules` route with no admitted operation, such as `flight-rules git commit`, and any other command are unaffected, so a host that grants shell still lets the CLI handle them. A host that grants neither the operation nor the shell gets a clear failure.

### Pause and resume

When the model calls `flight_rules_ask_human`, a `PreToolUse` hook re-checks the host's question policy and returns `permissionDecision: "defer"`. The SDK stops with `terminal_reason: "tool_deferred"` and a `deferred_tool_use`, and the runtime returns `status: "paused"` with a `pauseId`, `questionId` and the question text. The pause record keeps the session id, the tool-use id and the question id.

`resume({ context, pauseId, questionId, answer })` validates the pause (it must be `paused`, match the question and the original caller context, and carry a non-blank answer), reserves it so a concurrent resume is rejected, observes again to confirm `ask` is still available, and re-queries with `resume: <session id>`. When the hook fires again for the same tool-use id it allows the call with the human's answer, and the tool returns that answer to the same call. A failure before the continuation starts releases the reservation so the pause can be retried; `cancel(context, pauseId)` ends a paused skill explicitly. The model cannot answer for the human: an `answer` it supplies is denied, and a question tool call the SDK did not pause fails the run with `QUESTION_NOT_PAUSED`.

`query()` takes a prompt on every call. A resume passes an empty prompt stream so no new user message is added. This has been checked against the installed SDK typings but not against a live provider; verify it before relying on pause and resume in production.

### One question or sibling call per turn

Deferral only works when the model makes a single tool call in the turn. The ask and sibling-skill tools therefore fail closed: if either appears in a turn together with any other tool call, the ask or sibling call itself is denied, other calls in the same turn may already have executed, and the denial tells the model to call it alone. Dependent writes and worker dispatches never run beside a sibling that might still ask.

### Failures and partial operations

Input-shape errors are the exception: when `flight_rules_operation` is called with input that fails the operation's input schema, or with an unknown operation id, the tool returns an error result to the model (the validation message plus the expected input fields, or the valid admitted operation ids) and the run continues. Nothing is recorded as a failure and later calls still run. Execution errors, access-policy denials and partial operations below stay terminal.

After the first tool failure, later tool calls are denied and the run ends with `TOOL_FAILED` and that failure's message, even if the model reports success. A shared operation that returns `partial` fails the skill and its `operations` records (operation id, validated partial data and error) are carried on the failure, including those from a sibling skill. An abort ends the run with `CANCELLED` once every in-flight handler has settled. An error result, `error_max_turns` or a thrown query is `EXECUTION_FAILED`.

### Limitation: a sibling cannot pause its parent

Nested pause propagation is not supported. If a sibling skill pauses for a human answer, the runtime cancels the sibling's pause and fails the parent with `NESTED_PAUSE_UNSUPPORTED` (`NestedSkillPauseError`). The Deep Agents binding can carry a sibling's question through its checkpoint; the Claude Agent SDK has no equivalent way to surface a nested session's deferral in the parent's session. Run skills that delegate to siblings with `allowHumanQuestions: false`, or ask the question from the parent skill.
