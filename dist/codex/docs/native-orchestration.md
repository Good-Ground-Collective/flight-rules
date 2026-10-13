# Native orchestration bindings

Read this with [orchestration-interface](./orchestration-interface.md). Shared skills use registry names and structured outcomes; the native parent binds those operations to its actual tools. A plugin manifest, model tier or capability declaration does not prove that dispatch or a permission is available.

## Binding the shared operations

| Operation | Claude Code parent | Codex parent |
| --- | --- | --- |
| `dispatch` | Select the installed named registration with the native Agent tool | Select the discovered named role through the exposed spawn tool |
| `dispatchMany` | Admit separate Agent calls in bounded batches | Admit separate spawn calls in bounded batches |
| Collect/release | Wait for the actual completion/failure and reconcile the host's occupied slot | Wait for the actual completion/failure and close/release the thread if it still occupies a slot |
| Sibling skill | Invoke/read the skill in the existing caller session | Invoke/read the skill in the existing caller session |
| `ask` | Available question mechanism, only for an opted-in invocation | Available question mechanism in the current mode, only for an opted-in invocation |

Use the tool names and signatures exposed by the running client; do not assume another surface's API. Carry the shared dispatch ID and caller context alongside the returned native handle. Workers receive the complete task brief in their actual working directory. Retain structured receipts for their own report format, and validate the context before consuming them. Missing named-agent discovery is `UNKNOWN_AGENT`; missing dispatch is `DISPATCH_UNAVAILABLE`, with no inline substitute.

The native packages contain registrations. They do not establish runtime permissions or automatically install Codex project agent files. Native placement/setup and installed workflow proof remain separate from these bindings.

## Observe limits without changing them

Record the installed client version, the effective limit source, current depth and current occupied slots, including workers outside this batch. Observe effective values after configuration precedence and parent overrides; reading one file is not enough when another layer can override it. Keep secrets out of the snapshot.

For Codex, current documentation names `agents.max_concurrent_threads_per_session`, counting open spawned threads excluding the primary, and retains `agents.max_threads` as a legacy alias. An unset value is client-selected. Use the installed client's effective configuration and exposed worker lifecycle; never copy an example number as a runtime observation. The current reference does not establish a portable depth setting, so do not invent `agents.max_depth` support. These names were checked against the [subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) on 2026-10-13.

For Claude Code, current documentation identifies `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`. They describe different bounds, and other kinds of agent runs may use different pools. Read the effective environment and actual running tasks; a foreground/background choice is not a capacity observation. See the [subagent limits documentation](https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit), checked on 2026-10-13. Do not set these variables as a side effect of a workflow.

Installed-client inspection for this change used Codex 0.162.1 and Claude Code 2.1.296. Version checks and protocol/configuration inspection are read-only evidence about these installations; they are not live dispatch or enforcement proof. Recheck host support when the installed version or surface differs.

If the host does not expose a numeric bound, an adapter may declare a smaller explicit policy bound with its provenance. For example, a confirmed top-level caller with available single-child dispatch can choose one outstanding worker and one child layer as its adapter policy. That is a conservative adapter choice, not a claimed host default. It is usable only when current shared-pool occupancy and the required child dispatch are established. Unknown occupancy, unestablished child support or a nested caller whose depth cannot be determined remains `LIMITS_UNKNOWN`/`DISPATCH_UNAVAILABLE`; do not fill missing facts with that example.

## Batch execution

1. Preserve one request per research brief, its original order, mode and analysis depth. The registered research tier remains escalated.
2. Check effective access for the selected worker and refresh capacity before every launch. Reserve the slot immediately; count reservations not yet reflected in host usage. Coordinate admission when more than one scheduler shares the pool.
3. Stop admission at the smaller caller/host bound. One available slot runs one brief at a time. Wait for the whole admitted batch to complete and release occupied slots before the next batch.
4. Validate reports and restore input order. On a host error, retain the original dispatch identity in a failed/unavailable outcome. Partial output is not a completed report. Reconcile the actual worker before releasing a reservation; an expired wait does not prove it stopped.
5. Stop synthesis if any required brief failed or is missing. Return the named cause/remedy, without combining briefs, fabricating findings, raising caps or replacing delegation inline.

`BoundedDispatchQueue` implements admission, reservations, cancellation bookkeeping and ordered results for programmatic consumers. Native parents perform the same bounded steps with their tool surface. The queue and its tests do not prove a model will follow these instructions; installed-host workflow execution supplies that separate evidence.

## Questions and independence

`allowHumanQuestions` is an invocation choice, inherited by sibling skills. It must be true before the caller uses a supported question tool or publishes a decision prompt. In unattended reproduction/verification it is always false. Return unresolved `needs`/`openQuestions` instead of asking. A tool unavailable in the current mode is unavailable even if another mode or product supports questions.

An actual reply is required before dependent work. Reuse the user's existing applicable decisions and authorizations; neither a timeout nor a default selection provides a new one. A human reply does not grant tool access by itself.

Invoke `execute-work` inside `execute-wave` as a sibling skill in the same caller session. Each ticket receives its own caller-created run/task identity; the checkout, base and actual caller depth remain explicit. Tickets run sequentially. Inside each ticket, implementation attempts 1/2 stay standard, only the third after two verifier FAILs escalates, and the verifier always receives only criteria and changed paths. Attempts never stand in for worker slots or nesting levels.
