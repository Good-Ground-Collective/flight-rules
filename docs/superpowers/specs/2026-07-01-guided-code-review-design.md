# Guided Code Review Skill — Design

**Source RFC:** RFC-001 — Guided Code Review Skill
**Date:** 2026-07-01
**Status:** Approved design, ready for implementation plan

## Problem

As the team adopts agentic development, PR volume has outgrown human review
capacity. We need a skill that performs a first-pass review, guides a human
through the PR, and produces a **pending** GitHub review the human finalizes —
so a human still makes the final call while the agent does the legwork.

This is the *guided* review skill. A future, separate skill will run
autonomously and auto-approve; that is explicitly out of scope here.

## Decisions

These were settled during brainstorming and are load-bearing:

1. **Charter source — bundled with the plugin (v1).** The skill vets against
   `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`, which ships inside the
   installed plugin. No per-repo charter in v1, but the "load charter" step is
   a discrete seam so a repo-supplied *additional* charter can be layered in
   later without restructuring.
2. **Always pending, never submits.** The agent creates the review in PENDING
   state only. It never calls the `approve` / `request-changes` events. Its
   approve-vs-escalate conclusion is a *recommendation* written into the review
   summary; the human casts the actual verdict on GitHub.
3. **Inline comments + summary body.** Confirmed findings post as inline review
   comments anchored to file:line; a top-level summary carries the PR
   explanation and the recommendation.
4. **Accumulate then write.** Findings live in the session and are discussed in
   chat. Nothing is written to GitHub until the human approves the assembled
   review at the end.
5. **`gh` CLI now, structure for a future CLI command.** The fragile GitHub API
   mechanics live in a reference file that the future `flight-rules review`
   command will replace wholesale.

## Architecture & File Layout

A prose `SKILL.md` agent playbook (like `draft-spec`), plus one reference file
for the fragile GitHub mechanics. No TypeScript in v1.

```
skills/guided-code-review/
├── SKILL.md                      # the guided flow the agent follows
└── references/
    └── github-review-api.md      # exact `gh api` recipes for pending reviews
```

- **`SKILL.md`** — frontmatter (`name: guided-code-review`, a `description`
  that triggers on "review this PR" / "code review"), then the guided flow.
- **`references/github-review-api.md`** — copy-pasteable `gh api` calls for
  fetching the PR + diff, detecting the base branch, and creating a pending
  review with correctly-anchored inline comments. The skill reads this only at
  the "post" step. This file is the seam the future CLI command replaces.
- **Charter** is read at runtime from `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`
  — no copy stored in the skill folder, so it never drifts from source.

## Invocation & Inputs

**Launch:** `/flight-rules:guided-code-review [PR]` where `[PR]` is a PR number
or URL. If omitted, resolve the PR for the current branch (`gh pr view --json`).
If none is found or it is ambiguous, ask the user which PR to review.

**Context loaded up front:**
1. PR metadata — title, body, author, base branch, head branch, changed-files
   count, additions/deletions.
2. The diff — via `gh pr diff`.
3. The charter — from `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`.

**Input guards (before any analysis):**

- **Too-big guard.** If the diff exceeds **~10,000 changed lines**, stop and ask
  the author to split the PR rather than attempt a partial review. The threshold
  keys off line count and is stated explicitly in the skill so it is tunable.
- **Stacked-PR detection.** If the PR's base branch is **not the repo's default
  branch**, treat it as stacked: scope the review to the diff unique to this PR
  (against its actual base), note the downstream branch as context only, and do
  not re-review changes owned by the underlying PR. Tell the reviewer this is
  happening so the scoping is transparent.

**Out of scope:** multi-repo PRs — a single repo's PR only.

## The Guided Flow

Runs after context loads and guards pass. Maps to RFC-001's six steps.

1. **First-pass analysis (silent).** Evaluate the diff against two lenses and
   build an internal findings list (each tagged file/line, severity, lens,
   short explanation):
   - **Charter compliance** — the 13 mandates, with the weighting rules below.
   - **Holistic review** — security, logic errors, code smells, sloppy code.
     Charter-clean does not mean good.
2. **Explain the PR.** Plain-language summary in chat: what the PR does, key
   changes, how the pieces fit — informed by the analysis just performed. Reused
   as the summary body of the final pending review.
3. **Surface charter violations for opt-in.** Present the charter findings worth
   raising; ask per finding (or grouped) whether the reviewer wants each included
   as a comment. Waved-off nitpicks are dropped. Nothing written to GitHub yet.
4. **Approve-vs-escalate decision.** State the recommendation — "I'd approve as-is"
   or "here are areas a human should dig into" — with reasoning. Recommendation
   only; never a submitted verdict.
5. **Interactive deep-dive.** For each escalation area, walk the reviewer through
   it in chat: the concern, what to look into, options to consider. The reviewer
   responds inline (agree / dismiss / add their take); confirmed concerns become
   findings. Loops until worked through.
6. **Assemble & offer to post.** Show the full assembled review in chat (summary
   body + every confirmed inline comment with file:line) and ask for confirmation.
   On approval, create the pending review. The human finalizes on GitHub.

Accumulate-then-write holds throughout: nothing hits GitHub until step 6.

## Charter Vetting & Weighting

Encodes RFC-001's judgment rules so the agent does not drown the reviewer in
valid-but-trivial nitpicks.

- **M-1 (planning-system identifiers) special case.** The most common failure.
  Ignore it **unless there is exactly one instance in the entire PR.** Two or
  more instances are systemic noise: mention that the pattern exists, but do not
  raise per-instance comments. A single lone instance is surfaced as one finding.
- **Egregious-only for the rest.** The charter is the "what good looks like"
  guide. Surface the most serious violations, not every technicality. Minor or
  stylistic deviations are suppressed unless they compound into a real
  readability or correctness problem.
- **Reviewer holds the filter.** Every charter finding is opt-in (step 3). The
  agent proposes a tight, high-signal set. Better to under-flag charter nits than
  bury a real issue under them.
- **Severity ranking.** Holistic issues (security, correctness, logic) outrank
  charter-style issues in emphasis. A charter violation never crowds out a bug.

## Review Mechanics

Documented in `references/github-review-api.md`:

- Create a **pending** review via `gh api`:
  `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with a `comments`
  array (each entry: `path`, `line`/`side`, `body`) and the `event` field
  **omitted** — leaving the review PENDING, visible only to the author.
- Summary body carries the PR explanation + the approve-vs-escalate
  recommendation. Inline comments are the confirmed findings anchored to file:line.
- Inline comments must anchor to lines present in the diff. The reference file
  documents using the diff hunks to pick valid `line`/`side` values so the API
  does not reject comments on unchanged lines.
- Never call the `approve` / `request-changes` events.

## Error Handling

- **No PR found / ambiguous** → ask the user for the PR number or URL.
- **Diff too big (>~10k lines)** → stop, explain, request a smaller PR.
- **`gh` not authenticated / API failure on post** → report the error; findings
  are still held in-session, so offer to retry the post without re-running the
  analysis.
- **Comment rejected for a bad anchor** → fall back to placing that finding in
  the summary body with an explicit file:line reference rather than dropping it.

## Testing & Verification

A prose skill, so no unit-test target. Verification is:

- A dry-run walkthrough against a real PR in this repo (or a fixture PR)
  confirming the flow, the M-1 weighting, and that a pending review lands in
  PENDING state with correctly-anchored inline comments.
- The plugin's existing `test` / `typecheck` are unaffected (no `src/` changes).

## Future Work (out of scope for v1)

- Repo-supplied additional charter layered onto the bundled one.
- A `flight-rules review` CLI command replacing the raw `gh` mechanics.
- An autonomous, auto-approving variant of this review.
