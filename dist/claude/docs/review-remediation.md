# Review Remediation

How to turn review findings into verified fixes and replies: triage first, one bounded remediation pass, then publish and respond. The calling skill supplies the findings, the original ticket criteria, the PR and its implement/verify loop; this doc supplies the procedure.

## Caller-specific

Two points are decided by the calling skill, not by this doc:

- **Which findings are in scope.** `execute-work`: its private review's findings plus other reviewers' existing threads on the PR. `remediate-review`: the PR's unresolved, non-outdated, untruncated public threads, with no private review.
- **Whether a summary comment is allowed.** `execute-work`: none. Replies in existing external threads are the only review comments it authorizes. `remediate-review`: exactly one summary comment is allowed.

Everything below applies to whichever findings the caller puts in scope.

## Reading and replying

Read other reviewers' threads with the trusted authors named explicitly:

```bash
flight-rules pr threads <number> --trusted-author <login> --trusted-author <bot-name>[bot]
```

`--trusted-author` is repeatable. `name[bot]` trusts only that bot; a bare `name` trusts only that user. Each returned thread carries its thread id, its source URL and its replies.

Reply in an existing thread with the thread id `pr threads` returned:

```bash
flight-rules pr thread-reply <thread-id> --body-file <path>
```

Each triage outcome maps to one reply:

- `fix` — the verified fix with the commit SHA and the test or verifier evidence.
- `ignore` — an evidence-backed explanation grounded in code, applicable rules or existing evidence.
- `needs_input` — an escalation stating the open question.

## 1. Triage before editing

Dispatch a fresh `code-verifier` with `mode: triage`, the original ordered ticket criteria, head SHA, complete review findings, and any existing feedback from other reviewers (including replies and source URLs). Preserve existing finding IDs; assign private IDs to new findings without IDs using the reviewed SHA and their array index. Keep a private map from each ID to its full finding and source. New private IDs are not GitHub review records.

The verifier reads the code and returns `ReviewTriageReportSchema`: one `fix`, `ignore`, or `needs_input` disposition per supplied finding, with evidence. A `fix` includes a concrete verification criterion; `ignore` requires a reason grounded in code, applicable rules or existing evidence. Unanswered policy decisions and unavailable evidence require `needs_input`; the verifier cannot waive a mandatory requirement or another reviewer's blocking finding. This triage evaluates findings, not the implementer's rationale, and does not count as an implementation attempt or a verifier rejection.

Validate the dispatch receipt and triage schema. Require the same head SHA and exactly the supplied finding IDs, each once, with no omissions or additions. Stop for any `needs_input` or `openQuestions` and return the questions under the invocation's question policy. Do not let a malformed report, missing finding or changed head silently remove work. An `ignore` disposition is private triage, not authority to resolve a public review thread or overwrite a bot's records.

If the caller supplies the requested evidence or decision before remediation starts, preserve the original review and triage receipts, recheck the PR/local head, and dispatch a fresh triage worker with the same findings plus that evidence. Validate the new receipt and complete ID coverage again; never hand-edit a `needs_input` into `fix` or `ignore`. A changed head requires a fresh private review first. This does not consume an implementation attempt or reset an existing remediation budget.

## 2. Run one bounded remediation pass

If triage accepts fixes, start one separate `VerifiedImplementationLoop` run with a new run ID linked to the original run and review snapshot. Preserve the ticket, checkout and base. This follow-up pass is authorized by the calling workflow; it does not reopen or reset the initial implementation history. Its fixed `criteria` list is:

1. Every original acceptance criterion (or Fixed When item), verbatim and in its original order.
2. One criterion per accepted finding, in triage order, formatted `[review:<id>] <criterion>`.

Keep the mapping to the original comments, their resolution conditions and triage evidence in the implementation brief. Pass accepted fixes and the full original ticket to the implementer. Record ignored findings separately; do not turn them into implementation tasks. The verifier receives only the complete ordered criteria and union of changed paths, with a fresh context every time. Each review criterion must contain the relevant behavior, source location and sufficient verification condition so it stands on its own without the implementer's claims.

Use the same implementation/verifier alternation, report schemas, independent evidence requirements and failure handling as the initial implement/verify loop the calling skill defines. When refreshing the ticket contract, compare only its original criteria to the original ticket snapshot; keep the accepted review criteria fixed and appended for dispatch. A successful follow-up returns to publishing below, not to the calling skill's PR-creation path. Attempts 1 and 2 use `code-implementation`; attempt 3 uses `code-implementation-escalated` only after two verifier FAILs. The verifier checks **all original criteria and every accepted review criterion on every attempt**. All must PASS before committing or pushing. Preserve each FAIL verbatim on retry, including failed review criteria. UNVERIFIABLE, open questions, malformed output and unavailable workers stop the pass. Maximum three remediation attempts; never start another automatic pass to evade the cap. If triage accepts no fixes, skip implementation and retain the original verification plus triage evidence.

## 3. Publish verified changes and respond to others

After successful remediation, commit the union of paths changed in this pass and push to the existing PR using the calling skill's commit/push procedure. Do not create another PR or repeat the ticket transition. Reconcile the current PR head before pushing; unexpected commits require a caller decision, not a stale verification claim. Refresh affected visual evidence and PR body details when behavior changed. Preserve the original and remediation receipts and report both attempt counts separately.

When other reviewers have left feedback, reply in their existing threads with `flight-rules pr thread-reply`: the verified fix with commit/test evidence, or an evidence-backed explanation for a disagreement. The implementation report supplies the fix details; the verifier's evidence supports the response. Never claim an unverified fix is complete. Do not publish replies to private findings, a full self-review, a decision summary, or edits to another reviewer's state markers. Never resolve a thread: leave public finding closure to its reviewer; triage alone cannot resolve it. Replies to existing external feedback are the only review comments this procedure authorizes, unless the caller allows more.

If review, triage or remediation stops, retain the existing PR and ticket status and report the incomplete work privately. Leave unverified local edits uncommitted and unpushed. Do not restart the initial loop, invent a successful outcome, or post a self-review explaining the stop.
