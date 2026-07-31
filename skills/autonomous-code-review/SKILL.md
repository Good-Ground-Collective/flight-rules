---
name: autonomous-code-review
description: "Unattended, maximally strict review of a factory-authored PR. Enumerates every objective coding-charter violation as an inline comment — deferring to the repo's linter for the mandates it provably enforces and reading the diff for the rest — raises judgment-call mandates once each, and submits a COMMENT review ending in an ESCALATE-or-CLEAR verdict on whether guided-code-review still needs a human. Use after execute-work opens a PR, or standalone against any PR the factory wrote."
---

# Autonomous Code Review

This skill reviews a pull request **written by the flight-rules factory**, with
no human in the loop, and it is deliberately far stricter than
`guided-code-review`. Its job is to clear the deck: by the time a human reviewer
arrives, every objective charter violation should already be named on the diff,
so the human is spending attention on architecture and intent rather than
arguing about mandate compliance.

**Terminal state:** a submitted `COMMENT` review on the PR, ending in a verdict
of `ESCALATE` (a human should run `guided-code-review`) or `CLEAR` (the change
is low-risk enough that a human can approve on green CI).

## The two rules that shape everything else

**1. You never fix anything.** You read, you judge, you comment. A separate
remediation agent picks the findings up from the review. So every comment must
be written to bootstrap that agent cold — see the comment format below. An
observation that only makes sense to someone who watched you form it is a
finding you have effectively dropped.

**2. You never cast a verdict on GitHub.** The `event` is always `COMMENT`.
GitHub rejects `APPROVE` and `REQUEST_CHANGES` from the author of the PR, and
the factory authored this one. Your recommendation lives in the review body as
prose plus a machine-readable block; it never lives in the `event` field.

## How this differs from `guided-code-review`

They are near-inverses, and running one does not substitute for the other.

| | `guided-code-review` | this skill |
|---|---|---|
| Audience | a human reviewer | a remediation agent |
| Charter posture | egregious-only, nits suppressed | exhaustive on objective mandates |
| M-1 leaks | ignored unless exactly one | every instance |
| Interaction | conversational, opt-in per finding | none |
| Review state | `PENDING`, human submits | `COMMENT`, submitted |

`guided-code-review` suppresses nits because human attention is the scarce
resource. Here it isn't. That single difference is why the weighting rules
invert, and why the skills are separate rather than one skill with a flag.

**You do not re-verify acceptance criteria.** `code-verifier` owns that contract
and has already itemized it. Re-litigating it here produces a second opinion
nobody asked for on a question already answered with evidence. Your lenses are
the charter and holistic code quality — nothing else.

All GitHub interaction goes through the `gh` CLI. The commands live in
`${CLAUDE_PLUGIN_ROOT}/docs/github-review-api.md` — read that file when you
reach a step that touches GitHub. This skill uses §1, §2, §3, §5 and **§6**
(`COMMENT`, not the `PENDING` payload in §4).

## Preconditions

- A **PR number or URL**, or a checkout whose current branch has an open PR.
- Run from the **repo root**, so the linter and its config resolve.
- `gh` is authenticated.

## Process

You MUST create a todo per step and complete them in order.

### 1. Load context and run the guards

1. **Resolve the PR** and load its metadata — title, body, author, base branch,
   head branch, line and file counts. (Reference §1.)
2. **Load the charter** from `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`.
   Read the whole file. You vet against every mandate.
3. **Load the diff.** (Reference §3.)
4. **Take the upstream signals, when you have them.** Invoked from
   `execute-work` you are handed the verifier's `charterConcerns` and any
   `openQuestions` or `UNVERIFIABLE` criteria. Treat `charterConcerns` as
   *hypotheses to confirm against the diff*, never as findings to repost — the
   verifier saw the working tree, not the PR, and its charter pass was a
   secondary duty. Confirm each one yourself or drop it.

Then the guards:

- **Too-big guard.** More than ~10,000 changed lines (reference §3): do not
  attempt the review. Post a summary-only `COMMENT` review saying the diff
  exceeded the guard and was not reviewed, verdict `ESCALATE`, and stop. An
  interactive skill can ask for a smaller PR; you cannot, and skipping silently
  would read as a clean review.
- **Stacked-PR detection.** If the base is not the default branch (reference
  §2), review only the diff unique to this PR — which `gh pr diff` already gives
  you — and say so in the body. Never re-flag findings owned by the branch
  underneath; the remediation agent would fix them on the wrong branch.

### 2. Establish charter coverage, then lint

**You are responsible for every Tier A mandate on every changed file. Always.**
The linter is an optimization, never a precondition: where a mandate is provably
enforced you may take the linter's output instead of re-deriving it by reading,
because an agent grepping a diff is a worse and less deterministic linter than
the linter. Where it isn't enforced, the mandate is yours. Nothing about a
repo's tooling narrows what this skill checks — it only changes *how* each
mandate gets checked.

**Never infer coverage from the presence of a linter.** "The repo has eslint" and
"the repo checks the charter" are different claims. A repo can lint hard against
a config that has never heard of `preflight`, and if you run it, transcribe some
style warnings and move on, every Tier A mandate has silently gone unchecked
behind a green-looking review. That failure is worse than no linter at all,
because it looks like coverage. Measure coverage; do not assume it.

**Establish coverage per mandate, before linting.** `eslint --print-config`
resolves the full config for one file, including which rules are on and at what
severity:

```bash
npx eslint --print-config <a changed file>
```

Run it once per distinct path pattern in the diff — typically one source file
and one test file, since overrides usually split on exactly that line. Then read
the `rules` map. Each Tier A mandate lands in one of **three** states for that
path, and the difference between the last two is the whole point of this step:

| In the resolved `rules` map | State | What you do |
|---|---|---|
| `preflight/<rule>` at `1`/`2` (`"warn"`/`"error"`) | **enforced** | Run the linter; transcribe its findings into comments. |
| `preflight/<rule>` at `0`/`"off"` | **waived** | Nothing. The repo turned it off deliberately. |
| No `preflight/<rule>` key at all | **reviewed** | Read the diff for it yourself, as you do for Tier B. |

**Waived and reviewed print almost identically and mean opposite things.** A
rule set to `0` only exists in the map because the config loaded `preflight` and
then switched it off — that is a decision the repo made with more context than
you have. A rule that is simply *missing* means `preflight` was never installed;
nobody decided anything, and the mandate is yours.

Get this backwards in either direction and the review is wrong: treat waived as
reviewed and you overrule a documented decision on every file it touches; treat
reviewed as waived and you skip the mandate entirely while reporting a clean
pass.

**Then run the linter, scoped to the files this PR changed**, in JSON so you can
anchor the results:

```bash
npx eslint --format json <changed source files>
```

Scoping matters. A whole-repo run returns pre-existing violations this PR did
not cause; commenting on those is both wrong and unanchorable, since GitHub
rejects a comment on a line outside the diff.

Each message gives you `filePath`, `line`, `ruleId` and `message` — everything
an inline comment needs. Discover the invocation rather than assuming one: a
`lint` script in `package.json`, else the lint step in `.github/workflows/*.yml`
(which often carries the real command when no npm script does), else bare
`npx eslint` when an `eslint.config.*` resolves.

**On waived mandates.** `flight-rules` itself waives four rules for
`**/*.test.ts`, with a comment explaining why test files legitimately need the
idioms the charter bans in source. Re-raising those would be overruling a
documented decision from a position of less context. If you believe a waiver is
wrong, that is *one* Tier B observation about the config — never a comment on
every file it covers.

**Non-JavaScript repos, no eslint at all, or a lint run that fails** all land in
the same place: nothing is enforced, nothing is waived, and all seven Tier A
mandates are `reviewed`. You check every one of them by reading and the body
says so. A missing linter must never quietly become a narrower review.

### 3. Charter pass, in two tiers

The charter mixes mandates a machine can decide with mandates that need
judgment, and treating them alike is how a strict reviewer becomes one people
learn to ignore. A bot with a high false-positive rate doesn't just waste time
on its bad findings — it costs you the good ones.

**Tier A — objective. Zero tolerance, one inline comment per instance.**

Each row names the `preflight` rule that *can* enforce it. Whether it actually
does is what step 2 measured, per file — never what this table asserts.

| Mandate | Enforceable by `preflight` as |
|---|---|
| M-1 no planning-system identifiers | `no-planning-identifiers` |
| M-2 structural: no paragraph block comments | `no-paragraph-comments` |
| M-3 interface → class → optional singleton | `service-shape`, `no-loose-functions` |
| M-5 single Zod-validated props object | `constructor-single-props` |
| M-7 camelCase TS object keys | *(no rule exists — always yours)* |
| M-10 flat if-else over nested switch+if | `no-switch-with-nested-if` |
| M-11 typed errors thrown at the call site | `no-throw-helpers`, `error-class-sets-name` |

**Every row is accounted for on every PR**, in one of the three states step 2
resolved. `enforced` → transcribe the linter's findings, adding the remediation
detail it can't produce. `reviewed` → read the diff for it yourself. `waived` →
skip it, because the repo said so. The first two produce the same output: an
inline comment per instance.

M-7 has no `preflight` rule at all, so it can never be `enforced` and is read by
hand on every PR — a standing reminder that "linted" was never the boundary of
Tier A.

**This is the exact inversion of `guided-code-review`'s weighting rules.** There,
M-1 leaks are ignored unless there is exactly one. Here, every instance gets a
comment. Do not carry that suppression across; it is the whole reason this skill
exists.

**Tier B — judgment. At most one observation per mandate, in the review body,
never inline, never per-instance.**

| Mandate | The judgment it needs |
|---|---|
| M-2 quality: the no-dumb-comments bar | is this comment derivable from the code? |
| M-4 don't over-engineer DI seams | does anyone but the test suite want to swap this? |
| M-6 declarative over procedural parsing | could Zod express this flow? |
| M-8 ordinary English method names | would a new hire understand the name cold? |
| M-9 visual grouping with newlines | does this read with any rhythm? |
| M-12 READMEs document concepts | is this restating a linter rule? |
| M-13 the code models reality | is this framed in domain terms or tool terms? |

M-2 straddles both tiers on purpose. The structural ban — paragraph blocks above
non-declarations — is mechanical and belongs in Tier A. "No dumb comments" is a
judgment call about a specific comment's value and belongs here.

Write each Tier B observation as one paragraph naming two or three
representative examples with `path:line`. Never fan a judgment call out into
twelve inline comments; a reviewer reading twelve variations of "consider
grouping this with newlines" learns to scroll past the whole review.

### 4. Holistic pass

Charter compliance is not code quality. Read the diff for security holes, logic
errors, incorrect edge-case handling, race conditions, unhandled failure modes,
and tests that assert nothing. **Code that is perfectly charter-compliant can
still be broken**, and these findings are the ones that drive escalation.

Every holistic finding is inline, at its line, regardless of severity.

### 5. Decide the verdict

**`ESCALATE` — a human should run `guided-code-review`.** Any one of these is
sufficient:

- Any holistic finding at all, at any severity.
- A Tier B observation against **M-4 or M-13** — those are architectural shape,
  which is exactly what the human pass is for.
- A new or changed exported interface, public API, or module boundary.
- A new runtime dependency.
- Changes touching authentication, authorization, cryptography, secrets, data
  migrations, or deletion paths.
- Any upstream `UNVERIFIABLE` criterion or unanswered `openQuestions`.
- `src/` changed with no accompanying test changes.
- The too-big guard fired.

Note that **`reviewed` Tier A mandates do not escalate by themselves.** You
checked them by reading — a weaker check than a linter, but a real one — and
escalating on that alone would mean this skill never returns `CLEAR` outside
repos that already run `preflight`. Report the coverage and let the findings
decide.

**`CLEAR` — low enough risk to approve on green CI.** Every one of these must
hold:

- No holistic findings.
- No Tier A findings, or only a handful and all of them cosmetic.
- No new dependencies, no public API change, none of the sensitive paths above.
- Tests accompany the change.
- Every upstream acceptance criterion passed.

`CLEAR` is a recommendation to a human, not an approval, and it is never the
default. When the two lists disagree or you are genuinely unsure, escalate — the
cost of an unnecessary human pass is minutes, and the cost of a missed one is a
merged defect.

### 6. Assemble and submit

The review **body** carries, in this order:

1. **What the PR does** — a short plain-language summary.
2. **How it was reviewed** — the lint command you ran (or why none ran), each
   Tier A mandate's coverage state, and any scoping from the stacked-PR or
   too-big guards. **Name the `reviewed` and `waived` mandates explicitly.** A
   reader has to be able to tell which findings a linter stands behind, which
   rest on an agent's reading, and which the repo opted out of. Burying that
   distinction is how "reviewed" gets mistaken for "verified."
3. **Tier B observations** — one paragraph each.
4. **The verdict**, as prose plus this fenced block, verbatim keys:

````markdown
```yaml
verdict: ESCALATE | CLEAR
escalationReasons:
  - <one line per trigger from step 5, omit the list when CLEAR>
tierA: <count of inline charter comments posted>
tierB: <count of judgment observations in this body>
holistic: <count of security/correctness/logic findings>
lint: ran | absent | failed
charterCoverage:
  enforced: [<mandate ids a linter checked, e.g. M-1, M-2>]
  reviewed: [<mandate ids you checked by reading, e.g. M-7, M-11>]
  waived: [<mandate ids the repo's config deliberately disables>]
```
````

The three lists must together account for **every Tier A mandate** — M-1, M-2,
M-3, M-5, M-7, M-10, M-11. A mandate in none of them is a mandate nobody
checked, and this block is the only place that becomes visible.

`lint: absent` with all seven under `reviewed` is a complete, honest review.
`lint: ran` with mandates in none of the lists is precisely the failure this
block exists to make impossible to hide.

Downstream automation reads `verdict` and nothing else, so keep the key spelled
exactly that way and put it in the body — a verdict that exists only in your
chat output is a verdict no pipeline can act on.

Then **anchor every inline comment against the `@@` hunk headers before you
post.** One bad anchor rejects the entire payload, and this skill posts far more
comments than the guided one, so it has far more chances to lose the whole
review. Verify first; §5's retry is the fallback, not the plan.

**Submit the review** with `"event": "COMMENT"` (reference §6). Report the review
URL, the verdict, and the counts.

## Inline comment format

Same two sections as `guided-code-review`, but the second one does different
work. There, a human rewrites the summary in their own words to prove they
understood it. Here, nobody rewrites anything — **an agent reads the details
block and fixes the code from it.** So the details block is a remediation brief,
not a rationale:

```markdown
<1–3 sentence plain description of the finding, for a human skimming the PR>

<details>
<summary>Details For LLM</summary>

<the mandate or bug, the concrete fix, the exact code to write where it is
short enough to state, the file:line references, and any test that should
change with it>
</details>
```

State the fix, don't gesture at it. "Violates M-11" is not a remediation brief;
"delete `throwNotFound()` and throw `new TicketNotFoundError(id)` inline at
`src/tasks/get.ts:42`, then update the assertion in `get.test.ts:88`" is.

## Guardrails

- **Never `APPROVE`, never `REQUEST_CHANGES`.** The `event` is always `COMMENT`.
- **Never fix anything.** No edits, no commits, no pushes. You review.
- **Never merge, never close the PR.**
- **Never re-verify acceptance criteria.** That is `code-verifier`'s contract.
- **Never carry `guided-code-review`'s suppression rules across.** Every Tier A
  instance gets a comment.
- **Never fan a Tier B mandate out into per-instance inline comments.**
- **Never skip a Tier A mandate because the repo doesn't lint it.** Coverage
  changes how you check; it never changes what you check.
- **Never treat the presence of a linter as evidence the charter was checked.**
  Resolve the rules per file and report the split.
- **Never overrule the repo's lint configuration** by re-raising a rule it
  deliberately disables — as distinct from a rule that is merely absent, which
  you check yourself.
- **`CLEAR` is never the default.** Ambiguity escalates.

## Error handling

- **No PR found** → ask for a number or URL. Standalone this is interactive;
  from `execute-work` the PR is handed to you, so this cannot fire.
- **Diff over the guard** → summary-only review, verdict `ESCALATE`. Never skip
  silently.
- **No linter, the lint run fails, or a non-JavaScript repo** → every Tier A
  mandate moves to `charterCoverage.reviewed`, you check all seven by reading,
  and the body says so. Record `lint: absent` or `lint: failed`. This is a
  normal, complete review, not a degraded one — do not escalate on this alone.
- **A linter that doesn't enforce the charter** (eslint with an unrelated
  config, `preflight` not installed) → the most dangerous case, because the run
  succeeds and looks like coverage. `--print-config` is what catches it. Treat
  every mandate absent from the resolved rules as `reviewed`, not as passed.
- **`422` on a comment anchor** → relocate that finding into the body with an
  explicit `path:line` and re-post (reference §5). Never drop the finding.
- **`gh` unauthenticated or the post fails** → report it. Your findings are
  still in the session, so offer to retry the post without re-running the
  analysis.
- **Over ~15 instances of one Tier A mandate in one file** → this is a systemic
  pattern, not fifteen findings. Comment inline on the first three, then post
  one file-level comment carrying the total count and the complete `path:line`
  list in its details block. Every instance is still named in the review;
  grouping changes where they sit, never whether they were reported.

## What Good Looks Like

- Every objective charter violation in the diff has an inline comment, and each
  one names its fix concretely enough to act on without the diff in hand.
- No Tier B mandate appears more than once, and none appears inline.
- All seven Tier A mandates appear in `charterCoverage`, split honestly across
  `enforced`, `reviewed` and `waived`, and the body names the last two in prose.
- Coverage was resolved with `--print-config`, not inferred from the fact that a
  lint command exists.
- Where a mandate was enforced, the comments are built from the linter's output
  rather than the agent's reading — and where it wasn't, the review says so
  plainly instead of letting a green lint run imply coverage it never had.
- Nothing the repo's lint config deliberately disables was re-raised.
- The review is `COMMENT`; no approval and no change-request was attempted.
- The body ends in a `verdict` block a pipeline can parse.
- A `CLEAR` verdict is defensible line by line against step 5's checklist.
- The remediation agent that picks this up needs nothing that isn't in the PR.
