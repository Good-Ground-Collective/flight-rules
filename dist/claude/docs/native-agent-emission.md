# Native agent emission

The shared registry resolves five canonical prompts into seven named registrations. `MarkdownClaudeAgentEmitter` and `TomlCodexAgentEmitter` serialize the same definitions into each host's native metadata. Decoding a generated registration recovers the original prompt bytes, including quotes and line endings.

```typescript
import { FileAgentRegistry, TomlCodexAgentEmitter } from '@good-ground-collective/flight-rules';

const agents = new FileAgentRegistry().load('/path/to/flight-rules/agents');
const emitter = new TomlCodexAgentEmitter({
  models: { standard: 'gpt-6-luna', escalated: 'gpt-6.1-sol', expert: 'gpt-6-astra' },
  reasoning: { standard: 'high', escalated: 'high', expert: 'low' },
});
const agent = agents.find(agent => agent.frontmatter.name === 'code-verifier');
if (agent === undefined) throw new Error('Missing code-verifier registration');
const toml = emitter.emit(agent);
```

Reviewed defaults live under `adapters/codex`. Explicit neutral reasoning overrides its tier default. These bindings are configurable and depend on model access. They do not change canonical prompts or dispatch instructions.

Codex registrations contain `name`, `description`, `developer_instructions`, model/reasoning settings, a sandbox default and web-search mode. Editing roles default to workspace-write; other roles default to read-only. Web-search capability selects live search; other roles disable it. Color is omitted. TOML emission uses basic escaped strings, with no production TOML dependency; tests round-trip it with an independent parser.

`diagnostics()` reports the host's limitations. Codex has no equivalent per-agent tool allowlist, and the parent session can override sandbox defaults. Evidence directories therefore need writable access from the runtime adapter. Explicit filesystem/network restrictions, dispatch limits and worker spawn/ask capabilities are rejected until an adapter can enforce their meaning. This avoids treating an emitted default as a runtime permission guarantee.

Standalone `.codex/agents/*.toml` files are configuration layers for named agents. The native Codex plugin format does not declare an agents component; full package assembly and project-scoped agent installation are subsequent slices. See official [custom agent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents) and [plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Native parser check

With dependencies and Codex CLI installed, run:

```bash
npm run test:agents:codex-config
```

The runner emits all registrations in a temporary Git repository and gives that repository process-local trust. It initializes an ephemeral Codex session without sending a model turn. A malformed control must produce an agent-definition warning; after removing it, the generated files must load without warnings. User configuration is unchanged. The printed scratch directory retains its report.

This check passed with Codex CLI 0.162.1. It proves native configuration parsing, while model availability, dispatched execution, installation and writable evidence paths still need the later integration checks. The Claude live-role test remains available as `npm run test:agents:live`.
