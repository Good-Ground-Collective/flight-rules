---
name: guided-code-review
description: "Guided first-pass code review of a GitHub PR. Vets the PR against the bundled coding charter and holistic concerns (security, logic, code smells), explains it to a human reviewer, walks through areas needing deeper investigation, and posts a PENDING review the human finalizes. Use when asked to review a PR or do a code review."
---

# Guided Code Review

This skill performs a first-pass review of a GitHub pull request and then guides
a human reviewer through it. The agent does the legwork — reading the diff,
checking it against the coding charter, spotting holistic issues, and drafting
comments — but **the human always casts the final verdict.** The skill never
approves or requests changes on its own. It ends by creating a review in a
**pending** state that the human tweaks and submits on GitHub.

An autonomous, auto-approving variant is separate future work. This skill is the
*guided* one: a human is making the call.

All GitHub interaction goes through the `gh` CLI. The exact commands live in
`references/github-review-api.md` — read that file when you reach a step that
touches GitHub.

---

## Step 0: Load context and run the guards

1. **Resolve the PR.** If the user gave a PR number or URL, use it; otherwise
   resolve the PR for the current branch. If none is found, ask the user which
   PR to review. (See reference §1.)
2. **Load PR metadata** — title, body, author, base branch, head branch, line
   and file counts. (Reference §1.)
3. **Load the charter** from `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`. Read
   the whole file — you vet against every mandate. This is a discrete step so a
   repo-supplied additional charter can be layered in later; for now there is
   only the bundled one.
4. **Load the diff.** (Reference §3.)

Then run two guards **before** any analysis:

- **Too-big guard.** If the diff exceeds ~10,000 changed lines (reference §3),
  stop. Explain that a partial review would be unreliable and ask the author to
  split the PR into smaller ones. Do not proceed.
- **Stacked-PR detection.** If the PR's base branch is not the repo's default
  branch (reference §2), it is stacked. Scope your review to the diff unique to
  this PR (which `gh pr diff` already gives you), treat the downstream branch as
  context only, and do **not** re-review changes owned by the underlying PR.
  Tell the reviewer you are doing this so the scoping is transparent.

Multi-repo PRs are out of scope — review a single repo's PR only.

---

## Step 1: First-pass analysis (silent)

Read the diff and build an internal **findings list**. Do not write anything to
GitHub or show the list yet. Evaluate against two lenses:

- **Charter compliance** — the 13 mandates (M-1…M-13), applying the weighting
  rules below.
- **Holistic review** — security issues, logic errors, code smells, sloppy
  code. Code that is perfectly charter-compliant can still be a dumpster fire.
  This lens is not optional and is where the most important findings usually
  come from.

Tag each finding with: file and line, severity, which lens caught it, and a one-
or two-sentence explanation.

### Charter weighting rules

- **M-1 (planning-system identifiers) special case.** Leaked planning/task-
  tracking identifiers in source are the most common failure. **Ignore them
  unless there is exactly one instance in the entire PR.** If there are two or
  more, do not raise a comment per instance — mention once that the pattern
  exists so the reviewer is aware, and move on. A single lone instance is
  surfaced as one finding.
- **Egregious-only for the rest.** The charter describes what good looks like.
  Surface the most serious violations, not every technicality. Suppress minor or
  stylistic deviations unless they compound into a real readability or
  correctness problem.
- **Holistic outranks charter.** Order findings so security, correctness, and
  logic issues get top billing. A charter nit must never crowd out a real bug.

---

## Step 2: Explain the PR

Write a plain-language summary in chat, informed by the analysis you just did:
what the PR does, the key changes, how the pieces fit together, and a brief note
of what you flagged. This orients the reviewer.

Keep this summary — you reuse it as the **body** of the pending review at the end.

---

## Step 3: Surface charter violations for opt-in

Present the charter findings worth raising. For each one (or sensible groups),
ask the reviewer whether they want it included as a review comment. Drop the
ones they wave off. Nothing is written to GitHub yet — you are only deciding
which findings survive into the final review.

Be honest that these are charter/style findings and let the reviewer decide how
much weight they carry. Better to under-flag nits than bury real issues.

---

## Step 4: Approve-vs-escalate decision

State your recommendation plainly:

- **"I'd approve this as-is"** — no areas need deeper human investigation, or
- **"Here are areas a human should dig into"** — list them, with reasoning.

This is a **recommendation only.** You are not submitting a verdict. The human
decides on GitHub.

---

## Step 5: Interactive deep-dive

If there are areas to dig into, walk the reviewer through them one at a time in
chat. For each area:

- Explain the concern and why it matters.
- Say what specifically to look into.
- Offer a couple of options or angles to consider.

Let the reviewer respond inline — they may agree, dismiss it, or add their own
take. Turn confirmed concerns into findings/comments. Loop until every area is
worked through. Continue accumulating in the session; still nothing posted.

---

## Step 6: Assemble and offer to post

Show the reviewer the full assembled review in chat before touching GitHub:

- The **summary body** (the Step 2 explanation + the Step 4 recommendation).
- Every **confirmed inline comment**, each with its `path:line` and text.

Ask for explicit confirmation. On approval, create the **pending** review
(reference §4). If a comment anchor is rejected, relocate that finding into the
summary body rather than dropping it (reference §5), and tell the reviewer.

Then tell the reviewer the review is waiting for them in a pending state on the
PR, where they can edit comments and choose approve / request changes / comment.

---

## Error handling

- **No PR found / ambiguous** → ask the user for the PR number or URL.
- **Diff too big (>~10k lines)** → stop, explain, request a smaller PR.
- **`gh` not authenticated or the post fails** → report the error. Your findings
  are still held in the session, so offer to retry the post without re-running
  the analysis.
- **A comment is rejected for a bad anchor** → move that finding to the summary
  body with an explicit `path:line` reference (reference §5).
