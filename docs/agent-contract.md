# Shared agent definitions

Canonical prompts live in `agents/*.md`. Their leading YAML declares capabilities and model tiers rather than a host's tool names or model IDs. `FileAgentRegistry` validates those definitions and resolves named tier variants. Host emitters serialize their metadata and preserve their prompt bodies byte for byte.

```yaml
name: code-verifier
description: Checks acceptance criteria with concrete evidence.
capabilities: [read, shell]
model: standard
```

Unknown keys, duplicate capabilities and unknown tiers fail validation. Optional `reasoning`, `sandbox` and `dispatch` settings are preferences or restrictions an adapter must explicitly handle. Display color may live in the optional `x-claude` extension; it has no meaning for another host.

## Capabilities

| Capability | Meaning |
| --- | --- |
| `read` | Find and read files, including images when the task requires them |
| `edit` | Create and modify files |
| `shell` | Execute commands in the granted environment |
| `web` | Search the web and retrieve source pages |
| `spawn` | Dispatch agents through the host's orchestration mechanism |
| `ask` | Ask the human and wait for their answer before dependent work |

Capabilities describe what a role needs. They do not grant permission, bypass a sandbox or imply authorization for external writes. In particular, a role with shell access may be technically able to write files even without an editing tool; its instructions and runtime permissions still govern those writes.

Current workers use only `read`, `edit`, `shell` and `web`. They return questions or missing-access evidence to their caller; they do not receive `spawn` or `ask`. Orchestrating skills require those capabilities only where their workflow uses them. The orchestration interface and runtime limits belong to E4.

Research that requires web sources must report missing access and low confidence when those capabilities are unavailable. It cannot replace unread sources with recollection. Reproduction and verification remain unattended: missing inputs return named failures. Planning and configuration discovery retain their explicit stop-and-wait points.

Real executables such as `flight-rules`, `playwright-cli`, `ffmpeg` and `op` keep their names. Shared instructions describe file reading, editing, shell execution and human questions without naming a host's native tool.

## Tiers and named variants

| Tier | Intended use |
| --- | --- |
| `standard` | Work against a clear walkthrough or recorded contract |
| `escalated` | Investigation or the final retry after recorded failures |
| `expert` | Reserved; selecting it requires a nonempty `modelReason` recording why |

The five canonical prompts resolve into seven named registrations:

| Registration | Tier | Prompt source |
| --- | --- | --- |
| `code-implementation` | standard | `code-implementation.md` |
| `code-implementation-escalated` | escalated | `code-implementation.md` |
| `code-verifier` | standard | `code-verifier.md` |
| `qa-engineer` | escalated | `qa-engineer.md` |
| `qa-engineer-verify` | standard | `qa-engineer.md` |
| `research-agent` | escalated | `research-agent.md` |
| `tech-writer` | escalated | `tech-writer.md` |

`agents/variants.json` supplies only a name, canonical base, description and tier, with an optional expert rationale. It cannot override capabilities or author another prompt. Missing bases, inheritance from another variant and duplicate names fail the build.

Implementation attempts 1 and 2 dispatch `code-implementation`; attempt 3 dispatches `code-implementation-escalated` only after two verifier rejections. The verifier remains unchanged and the three-attempt cap remains intact. QA verification selects `qa-engineer-verify` in verify mode; reproduction selects `qa-engineer`. Callers never set a model override.

## Adapter bindings

Each host owns its reviewed tier table under `adapters/<host>/model-tiers.json`. These are configurable defaults, not claims of equal model behavior or availability across providers.

| Tier | Claude default | Codex default |
| --- | --- | --- |
| standard | `sonnet` | `gpt-6-luna` |
| escalated | `opus` | `gpt-6.1-sol` |
| expert, unused | `fable` | `gpt-6-astra` |

Bindings change without editing a canonical prompt. Account access and host policy may restrict them; confirm actual model selection during native-host execution. See the official [Claude subagent configuration](https://code.claude.com/docs/en/sub-agents) and [OpenAI subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents).

The current Claude emitter maps read to file discovery/search/reading tools, edit to writing/editing tools, shell to command execution and web to search/retrieval. It maps optional reasoning to effort and preserves display color. It rejects worker `spawn`/`ask`, explicit sandbox restrictions and dispatch limits because this emitter cannot enforce them. A future runtime adapter must implement those settings before accepting them.

## Reproduce the live smoke test

From a checkout with dependencies installed and an authenticated Claude CLI, run:

```bash
npm run test:agents:live
```

This builds the plugin and launches three isolated native-role sessions in a temporary directory: the verifier checks exact fixture bytes; the escalated implementer fixes a failing program and runs its test; the QA verification variant confirms it and captures text evidence. Each session is capped at $1. It does not run in normal CI.

The runner asserts discovery of all seven registrations, actual selected models and tool access, complete charter retrieval, parseable YAML, no permission denials, read-only roles preserving the implementation, and an independently checked failing-to-passing test. It retains a report and raw local traces at the printed scratch path. An optional directory argument to `node scripts/test-agents-live.mjs <plugin-directory>` tests an extracted package instead of the checkout.

The [recorded smoke results](validation/e2-live-smoke.json) came from an extracted npm package on Claude Code 2.1.296. Earlier exploratory runs exposed a fixture permission mismatch and an invalid verifier YAML scalar; the final run uses corrected fixture permissions and the canonical verifier's explicit quoting rule. This proves role loading and execution on the fixture. Parent dispatch/retry orchestration, marketplace installation and Codex execution remain the later epics' live checks.

Build generates Claude registrations under `dist/claude/agents` and points the existing plugin manifest at them. Release commits those generated registrations so marketplace installs remain usable; npm includes them too. This compatibility bridge keeps the existing skills/docs/CLI layout. E3 will assemble complete host trees and own the wider generated-artifact migration. The Codex table is ready for that emitter; E2 does not yet ship a Codex plugin.
