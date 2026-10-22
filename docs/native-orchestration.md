# Native orchestration bindings

Native skills use the running harness for permissions, worker scheduling and dispatch. Read [orchestration-interface](./orchestration-interface.md) for task identity, role reports and retry rules. Its runtime snapshot and policy APIs serve programmatic adapters; native parents do not need a permission manifest or a second scheduler.

## Session directory and task directory

The session may start in a parent directory such as `~/Developer` and work in repositories beneath it. For each task, use the selected repository or worktree as `repositoryRoot` and a working directory inside it as `cwd`; these identify the task, not the session’s launch directory.

Run repository-specific commands in that target directory using the tool’s working-directory option or `cd <repo> && <command>`. Set the directory for each call instead of assuming a prior shell call persists it. The parent’s preflight, tracker, Git and PR commands need the target directory too; changing only a worker’s directory does not redirect the parent’s commands. Include the target path in worker briefs and use it when dispatching. No session restart is needed.

## Binding the shared operations

| Operation | Claude Code parent | Codex parent |
| --- | --- | --- |
| `dispatch` | Select the installed named registration with the native Agent tool | Select the discovered named role through the exposed spawn tool |
| `dispatchMany` | Use separate Agent calls for separate briefs | Use separate spawn calls for separate briefs |
| Collect/release | Wait for the native completion/failure | Wait for completion/failure and close/release the thread when required |
| Sibling skill | Invoke/read the skill in the existing caller session | Invoke/read the skill in the existing caller session |
| `ask` | Available question mechanism, only for an opted-in invocation | Available question mechanism in the current mode, only for an opted-in invocation |

Use the tools and signatures exposed by the running client. Carry the dispatch ID and caller context alongside the returned native handle. Give each worker the complete brief and correct working directory. Validate identity and the role’s report before consuming it. Missing named-agent discovery is `UNKNOWN_AGENT`; missing dispatch is `DISPATCH_UNAVAILABLE`, with no inline replacement.

The native packages contain registrations; installation and host discovery are described in [native installation](./native-installation.md). A model tier or declaration is not a permission grant. Honor known restrictions and report actual host errors without changing global settings.

## Scheduling

Respect the limits the harness exposes and any explicit caller batch bound. Do not require numeric limits, environment-variable inspection or a serialized capacity snapshot to begin native work. When available capacity is not exposed, run one brief at a time and wait for completion before the next launch. The harness remains responsible for enforcing its shared pool and nesting limits.

Preserve one request per research brief, its original order, mode and analysis depth. When running a batch, track the workers you launch and wait for all of them before the next batch. Release completed workers where the host requires it. If dispatch reports capacity exhaustion, wait for an existing worker when its completion can free capacity; otherwise return the failure. Report permission or depth failures with their actual cause and remedy.

Validate every report and restore input order. Partial output is not a completed report. Stop synthesis if any required brief failed or is missing; do not fabricate findings, merge briefs, raise limits or replace delegation inline.

`BoundedDispatchQueue` and `RegistryOrchestrationPolicy` remain available for programmatic consumers that implement their own scheduler. Their runtime snapshots are not a prerequisite for using Claude Code’s Agent tool or Codex’s native spawn tool.

## Questions and independence

`allowHumanQuestions` is an invocation choice, inherited by sibling skills. In unattended reproduction/verification it is always false. Return unresolved `needs`/`openQuestions` instead of asking. In an opted-in invocation, use the current host’s question mechanism and wait for an actual reply before dependent work. Reuse existing applicable decisions and authorizations; a timeout or default selection is not an answer.

The verifier needs a fresh context on every attempt. On Codex’s spawn surface, select the installed `code-verifier` role and use `fork_turns: "none"` when exposed. On Claude, start a new named Agent call instead of resuming an implementer or prior verifier. If the surface cannot provide this separation, return `DISPATCH_UNAVAILABLE`. Give the verifier only the criteria and changed paths, preserving the dispatch options with its brief.

Invoke `execute-work` inside `execute-wave` as a sibling skill in the same caller session. Each ticket has its own run/task identity, active checkout and fixed base. Tickets run sequentially. Implementation attempts 1/2 stay standard; only the third after two verifier FAILs escalates. Retry attempts do not imply concurrent workers or additional nesting.
