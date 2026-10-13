# Code review findings contract (draft v1)

**Status:** v1 design agreed for implementation on 2026-10-12. This is the consolidated consumer contract; the local discussion draft retains review history.

**Contract version:** 1. **Schema revision:** 1.

**Purpose:** Each review pass should move a PR toward approval. Every finding says what kind of work closes it, who can do that work, and how the next pass will know it is done. The local skill and the GitHub action both produce and consume the same findings. A PR can then move between them, or between review rounds, without losing state.

## 1. Scope and ownership

| Party                 | Role                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reviewer**          | Reads the PR, the earlier findings, the replies and the new commits. Returns one review object (§7). The reviewer itself never writes to GitHub.                                                                                                                             |
| **Poster**            | Turns the review object into GitHub artifacts: inline threads, a summary comment, labels, and approve or dismiss. It validates evidence references, enforces authority and lifecycle rules, and computes the outcome (§5, §6). The local skill and the action each have one. |
| **Remediation agent** | Works through open findings: tlp-actions `claude-comment-addressing`, or flight-rules `execute-work` remediation. It follows §8.                                                                                                                                             |

- **flight-rules owns the canonical schema** (§7) and this document. The action consumes a pinned version.
- **Consumers may add extension fields** under their own key (§7.3). They never redefine core fields.
- **The complexity grade is action policy, not contract.** tlp-actions owns the risk rubric, the complexity labels, the approval gate and the Tier 1 safety net, under `extensions.github_action`. flight-rules owns finding quality. Findings determine the core outcome; the grade may further restrict approval through a separately reported consumer gate (§7.3).

### 1.1 Composition: how the action uses the skill

**One reviewer run, two sources of instruction.**

- **The skill supplies the method.** In action mode it returns the §7 review object and never posts. The method covers the charter, the Tier A, Tier B and holistic passes, and the rules for writing findings.
- **The action supplies everything around the run.** That means gathering context and earlier findings (§5.1), its own rubric for the grade (`extensions.github_action`), and the poster.
- **One session follows both and returns one review object.**
- **The reviewer assesses meaning; the poster enforces the contract.** The reviewer judges whether code or an answer meets a finding's resolution criteria. The poster validates the references supporting that judgment, normalizes findings (§3.2), places them (§4.4), removes duplicates, enforces authority (§5.3) and computes the outcome (§6). A qualifying person's reply is not sufficient unless it actually answers the decision.

Rejected for v1: two independent passes (the skill and the action's own review) whose findings get merged. The cost:

- **Duplicates.** Two reviewers word and anchor the same issue differently, so duplicate detection across them is unreliable.
- **Conflicts.** The two reviewers disagree on blocking status or type, and a rule has to break the tie.
- **Model cost.** Every push pays for two runs.

Possible later: a **verification pass** in comprehensive mode. A second, cheaper pass checks each finding against the code and drops the incorrect ones before posting. It is a filter, not a second reviewer.

## 2. Finding types

A finding's **type** says what moves it forward. Type is independent of the Conventional Comments label, of severity, and of blocking status.

| Type      | Closed by                                                       | Who can close it                                                       | Must carry                                                                                                   |
| --------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fix`     | A verified change to code, configuration or documentation       | Coding agent or author                                                 | The change to make, where, and the verification (a test, a command, an observable result)                    |
| `clarify` | Sufficient evidence or context                                  | Author, or an agent citing code or docs                                | The exact question, what answer or evidence resolves it, and the change to make if the answer is "no"        |
| `decide`  | An authorized human decision, plus any resulting implementation | A human with authority (§5.3), then a coding agent or author if needed | Named decision options, the trade-off, the reviewer's recommendation, and what to implement for each outcome |

Informational labels (`praise`, `note`, `thought`) carry **no type** and have `blocking: false`. They appear only in the summary, with no open thread or resolution task (§4.4). They are a distinct schema variant, not actionable findings with their required fields silently removed (§3.2).

Examples of independence:

- A naming improvement is a non-blocking `fix` with the label `suggestion`.
- An uncertain authorization change is a blocking `clarify` with the label `question`.
- A permission expansion that is clearly intentional, but needs policy sign-off, is a blocking `decide` with the label `question`.

## 3. The finding object

| Field                | Type                                          | Required                                    | Meaning                                                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | string                                        | stored records only                         | Stable across passes: `f-` plus 10 hex characters, assigned by the poster when a new record is created. New reviewer findings omit it. The poster checks uniqueness within the repository and PR and never reuses an ID. The reviewer copies it from context for prior findings. |
| `path`               | string                                        | yes                                         | Repository-relative path. Empty string for a PR-wide finding.                                                                                                                                                                                                                    |
| `line`               | integer ≥ 0                                   | yes                                         | Line in the PR's version of the file, inside a diff hunk. `0` means no anchor.                                                                                                                                                                                                   |
| `start_line`         | integer ≥ 0                                   | no                                          | First line of a range, in the same hunk as `line`.                                                                                                                                                                                                                               |
| `label`              | enum                                          | yes                                         | Conventional Comments label: `issue`, `todo`, `suggestion`, `question`, `chore`, `nitpick`, `typo`, `polish`, `thought`, `note`, `praise`.                                                                                                                                       |
| `type`               | `fix` \| `clarify` \| `decide`                | yes, except for `praise`, `note`, `thought` | §2.                                                                                                                                                                                                                                                                              |
| `blocking`           | boolean                                       | yes                                         | The PR should not merge while this is open.                                                                                                                                                                                                                                      |
| `severity`           | `critical` \| `major` \| `minor` \| `trivial` | actionable findings only                    | `critical` and `major` force `blocking: true`. Forbidden on informational findings.                                                                                                                                                                                              |
| `category`           | enum                                          | no                                          | `security`, `correctness`, `data`, `deployment`, `design`, `testing`, `performance`, `readability`, `docs`.                                                                                                                                                                      |
| `subject`            | string                                        | yes                                         | One line that states the problem, not the topic.                                                                                                                                                                                                                                 |
| `discussion`         | string                                        | yes                                         | One to three sentences for a human: what is wrong and what it causes.                                                                                                                                                                                                            |
| `details`            | string                                        | actionable findings only                    | The brief for the agent or person who acts. Its content depends on the type (§3.1). Optional supporting context on informational findings.                                                                                                                                       |
| `resolved_when`      | string                                        | yes, except for informational labels        | One sentence a later pass can check: "…when the query is tenant-scoped and the cross-tenant test passes."                                                                                                                                                                        |
| `decision_owner`     | string                                        | `decide` only                               | Who must decide: a role ("the access-policy owner"), a team, or a CODEOWNERS path. This description is resolved through the trusted authority policy (§5.3); it does not grant authority by itself.                                                                              |
| `decision_options`   | array of `{ id, description }`                | `decide` only                               | At least two options, with distinct IDs such as `approve-expansion` and `keep-read-only`. A recorded answer selects one of these options (§5.3).                                                                                                                                 |
| `related_finding_id` | string                                        | no                                          | Earlier finding this one follows or regresses. A structured reference, in addition to the explanation in `details`.                                                                                                                                                              |

### 3.1 What `details` must contain

- **`fix`:** the files and lines, the change to make (with code when it is short), and how to verify it. Name a test to add or change when a behavior change warrants one; a documentation or configuration fix may have a command or observable result instead.
- **`clarify`:** the question, where the answer probably lives (a doc, an upstream service, a config), and the fallback change if the answer does not resolve the concern.
- **`decide`:** the options, the trade-off, the reviewer's recommendation with its reason, and what to implement for each outcome. End with "A coding agent can implement the decision; it cannot supply the authorization."

### 3.2 Normalization (the poster enforces it)

- First validate the finding variant. An actionable finding requires `type`, `severity`, `details` and `resolved_when`. An informational finding requires `blocking: false` and forbids `type`, `severity`, `resolved_when`, `decision_owner` and `decision_options`. Invalid combinations are rejected, not silently converted into harmless observations.
- For actionable findings, `severity` of `critical` or `major` sets `blocking: true`.
- Then normalize the label: `nitpick`, `typo` and `polish` are never blocking. A finding with one of these labels that is blocking after severity normalization is relabelled `issue`.
- `decision_owner` and `decision_options` are required for `decide` and forbidden for other types. Removing a decision requirement from a prior finding must follow §5.3, including when changing type, severity or blocking status.

## 4. Rendering

### 4.1 Headline

```
**<label> (<blocking|non-blocking>, <type>[, <category>]):** <subject>
```

- The blocking decoration appears on every label except the informational ones and `nitpick`, `typo` and `polish`, which are implicitly non-blocking.
- The type decoration appears whenever there is a type.

### 4.2 Body

```markdown
**issue (blocking, fix, data):** Scope this query to the current tenant

This query can return another tenant's records because it filters only by incident ID.

<details>
<summary>Details For LLM</summary>

In `src/incidents/incident-repository.ts:42`, add `tenantId` to the lookup predicate, using the tenant from the request context. Add a regression test that fetches an incident from another tenant and expects no result.

**Resolved when:** the query is tenant-scoped and the cross-tenant test passes.

</details>

<!-- code-review:finding {"v":1,"schema_revision":1,"finding":{"id":"f-3a9c0e1b7d","path":"src/incidents/incident-repository.ts","line":42,"label":"issue","type":"fix","blocking":true,"severity":"major","category":"data","subject":"Scope this query to the current tenant","discussion":"This query can return another tenant's records because it filters only by incident ID.","details":"In `src/incidents/incident-repository.ts:42`, add `tenantId` to the lookup predicate, using the tenant from the request context. Add a regression test that fetches an incident from another tenant and expects no result.","resolved_when":"The query is tenant-scoped and the cross-tenant test passes."},"status":"open","evidence":[]} -->
```

A `decide` finding adds `**Decision owner:** <decision_owner>` above **Resolved when**.

### 4.3 Marker

- Every actionable finding ends with `<!-- code-review:finding {json} -->`, including each finding rendered inside a review body. The JSON holds `v`, `schema_revision`, the full current `finding` object, its stored `status` (`open`, `resolved` or `withdrawn`), structured `evidence` (§5.2), and any recorded `decision` (§5.3). The example above is illustrative; the poster serializes the same complete text fields it renders, without shortening them.
- The marker carries the complete actionable brief and resolution criteria so another consumer can reconstruct the record without parsing prose. Readers validate it against the declared schema and accept it only on artifacts authored by a trusted reviewer/poster identity. A copied marker in a PR description or an unrelated reply cannot create or close a finding.
- Escape `>` inside marker JSON as the literal JSON escape `\u003e`, preventing embedded `-->` from terminating the HTML comment.
- The summary state marker (§6.1) indexes every record by ID and GitHub artifact location. A record in a review body uses that review's ID plus the finding ID to locate its marker. Consumers must not parse headlines or use subject text as identity.
- If a referenced artifact is missing, malformed or unsupported, retain the last known open state and report incomplete state recovery. Never infer that a missing finding was resolved.

### 4.4 Placement

- A finding anchors inline when its `line` is in a diff hunk.
- Otherwise it becomes a file-level comment, when the file is in the diff.
- Otherwise it goes in the review body with its own ID, full record marker and index entry. It participates in the same lifecycle and outcome calculation as an inline finding.
- A fingerprint (`path|label|subject`) may help detect duplicates. It is not the record's identity, and changed wording or a moved line must not reset a finding's state.
- Informational findings appear only in the summary. The poster assigns IDs to retained informational records for deduplication, but creates no review thread and gives them no open lifecycle state. The summary state retains their structured objects so another consumer can recognize them.

## 5. Pass-to-pass rules

### 5.1 What the reviewer receives

For every open actionable finding, regardless of inline, file-level or body placement, the reviewer receives:

- the full stored finding, current status, evidence, recorded decisions and artifact references; the original comment and any transition history;
- every reply, including discussion of body findings, each tagged with its comment ID, URL, author's stable GitHub ID and login, whether the author is a **human or a bot**, and whether that human holds **decision authority** (§5.3), with the basis for that authority;
- any manual GitHub thread resolution since the last pass; this is an observation to reconcile, not an automatic lifecycle transition;
- the commits since the last reviewed SHA, or a note that history was rewritten.

The reviewer also receives the reviewed head SHA and enough resolved/withdrawn history to identify regressions. The poster checks that the PR still has that head before applying transitions or submitting an approval. If the head changed, discard the stale pass and review the new head.

### 5.2 What the reviewer returns

The reviewer returns one `prior_findings` entry per open finding:

| Status       | Meaning                                                                               | Required                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `resolved`   | `resolved_when` is met at this head and no required follow-up implementation remains. | `reason` and structured `evidence`: what met it (code, verification, a reply or a decision).                                      |
| `still_open` | Not met.                                                                              | `reason`. A `reply` only when something new needs saying; never repeat a point already made in the thread.                        |
| `withdrawn`  | The finding was wrong or is no longer applicable.                                     | `reason`, structured `evidence` and `withdrawal_basis` (`incorrect`, `no_longer_applicable` or `dismissed`), posted as the reply. |

- **Evidence references.** `evidence` is an array of typed references: `{ kind: "github_comment", comment_id, url }`; `{ kind: "code", commit_sha, path, line }`; `{ kind: "commit", sha }`; `{ kind: "check_run", check_run_id, commit_sha }`; or `{ kind: "document", url }`. A manual optional dismissal uses `{ kind: "thread_resolution", thread_id, author_id }` and the GitHub thread's human `resolvedBy` identity. A consumer with a trusted executor may accept local verification using `{ kind: "verification", commit_sha, command, result, report_url }`, pointing to a report from a trusted executor. The poster validates referenced identities, artifacts and commit/check associations where applicable; the reviewer evaluates their relevance and whether they satisfy `resolved_when`. An author's claim that tests passed is not a verified test result. The GitHub adapter rejects local `verification` unless a trusted executor adapter is explicitly supplied. For `document`, the poster validates HTTPS URL syntax; the reviewer must actually read and judge the cited content. An unread or unavailable link cannot resolve a finding. If required evidence cannot be validated, retain the open finding and report the limitation.
- **Missing entries stay open.** The poster rejects unknown or repeated IDs in `prior_findings`. An omitted prior finding remains open. Omissions prevent claiming a complete review of the prior findings; they never clear a blocker.
- **Replacement updates.** A `still_open` entry may carry `updated_finding`: the full replacement actionable finding with the same ID. A `clarify` whose answer shows a change is needed becomes a `fix` with new `details` and `resolved_when`, not just a new headline. The poster validates the replacement, edits the rendered comment and marker in place, and posts `reason` explaining the transition. It records the preceding version and evidence in a transition reply/marker so history remains recoverable. The same mechanism updates scope or resolution criteria without changing identity. Authority checks apply to the stored finding before any replacement is accepted (§5.3).
- **No duplicates.** The reviewer never posts a new finding that an open finding already covers.
- **Regressions.** A resolved finding is not raised again unless the code regressed. Then the reviewer posts a new finding with `related_finding_id` and `details` explaining the regression.
- **Apply conservatively.** Assign each new ID once and persist it with the full record in its first GitHub artifact, then update the summary index. Before retrying a create, reconcile already published record markers, including artifacts not yet indexed by a partially failed pass. Persist accepted transitions before any approval. A failed write or partial post retains the last confirmed record and blocks approval until reconciled. Compute the outcome from accepted, persisted transitions, not merely the reviewer's proposed transitions.

### 5.3 Decision authority

A decision answer records `{ comment_id, author_id, option_id }`, with the comment also referenced in `evidence`. `option_id` names one of the finding's `decision_options`. The reviewer judges whether the cited comment explicitly selects that option or unambiguously answers the decision. The poster verifies the comment belongs to this PR, its author ID matches, the author is human and qualifies under the trusted authority policy, and the selected option exists. An unrelated or ambiguous reply, such as "looks interesting", does not resolve a decision.

Authority policy:

- **Explicit owner mapping takes precedence.** A trusted repository policy maps a `decision_owner` role or team to eligible humans. CODEOWNERS may supply eligible humans for path-owned decisions; team membership must be resolved, not inferred from a display name. The action pilot has no team-membership permission: individual CODEOWNERS users and explicit trusted login lists can map an owner; an unresolved team cannot. If a mapping is required, keep the decision open. Policy comes from an approved repository revision or trusted action configuration, never from PR-head instructions or the reviewer's own declaration.
- **Interim fallback: independent repository sign-off.** When no explicit owner mapping exists, v1 may accept a human with repository write access (including maintain/admin) who is not the PR author. The context and summary name this fallback. It is an independent-sign-off proxy, not proof of domain-policy ownership. A consumer may require an explicit mapping; if that required mapping is unavailable, the decision stays open.
- The poster supplies eligible identities and the authority basis to the reviewer. It verifies the recorded answer against that policy before accepting a transition. `decision_owner` text alone cannot grant authority.

The rules:

- **Bot and agent replies never supply authorization.** Nor does a bot quoting an alleged human decision. The underlying human comment must be referenced and checked.
- **Every exit from a decision requirement is checked.** Resolving, retyping, lowering blocking status or severity, or weakening resolution criteria requires the recorded authorized answer. Without it, the poster retains the original open finding. A manual GitHub thread resolution is not a substitute.
- **Mistakes can be withdrawn.** An incorrect or no-longer-applicable `decide` may be withdrawn without authorization when the reviewer supplies `withdrawal_basis` and evidence showing why no decision is needed—for example, the permission expansion was removed. The poster validates the evidence references and records that explanation. Disagreement with the policy, an unsupported waiver, or a request to postpone it does not qualify as withdrawal.
- **The `reason` names the decider, the selected option and the reply.** The structured answer and authority basis are retained with the finding even if its type changes.

If the answer requires implementation (for example, "keep support read-only, remove the role"), replace the same open finding with a `fix` using `updated_finding`, preserving the ID and recorded decision. It remains blocking until that implementation is verified. If no implementation remains, the finding may be resolved directly. There is no intermediate pass in which the decision is closed but its required fix is missing.

## 6. Review outcome

The poster computes the **core outcome** from all open actionable records after accepted transitions, including findings outside threads. Apply these rules in order. The reviewer returns its proposed outcome, but the poster does not accept an unsupported claim of escalation or approval: `ESCALATE` must name an open blocking decision, and `APPROVED` requires no open blockers. An irreconcilable or invalid result is `INCOMPLETE`, with the retained findings still shown.

| Outcome          | When                                                                                     | Means                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `INCOMPLETE`     | The review, state recovery, required evidence validation or publication did not complete | Retry or repair the review process; this outcome alone does not imply a human policy decision. |
| `ESCALATE`       | Any open blocking `decide`                                                               | A named human decision is outstanding.                                                         |
| `CHANGES_NEEDED` | Any open blocking `fix` or `clarify`                                                     | There is work an agent or the author can do.                                                   |
| `APPROVED`       | Nothing blocking is open                                                                 | Ready, given green CI. Non-blocking findings may stay open.                                    |

"Needs a human" always names the decision. Touching a sensitive area, adding a dependency, or changing an interface is not an escalation by itself. If one of those needs a human, the reviewer emits a `decide` that says what to decide.

`APPROVED` is a review recommendation conditional on green required CI. It does not itself submit a GitHub approval. The consumer's poster may approve only when explicitly enabled, the reviewed head is still current, required checks pass, publication is complete, and its own approval gate permits it (§7.3). Consumer gates may withhold approval without changing the core outcome.

### 6.1 Summary comment

There is one summary comment, edited in place. It answers the question "what remains, and how do I get this ready?", in this order:

1. The core outcome and a one-line reason. If incomplete, name the failure and how to retry or repair it. If a consumer approval gate holds the PR, show that separately.
2. **Decisions needed:** each open `decide`, with its owner and a link.
3. **Required fixes:** the open blocking `fix` findings.
4. **Open questions:** the open blocking `clarify` findings.
5. **Optional improvements:** counts of the non-blocking findings by label.
6. **Progress since the last pass:** what was resolved or withdrawn, and why.
7. **Remaining risk:** a short statement.
8. Consumer extensions, such as the action's risk table and the skill's charter coverage.
9. A state marker indexing **all** retained records, including body findings, resolved/withdrawn history and informational records. It carries `v`, `schema_revision`, `sha`, `outcome` and `records`. Each actionable index entry has `id`, `status` and `location` (`{ kind: "review_comment", comment_id }` or `{ kind: "review_body", review_id }`). Informational entries carry their full informational finding and `status: "informational"`. For example:

```html
<!-- code-review:state {"v":1,"schema_revision":1,"sha":"<reviewed head SHA>","outcome":"CHANGES_NEEDED","records":[{"id":"f-3a9c0e1b7d","status":"open","location":{"kind":"review_comment","comment_id":12345}}]} -->
```

The index and full finding markers together are the portable state. They must be recoverable from GitHub by both consumers; local caches may accelerate reads but cannot be the only copy. Apply the marker escaping and trusted-origin rules in §4.3. When text grows too large, shorten derived human-readable summary sections first and link to complete records. Older informational entries may reduce to IDs/fingerprints. Split review bodies into several reviews when needed and index each record's actual location. If an actionable record or its index still cannot be persisted completely, report `INCOMPLETE` and retain prior state; never discard a blocker. A retry reconciles any already published markers with that index.

## 7. Review object (structured output)

### 7.1 Core

```json
{
  "contract_version": 1,
  "schema_revision": 1,
  "head_sha": "<reviewed head SHA>",
  "review_complete": true,
  "incomplete_reason": "",
  "summary": "What the PR does, in two to four sentences.",
  "outcome": "APPROVED | CHANGES_NEEDED | ESCALATE | INCOMPLETE",
  "outcome_reason": "One or two sentences.",
  "remaining_risk": "One or two sentences.",
  "findings": [
    { "...": "§3 finding object; id is omitted on new findings and the poster assigns it" }
  ],
  "prior_findings": [
    {
      "id": "f-3a9c0e1b7d",
      "status": "resolved | still_open | withdrawn",
      "reason": "…",
      "reply": "…",
      "evidence": [],
      "withdrawal_basis": "incorrect | no_longer_applicable | dismissed; withdrawn only",
      "updated_finding": {
        "...": "Full replacement actionable finding with the same id; still_open only, when changing the finding"
      },
      "decision": { "comment_id": 12345, "author_id": 67890, "option_id": "keep-read-only" }
    }
  ],
  "extensions": {}
}
```

This is a field-shape illustration, not a valid instance: omit optional fields when inapplicable. `evidence` is required and non-empty for `resolved`, `withdrawn`, and any transition carrying a decision answer. A replacement requires a reason and supporting evidence. `withdrawal_basis` is required only for `withdrawn`; `updated_finding` is allowed only for `still_open`; `decision` is supplied only when recording an authorized answer to a current or previously recorded decision requirement. A replacement contains the same ID, and its type-specific fields must be valid.

The full reviewer-output schema and the persisted-marker schema share finding definitions but distinguish new findings (no ID) from stored/replacement findings (ID required). Stored status `open` corresponds to reviewer transition `still_open`. Informational records never appear in `prior_findings`.

### 7.2 Canonical JSON Schema

The canonical schema lives in flight-rules (proposed path: `contracts/code-review/review.v1.schema.json`) and is distributed through a pinned export from the existing `@good-ground-collective/flight-rules` package. The package also ships the matching policy/context loader; the action must not maintain a second schema or prompt copy.

- Every object sets `additionalProperties: false`, except the `extensions` object.
- Use separate actionable and informational variants, with the required/forbidden fields in §3.2. Validate transitions and evidence references as well as the top-level object.
- Ordinary apostrophes are valid schema content. The action adapter owns argument transport: pass JSON through a supported argument/file mechanism or correctly quote it as data. Do not interpolate raw schema text into a shell command, and do not constrain the shared schema to compensate for shell quoting.
- Readers select and validate the declared major version and schema revision (§9). Invalid or unsupported input cannot clear blockers or cause approval.

### 7.3 Extensions

Consumer-specific fields go under `extensions.<consumer>` and never change core semantics.

- **`extensions.github_action`:**
  - the risk `dimensions` (the tiered rubric) and the review `mode` (`standard` or `comprehensive`);
  - a separately computed consumer approval gate, such as `{ status: "hold", reason: "Tier 1 High under the pilot safety policy", next_step: "Independent risk review required before automatic approval" }`. A Tier 1 High may hold automatic approval during the pilot even when the core outcome is `APPROVED`. The poster computes this gate from the action's validated rubric and policy; a model-supplied gate cannot override it. The summary shows both the core outcome and the gate. If a specific policy decision is actually required, emit a blocking `decide`; never manufacture one solely to encode the safety hold.
- **`extensions.flight_rules`:** `charterCoverage`, `lint`, and the Tier A, Tier B and holistic counts.

## 8. Remediation agent rules

| Type      | The agent may                                                                                                                                                             | The agent must not                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `fix`     | Implement the change, run the verification, and reply with the commit SHA and the verification result.                                                                    | Resolve the thread. The next review pass verifies and resolves it.                       |
| `clarify` | Answer with evidence it can cite (a `path:line`, a doc link, a test run), or apply the fallback change. If the answer needs the author's intent, leave it for the author. | Guess intent, or resolve the thread.                                                     |
| `decide`  | Gather evidence and surface the question. After an authorized answer is recorded and the finding is updated to `fix`, implement that change.                              | Supply authorization, claim that a bot reply is a human decision, or resolve the thread. |

**Only accepted reviewer transitions close contract findings; the poster applies them.** This changes `claude-comment-addressing`, which resolves the threads it fixes today. Humans may still use GitHub's resolve-thread control, but that UI state alone does not mark a contract finding resolved or withdrawn. The next pass reconciles it against the recorded reason, evidence and authority rules. A non-blocking finding resolved by a human other than the PR author may be withdrawn with `withdrawal_basis: "dismissed"` and checked resolver evidence. A blocking fix/clarify stays open and gets one explanation reply, without repeating that reply in later rounds. A decide stays open until the authority rules are met. Body findings have no resolve-thread event and use normal reviewer transitions.

## 9. Versioning

- The marker JSON carries `v` and `schema_revision`; reviewer objects carry `contract_version` and `schema_revision`. The initial signed-off v1 schema is revision 1. These draft edits precede that initial publication.
- Adding optional fields increments `schema_revision` within the same major version. Because schemas are strict, older readers do not silently accept newer revisions. Consumers pin a supported package/schema revision, and producers emit a revision supported by the consumer. A reader may support multiple revisions using the appropriate schema for each.
- Renaming or removing a field, adding a required field, changing an enum, or changing lifecycle/outcome semantics in §5 or §6 requires a new major version. Readers must accept the preceding major version's published markers for at least one consumer release after the new major ships, with an explicit migration that preserves IDs and outstanding blockers.
- Unsupported versions/revisions, malformed markers, and incomplete migration are `INCOMPLETE`; never interpret them as no outstanding findings. Extension payloads are validated by their owning consumer and cannot change core semantics.

## 10. Worked examples

### `clarify`

```markdown
**question (blocking, clarify, correctness):** Can this webhook be delivered more than once?

The handler creates a new incident on every delivery. If the provider retries events, the same event could create duplicate incidents.

<details>
<summary>Details For LLM</summary>

Identify the provider's delivery guarantee and any existing deduplication path, and reply with links to the documentation or code. If neither exists, add an idempotency check keyed on the provider's event ID in `src/webhooks/incidents.ts` and test a repeated delivery.

**Resolved when:** a reply cites an upstream deduplication guarantee, or the handler ignores a repeated event ID and a test proves it.

</details>
```

### `decide`

```markdown
**question (blocking, decide, security):** Should support staff be allowed to change feature flags?

This PR expands the support role from read access to write access on feature-kind flags. The implementation is consistent and tested, but the permission expansion needs the policy owner's confirmation.

<details>
<summary>Details For LLM</summary>

Options: approve the expansion, or keep support read-only. Recommendation: keep it read-only unless an operational need justifies the change. If approved, document the policy and keep the role-by-kind tests. If declined, remove `support` from the PUT allowlist in `feature-flags-routes.ts` and update the tests.

A coding agent can implement the decision; it cannot supply the authorization.

**Decision owner:** the access-policy owner for staff roles
**Decision options:** `approve-expansion` (permit support writes) or `keep-read-only` (remove support writes).
**Resolved when:** an eligible human explicitly selects an option, and its required implementation and role-by-kind tests are verified at the reviewed head. If implementation remains, preserve this finding's ID and update it to a blocking `fix`.

</details>
```

### Second pass (`prior_findings`)

```json
[
  {
    "id": "f-3a9c0e1b7d",
    "status": "resolved",
    "reason": "The query now includes tenantId, and check run 991 passed the cross-tenant regression test on this head.",
    "evidence": [
      {
        "kind": "code",
        "commit_sha": "4e1f2a9000000000000000000000000000000000",
        "path": "src/incidents/incident-repository.ts",
        "line": 42
      },
      {
        "kind": "check_run",
        "check_run_id": 991,
        "commit_sha": "4e1f2a9000000000000000000000000000000000"
      }
    ]
  },
  {
    "id": "f-81d0c4aa2e",
    "status": "still_open",
    "reason": "The provider documents at-least-once delivery and no deduplication exists, so the idempotency check is needed.",
    "evidence": [{ "kind": "document", "url": "https://example.com/provider/webhooks#delivery" }],
    "updated_finding": {
      "id": "f-81d0c4aa2e",
      "path": "src/webhooks/incidents.ts",
      "line": 58,
      "label": "issue",
      "type": "fix",
      "blocking": true,
      "severity": "major",
      "category": "correctness",
      "subject": "Deduplicate webhook deliveries before creating an incident",
      "discussion": "The provider retries events, so this handler can create multiple incidents for one event.",
      "details": "Add an idempotency check keyed on the provider's event ID in src/webhooks/incidents.ts. Test that delivering the same event twice creates one incident.",
      "resolved_when": "Repeated delivery of the same event creates only one incident, and the regression test passes."
    }
  },
  {
    "id": "f-0b77e3c9f1",
    "status": "still_open",
    "reason": "Only the PR author has replied; this needs the policy owner's decision."
  }
]
```

The IDs, URLs and commit SHA in this example are illustrative. Real transitions must cite artifacts the poster can validate.

### Authorized decision with implementation remaining

```json
{
  "id": "f-0b77e3c9f1",
  "status": "still_open",
  "reason": "The eligible policy owner selected keep-read-only in comment 34567. Remove the support write permission before this finding can close.",
  "evidence": [
    {
      "kind": "github_comment",
      "comment_id": 34567,
      "url": "https://github.com/owner/repo/pull/123#issuecomment-34567"
    }
  ],
  "decision": { "comment_id": 34567, "author_id": 67890, "option_id": "keep-read-only" },
  "updated_finding": {
    "id": "f-0b77e3c9f1",
    "path": "src/routes/feature-flags-routes.ts",
    "line": 90,
    "label": "issue",
    "type": "fix",
    "blocking": true,
    "severity": "major",
    "category": "security",
    "subject": "Keep the support role read-only for feature flags",
    "discussion": "The policy owner declined the proposed support write permission.",
    "details": "Remove support from the PUT allowlist in src/routes/feature-flags-routes.ts. Update the role-by-kind tests to show support can read but cannot write flags; retain permitted writes for the intended roles.",
    "resolved_when": "Support has no feature-flag write permission, and the role-by-kind tests pass."
  }
}
```

The poster checks authority against the original `decide` and its options before accepting the replacement, then stores the recorded decision with the new `fix`. The finding stays open with the same ID.

## 11. Consumer implementation boundaries

The package exports the canonical validator, full JSON Schema, a model-facing transport schema, review method/context loader, evidence planner and record codec. Full validation always precedes writes. If a transport schema accepts a wider shape, both forms come from the same canonical definitions and are pinned together; the wider shape cannot weaken the full validator or lifecycle checks. Consumer adapters verify transport compatibility against their selected model.

The poster validates GitHub comments, commits, code, check runs and resolver identity against GitHub. The reviewer judges semantic sufficiency, including whether an authorized reply actually selects the option and whether documentation resolves a concern. Consumer adapters own semantic duplicate detection, artifact provenance/recovery, persistence and retry serialization, body chunking and summary shortening. Approval is the last write after complete persisted state and current required CI.

The tlp-actions pilot retains one separate automatic-approval hold: Tier 1 High. It drops the two-Tier-1-Mediums compounding rule. Evaluate the gate after 30 gated PRs; retire it if fewer than one in five holds led to a code change or a decide. This is consumer policy, not a reason to change core finding outcomes.

See [code-review-package.md](./code-review-package.md) for entry points and integration.
