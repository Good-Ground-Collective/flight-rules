# Workflow preflight

Run the readiness check before a workflow changes repository files, git state or tracker state. It combines read-only environment probes with explicit observations from the actual host. Setup/configuration is a separate prerequisite; a workflow must not discover its missing permissions after setting an in-progress label or creating a branch.

```bash
flight-rules check
flight-rules check --workflow execute-work --runtime-file /absolute/path/to/runtime.json
```

The first command retains the existing `checks` and `ok` contract and reports `scope: "environment"`. It does not assert that orchestration is ready. The second adds workflow requirements, reports `scope: "workflow"` and the selected workflow, and fails when required observations are missing, denied or unknown. Supported workflows are `execute-work`, `execute-wave`, `break-down-work`, `reproduce-bug` and `verify-ticket`. Every check retains `name`, `ok`, `detail` and optional `required`; failures also carry `code`/`remedy` where available. A check with `required: false` never makes the overall result fail.

## What the check establishes

| Observation | Scope and limit |
| --- | --- |
| Config and credentials | Required values are present; secrets are never printed |
| Tracker reachability | Existing GitHub repository/Jira identity read succeeds; tracker writes are not tested |
| GitHub login | Existing `gh auth status` probe succeeds |
| GitHub push entitlement | Existing repository permission query reports account entitlement; no push occurs and transport/branch rules remain untested |
| Git remote read | `git ls-remote origin` succeeds for code workflows; read access does not prove write access |
| Git context | Active checkout matches the supplied root and the comparison base resolves to a commit |
| Local write access | Filesystem access checks on the working directory and Git/worktree common metadata; no file or ref is written and host authorization remains separate |
| Caller capabilities | Explicit effective host evidence for shell, network and tracker writes; code workflows also require edit/git-write/git-push, and QA requires evidence-write access |
| Worker dispatch | Required named registrations, worker permissions, parent dispatch and available slots/depth satisfy the shared orchestration policy; no agent is launched |
| QA tools/instructions | Required for QA workflows; existing optional/general-check behavior remains available |

Code workflows check all four potential roles: standard/escalated implementation, verifier and tech writer. Research checks `research-agent`; QA checks its reproduction or verification registration. This does not dispatch those roles concurrently. Capacity is refreshed before every actual launch, and optional later operations such as UI capture still need their own scoped evidence when selected.

GitHub login and push entitlement are required for code workflows even with a Jira tracker. Other workflow checks do not require GitHub push entitlement. QA instruction discovery remains optional in a general check and becomes required in QA workflows.

Native subprocess probes have a 10-second timeout and a bounded output buffer; tracker ping receives a cancellation signal and the same deadline. Library constructors accept a positive timeout up to 60 seconds. Jira's bounded ping does not enter rate-limit retry backoff. No probe pushes, creates remote resources, writes a test file or modifies permissions. The library supplies the invocation's working directory and live environment to its services; it does not change global process state.

## Supplying honest runtime evidence

The parent adapter assembles `WorkflowEvidenceSchema`, exported from the package root. The JSON file contains:

- `context`: the exact shared caller context (`runId`, `taskId`, `cwd`, `repositoryRoot`, `baseRef`, `skill`, `attempt`). Use the active worktree and preferably a resolved base commit.
- `callerCapabilities`: capability evidence keyed by `shell`, `network`, `tracker.write`, and the additional keys required above. Each entry is `available` with observed evidence, or `denied`/`unknown` with evidence and a remedy.
- `workers`: one entry per required role, containing its discovered neutral `registration` metadata and a `runtime` snapshot from the shared orchestration contract. The snapshot must name that agent and repeat the exact caller context; permissions describe effective worker access, not just declared capabilities.

Read the installed registration/canonical registry and effective host policy; do not invent a registration, change its capabilities or fill missing permissions with `available` to pass the check. Reuse the [native bindings](./native-orchestration.md) to discover the actual host tools and limits. If a fact cannot be observed, report `unknown` with its remedy. An adapter may save this diagnostic snapshot outside the repository before running the check; keep credentials and unrelated session data out of it.

For example, an unavailable caller write capability is recorded as:

```json
{
  "state": "unknown",
  "evidence": "The running host does not expose effective tracker-write access for this task",
  "remedy": "Establish scoped tracker-write access through the host setup/approval path and refresh this observation"
}
```

Parsing this document validates structure and scope. It cannot authenticate its author, prove the observation happened or grant permission. Evidence is trusted adapter input, must be current, and must be refreshed after context/configuration/approval changes. The host and remote service still enforce access when an operation runs. A passing preflight is a readiness observation, not a promise that all future writes will succeed.

## Interpret failures precisely

`AUTHENTICATION` means credentials/login failed; `MISSING_TOOL` identifies an absent executable. `NETWORK` covers observed DNS/connectivity/service failures, including connection refusal. It does not identify a sandbox. `PERMISSION_DENIED` records a known operation/account-policy denial; `CAPABILITY_DENIED` records an explicit host observation. `CAPABILITY_UNKNOWN`, `LIMITS_UNKNOWN` and `UNKNOWN` preserve gaps in evidence. `TIMEOUT` is a bounded probe that did not finish. Dispatch and context failures retain their shared contract codes.

Diagnostics redact known credential environment values, authorization headers, URL credentials and common token parameters. Never deliberately put secrets in context/evidence just because output is redacted. Malformed/unreadable runtime files return a failed `runtime` check without echoing their contents.

Use a host-specific remedy only when the installed host and actual denial are established. Client help was checked locally for Codex 0.162.1 and Claude Code 2.1.296 on 2026-10-13:

- **Codex:** inspect effective working root and sandbox/approval policy. Its help exposes `--cd`, `--sandbox`, `--add-dir` and `--ask-for-approval`. If an authorized workflow specifically needs workspace writes that a read-only session denies, use the normal approval path or ask the user to start an appropriately scoped session. Add only the required evidence directory when that is the missing writable scope. Do not disable sandboxing or approvals wholesale.
- **Claude Code:** inspect effective permission rules and working directories. Its help exposes `--permission-mode`, `--allowedTools`, `--disallowedTools` and `--add-dir`. Resolve a demonstrated tool/path denial with a scoped rule or approval. In unattended execution, return a named failure instead of turning on permission prompts or bypass mode.

The check itself never launches either host with new flags or edits its configuration. Recheck current client help when the installed version differs. Native configuration and invocation guidance is documented by [OpenAI](https://learn.chatgpt.com/docs/config-file/config-reference) and [Anthropic](https://code.claude.com/docs/en/sub-agents); these references do not substitute for observing the running session.

Unattended reproduction and verification remain unattended: return every `needs`/`openQuestions` item and the failed capability without prompting. A caller that explicitly opted into human questions can use the shared question policy, wait for an actual answer, refresh evidence and rerun the gate. Existing applicable user authorization remains valid; the gate is not an extra blanket approval requirement.
