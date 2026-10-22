# Shared orchestration interface

An orchestrating skill owns the task, working directory, worker dispatch, human questions and git/tracker mutations. A worker owns its assigned role and returns a structured report. The same contract applies to native parents and programmatic consumers; concrete tools, model bindings and permission enforcement belong to the host adapter.

The package root exports Zod schemas, `RegistryOrchestrationPolicy`, `ValidatedReportHandoff` and `VerifiedImplementationLoop`. These are deterministic in-process services. They do not invoke a model, shell out to the CLI, grant access, schedule workers or ask a human. Programmatic adapters may use these services to implement their own scheduling. Native skills use the running harness directly; they do not need to instantiate these services or reconstruct its permission and capacity state.

## Native skill execution

Use the named agent tools exposed by the running harness. Carry task identity and context into the brief, associate each result with its original request, and validate the role report before consuming it. Preserve the implementation retry rules and verifier independence below.

The harness enforces permissions, concurrency and nesting. Honor restrictions it exposes and handle actual dispatch failures. A missing numeric limit or permission snapshot is not itself a failure. When capacity is not exposed, run separate briefs sequentially. Native callers do not create `RuntimeSnapshot` or `WorkflowEvidence` JSON files and do not call `policy.prepare` as a prerequisite. See [native bindings](./native-orchestration.md).

The snapshot, policy and queue APIs below describe programmatic adapters that own scheduling. Their existing explicit evidence checks remain available to those consumers.

## Caller context and optional SDK runtime evidence

`RunContext` carries `runId`, `taskId`, `cwd`, `repositoryRoot`, `baseRef` and the originating `skill`. `CallerContext` adds the implementation `attempt`, starting at one. Use a unique run ID per execution. `repositoryRoot` identifies the active checkout, including a linked worktree; `cwd` must be an absolute path lexically inside it. `baseRef` is the caller's fixed comparison base (prefer a resolved commit). These fields identify a run; path validation does not resolve symlinks or establish filesystem access.

Carry the exact context through dispatch and outcome. Do not reset the attempt on sibling-skill invocation, substitute the main checkout, change the base, or reuse a report from another task. Host-native identifiers may be recorded separately by the adapter; they do not replace the shared dispatch identity.

When using `RegistryOrchestrationPolicy`, a programmatic adapter supplies a `RuntimeSnapshot` scoped to the exact context and selected agent:

| Field | Meaning |
| --- | --- |
| `host`, `observedAt` | Host/version and observation timestamp; provenance, not a freshness guarantee |
| `agent` | Worker whose effective permissions were observed; nullable for caller-only question checks |
| `spawn` | The caller's ability to create the requested worker |
| `ask` | The caller's ability to ask and wait for a human |
| `permissions` | Effective worker access by capability, including workflow-specific keys such as `git.push` when required |
| `limits` | Observed concurrency, current usage, caller depth and maximum child depth, with a `source` |

Each capability is `available` with evidence, or `denied`/`unknown` with evidence and a remedy. A registration's declared capability is a requirement, not evidence that access exists. A successful network read does not prove write permission. Evidence must reflect the worker's effective host configuration, including parent overrides, repository scope and current approvals. Never place credentials or tokens in evidence.

Snapshots are trusted adapter observations, not signed attestations. The library checks shape and scope; it cannot prove that a tool ran, detect an unreported permission change or enforce the host sandbox. Refresh evidence before each dispatch and after context, configuration or approval changes. Do not reuse a timestamp as permission to skip that check. The host must enforce actual access at execution time and return denial/failure if it changes.

`maxConcurrent` counts the host's worker pool, and `activeWorkers` includes workers outside this batch. `currentDepth` is the caller's nesting depth (root is zero); a child needs `currentDepth + 1 <= maxDepth`. Unknown bounds are `null`; zero disables capacity. A documented conservative adapter bound may be used with its provenance, but never invent a host default or change global settings to make the work fit. Retry attempt, concurrent workers and nesting depth are separate quantities.

## SDK dispatch and structured outcomes

`dispatch(request)` means:

1. Load the canonical registry and select `request.agent` by name. Include the complete task brief in `input`; use `requiredCapabilities` for additional workflow requirements. No per-call model override is accepted.
2. Observe runtime evidence and call `policy.prepare(request, snapshot)`. It requires parent dispatch, remaining depth/capacity and every declared or additionally required worker capability.
3. If `ready`, bind the returned registration and input to the host's native tool. If `unavailable`, return its named failure before dispatch or mutation. Do not substitute inline work or widen permissions.
4. Return an envelope with the original `dispatchId`, `agent` and `context`. `completed` carries the role's parsed `report`; `failed` or `unavailable` carries `failure: { code, message, remedy, capability? }`.
5. Pass the envelope to `ValidatedReportHandoff.accept(request, outcome, roleSchema)` before consuming it. The service rejects mismatched identity/context and malformed reports. Preserve role-specific keys and evidence; never infer a missing successful report from prose or tool exit status.

The adapter extracts/parses the worker's declared report format (currently fenced YAML) and supplies the resulting JSON object. A completed execution does not mean its verdict passed. Execution failure is not a verifier FAIL. Malformed caller configuration throws a Zod validation error at the policy boundary; runtime unavailability and invalid incoming handoffs return named outcomes.

```typescript
import { FileAgentRegistry, RegistryOrchestrationPolicy, ValidatedReportHandoff } from '@good-ground-collective/flight-rules'

const policy = new RegistryOrchestrationPolicy({ agents: new FileAgentRegistry().load(agentDirectory) })
const decision = policy.prepare(request, observedRuntime)
if (decision.status === 'ready') {
  // The consumer supplies nativeDispatch and the role's report schema.
  const outcome = await nativeDispatch(decision.request, decision.definition)
  const result = new ValidatedReportHandoff().accept(decision.request, outcome, roleSchema)
  // Consume only accepted outcomes; inspect their status before reading report.
}
```

Explicit registration `sandbox` or `dispatch` restrictions currently return `UNSUPPORTED_AGENT_SETTINGS`: this policy cannot attest to an enforcing binding for them. Do not drop restrictions to make dispatch succeed. Current canonical workers do not declare them or require worker-owned `spawn`/`ask`.

## SDK bounded dispatchMany

`dispatchMany(requests, { maxConcurrent })` retains every separate brief and original order while running at most the smaller of the caller's positive bound and available host capacity. It is a scheduling contract, not an invitation to issue all tool calls at once.

Before each launch, refresh usage and check that request with `prepare`. Reserve its slot before another local launch; account for launches not yet visible in host usage without double-counting them once visible. The adapter must serialize admission or use the host's atomic capacity mechanism when multiple orchestrators share a pool. Hold each reservation until completion/cancellation is acknowledged. Never rely solely on a stale initial snapshot.

At one available slot, run separate requests sequentially. At zero capacity, wait only when a known in-flight worker can finish; otherwise return `CAPACITY_EXHAUSTED` with an actionable remedy. Unknown bounds produce `LIMITS_UNKNOWN`. A depth or permission failure stops that request before dispatch. A worker failure remains attached to its original request; return one terminal envelope per request, preserving input order even when completion order differs. Caller cancellation must also produce terminal outcomes for queued work and reconcile running workers before freeing their slots. Do not turn failed dispatches into fabricated reports, merge separate briefs or silently fall back to inline execution.

The wave workflow remains sequential: bounded fan-out inside an eligible step does not parallelize dependent tickets or waves. Skill integration supplies the scheduling implementation and host tool bindings.

`BoundedDispatchQueue({ agents, requests, maxConcurrent })` supplies deterministic admission for this contract. `pending()` identifies the next request whose runtime must be observed. `admit(snapshot, observedDispatchIds)` synchronously reserves a slot before returning `ready`; pass the IDs of this queue's active reservations already included in the snapshot's worker count. Omitted IDs count conservatively as additional reservations. Duplicate, unknown or impossible observation IDs are invalid input. A `waiting` decision seals the batch; any completion also seals it until every remaining reservation is reconciled. Refresh the snapshot before admitting another request.

After the native worker finishes **and releases its occupied host slot**, call `settle(dispatchId, outcome, roleSchema)`. Some hosts count open threads after execution ends, so closing/releasing the host handle is part of that acknowledgement. A malformed or foreign handoff retains its reservation: reconcile the actual worker and submit a valid failure envelope if no valid report can be obtained. `results()` returns terminal outcomes in original input order only when all requests settle. `cancel()` marks queued work cancelled, while running reservations remain until the adapter acknowledges completion/cancellation and capacity release. The queue never cancels host processes itself or coordinates independent queue instances; the adapter owns serialization across a shared host pool.

## Sibling skills and human questions

`policy.sibling({ context, skill, input })` validates a sibling-skill invocation. `skill` selects the target; `context.skill` continues to identify the originating caller. Run the sibling's instructions in the same caller context. This does not consume worker nesting depth or grant new capabilities. Workers dispatched by that sibling remain subject to the host's limits. Do not launch an extra agent merely to invoke a skill.

`policy.ask({ context, question, allowHumanQuestions }, snapshot)` requires explicit invocation opt-in and available caller question support. Its successful decision is `awaiting-answer`, never a fabricated answer. The adapter asks through the actual host mechanism and waits for a real reply before dependent work. A timeout, default option, elapsed time or capability observation is not an answer or approval. Return cancellation/failure when the host cannot wait; do not resume dependent work.

Unattended invocations set `allowHumanQuestions: false`. They receive `QUESTIONS_DISABLED` and return the unresolved question to their caller. Unsupported host questions produce `QUESTIONS_UNAVAILABLE`. Questions in worker reports remain `openQuestions`; the parent owns any allowed human interaction. An answer does not itself widen tool permissions: refresh the applicable evidence and preserve separate authorization requirements.

## Implementation and independent verification

`VerifiedImplementationLoop.next(run)` derives the next action from the original context, ordered acceptance criteria, full `implementationInput` brief and paired implementation/verification receipts in `history`. Call `verify(run, implementationReceipt)` after each implementation to obtain the verifier request. Persist both original requests and outcomes unchanged; feed the new pair back to `next`. Programmatic adapters using the policy pass each returned dispatch through `policy.prepare`; native callers use the harness’s dispatch tools.

| Verified history | Next action |
| --- | --- |
| No completed pair | `code-implementation`, attempt 1 |
| One pair with FAIL and no UNVERIFIABLE/questions | `code-implementation`, attempt 2 |
| Two such pairs | `code-implementation-escalated`, attempt 3 |
| All criteria PASS, no questions | `verified` |
| Any UNVERIFIABLE or unresolved question | Stop and return the evidence/question to the caller |
| Third verifier FAIL | `ATTEMPTS_EXHAUSTED`; no fourth attempt |
| Invalid, mismatched, failed or unavailable handoff | Stop; it does not count as a verifier rejection |

The loop uses the existing implementation and verifier report shapes. Verifier receipts must quote every original criterion exactly once, in its original order; instruct the verifier to quote instead of paraphrasing. The `verified` flag must agree with itemized verdicts. A run's criteria and original implementation brief remain fixed; resolving ambiguity or changing requirements starts a distinct run with a new ID and an explicit caller decision, never an automatic retry reset.

The verifier always uses `code-verifier`. Its input contains only the original criteria and the union of changed paths from this and prior attempts (`filesChanged: [{ path }]`). It never receives the implementer's summary, rationale, claimed test results or change descriptions. The verifier discovers evidence itself. On retry, only the previous verifier's FAIL items are added to the full implementation brief as `verifierFailures`, preserving text and evidence verbatim. That input key is reserved for validated history.

These receipts bind decisions to supplied history; they do not cryptographically prove execution or prevent a caller from inventing a new run. The adapter must retain authentic receipts and enforce stopped-run decisions. Schema validity alone is not completion evidence.

## Private review remediation in execute-work

After the initial verified PR is opened, `execute-work` invokes autonomous review in action mode and retains its output privately. No review poster runs for this result. The caller validates the full review and current head before dispatching `code-verifier` with `mode: triage`, original criteria, reviewed head and complete findings with stable IDs/source locations. Validate the receipt with `ReviewTriageReportSchema`, then check that the head matches and every supplied ID appears exactly once with no extra IDs. The codec validates shape; the caller owns this snapshot/coverage check.

Triage returns `fix` with a verification criterion, `ignore` with evidence, or `needs_input` with a question also in `openQuestions`. Any question stops remediation under the normal invocation question policy. Triage is read-only, does not count as a verifier FAIL, and cannot close another reviewer's findings. Before remediation starts, caller-supplied answers go to a fresh triage dispatch at the same head with the same complete finding set; retain both receipts and validate the new result instead of overriding the old disposition. A changed head needs a fresh review; answering a question does not reset any spent implementation attempts.

For accepted fixes, the caller creates one linked follow-up run with a new run ID and empty history. Its immutable criteria are the original ordered ticket criteria followed by `[review:<id>] <criterion>` for every accepted fix in triage order. The implementation brief carries the full ticket and accepted findings, source references, resolution conditions and triage evidence. `VerifiedImplementationLoop` then runs unchanged: criteria/path-only independent verification, standard attempts 1/2, escalated attempt 3 after two FAILs, and all criteria PASS before publication. Its `verifierFailures` remain derived solely from paired receipts, not from triage. The original completed run stays immutable; no fourth attempt or further automatic remediation run is allowed.

Native parents follow the same protocol. Remediation verification receives the original and accepted review criteria, never the implementation claims or triage verdicts. Keep the original acceptance criteria distinct in the caller's mapping; do not edit the ticket's contract. Only verified changes are pushed to the existing PR. Replies to external reviewers may cite those changes and verification evidence, but private findings, summaries, state markers and outcomes are never posted. Unresolved work returns to the caller with the PR unchanged by unverified edits.

## Failure handling

Every policy failure names a cause and remedy. The adapter may add host-specific instructions using verified configuration, but cannot convert a failure into permission.

| Codes | Caller action |
| --- | --- |
| `UNKNOWN_AGENT`, `UNSUPPORTED_AGENT_SETTINGS` | Install the named registration or supply an enforcing supported binding |
| `CONTEXT_MISMATCH`, `INVALID_HANDOFF`, `INVALID_HISTORY`, `INVALID_REPORT` | Reconcile original context/receipts or obtain a valid role report; never guess success |
| `DISPATCH_UNAVAILABLE`, `LIMITS_UNKNOWN`, `CAPACITY_EXHAUSTED`, `DEPTH_EXCEEDED` | Establish supported dispatch capacity; wait only where completion can release a slot |
| `CAPABILITY_UNKNOWN`, `CAPABILITY_DENIED` | Establish effective required access through the host's normal setup/approval path |
| `QUESTIONS_DISABLED`, `QUESTIONS_UNAVAILABLE`, `OPEN_QUESTIONS`, `UNVERIFIABLE` | Return the unresolved input/evidence gap; ask only through an opted-in supported caller |
| `ATTEMPTS_EXHAUSTED` | Return remaining FAIL items for a caller decision |
| `EXECUTION_FAILED`, `CANCELLED` | Preserve the host failure/cancellation; reconcile execution before any deliberate new dispatch |

Read-only environment probes run before the workflow’s first mutation. They report configuration and access observations, not authorization for git/tracker actions. Native harness enforcement remains authoritative when operations execute.
