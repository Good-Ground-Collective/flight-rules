# Deep Agents worker binding

`@good-ground-collective/flight-rules/sdk/deepagents` runs the neutral worker registrations through Deep Agents graphs. It is an optional peer entry: applications that only use the root library, review entry or neutral SDK do not load LangChain packages.

Create one `DeepAgentsWorkerRuntime` with the seven registrations from `FileAgentRegistry`, one model instance for each tier, a host observation callback and capability-scoped tools. The registration chooses its model tier when the runtime is constructed; a dispatch request cannot replace that binding.

```ts
import { DeepAgentsWorkerRuntime } from "@good-ground-collective/flight-rules/sdk/deepagents";
import { instructionCatalog } from "@good-ground-collective/flight-rules/sdk";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Construct these BaseChatModel instances with your provider and model settings.
declare const standardModel: BaseChatModel;
declare const escalatedModel: BaseChatModel;
declare const expertModel: BaseChatModel;

const workers = new DeepAgentsWorkerRuntime({
  agents: instructionCatalog.listAgents().map((name) => instructionCatalog.loadAgent(name)),
  models: {
    standard: standardModel,
    escalated: escalatedModel,
    expert: expertModel,
  },
  toolGrants: {
    read: [repositoryReadTool],
    edit: [repositoryWriteTool],
    shell: [confinedShellTool],
    web: [approvedWebSearchTool],
  },
  observe: (request) => host.observeWorker(request),
});

const outcome = await workers.dispatch({
  id: "research-1",
  agent: "research-agent",
  context: callerContext,
  input: { mode: "internal", focus: "Trace the request path" },
});
```

The host callback must return fresh effective permission and capacity observations for the exact request context. Tools are included only when their capability is registered for that worker and observed as available. Host-provided shell and web tools must enforce real host access themselves; filesystem rules cannot sandbox a shell command. The built-in filesystem tools use an isolated graph-state backend, never a local shell backend. Read-only registrations do not receive write, delete, execute or task tools. A per-graph call guard rejects hidden or hallucinated tool requests before a backing tool runs.

Each batch re-observes before admission, uses the shared bounded queue and returns outcomes in request order. Concurrent calls on one runtime share reservations against the observed host capacity. Pass an `AbortSignal` to cancel queued and running work. The graph receives that signal. The adapter detaches it from nested LangChain tool runnables so they cannot release capacity before their backing promise ends, then exposes it to host tools in `runtime.configurable.flightRulesAbortSignal` (the exported `flightRulesAbortSignalConfigKey` identifies that field). Cooperative host tools can use the signal and should settle their promise when their backing work has stopped. Reservations remain held until underlying model and tool calls actually stop. `maxGraphSteps` is the LangGraph recursion bound; host nesting depth and the implementation retry policy remain separate.

Workers receive the canonical prompt body, the unchanged caller context and the JSON dispatch input. Only a final YAML report that passes the neutral role/mode codec becomes a completed outcome. Dispatch identity and context are supplied by the adapter, never by model output.
