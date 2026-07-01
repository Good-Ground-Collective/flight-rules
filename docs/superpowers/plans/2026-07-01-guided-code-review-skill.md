# Guided Code Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `guided-code-review` skill that first-pass reviews a PR against the bundled coding charter plus holistic concerns, walks a human through it in chat, and posts a PENDING GitHub review the human finalizes.

**Architecture:** A prose `SKILL.md` agent playbook (like `draft-spec`) plus one reference file holding the fragile `gh api` recipes for pending reviews. No TypeScript in v1 — the RFC defers a `flight-rules review` CLI command to later, and the reference file is the seam that command will replace. The charter is read at runtime from the installed plugin, never copied.

**Tech Stack:** Markdown skill files; `gh` CLI (`gh pr view`, `gh pr diff`, `gh api`); GitHub Pull Request Reviews API.

---

## Notes for the Implementer

- **This is not code — it's two markdown files.** There is no compiler, no unit test, no red-green loop. The "verification" for each authoring task is a structural check (file exists, frontmatter parses, required sections present) and, at the end, a live dry-run against a real PR.
- **Do not add anything to `src/`.** The plugin's `test` / `typecheck` must remain untouched. If you find yourself writing TypeScript, stop — that is explicitly future work.
- **Copy the embedded content verbatim.** The full content of each file is in the task. Do not paraphrase or "improve" it while transcribing.
- **Reference paths matter.** The charter is read from `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`. When running the skill from a local checkout during the dry-run, `${CLAUDE_PLUGIN_ROOT}` resolves to the repo root, so `docs/coding-charter.md` is correct there too.

## File Structure

```
skills/guided-code-review/
├── SKILL.md                      # Task 2 — the guided flow the agent follows
└── references/
    └── github-review-api.md      # Task 1 — exact `gh api` recipes for pending reviews
```

- `references/github-review-api.md` — created first (Task 2's `SKILL.md` points at it, so it must exist).
- `SKILL.md` — the playbook; created second.
- No other files are created or modified.

---

### Task 1: Create the GitHub review API reference

**Files:**
- Create: `skills/guided-code-review/references/github-review-api.md`

- [ ] **Step 1: Create the directory and file with this exact content**

````markdown
# GitHub Review API — `gh` Recipes

The exact commands the guided-code-review skill uses to talk to GitHub. Read
this file only when you reach a step that needs GitHub. Everything here runs
through the `gh` CLI, which is already authenticated in the user's environment.

`gh api` automatically substitutes `{owner}` and `{repo}` for the current
repository, so the literal string `repos/{owner}/{repo}/...` works as-is when
run from inside the repo's checkout.

## 1. Resolve the PR

If the user passed a PR number or URL, use it. Otherwise resolve the PR for the
current branch:

```bash
gh pr view [PR] --json number,title,body,author,baseRefName,headRefName,additions,deletions,changedFiles,url
```

- No `[PR]` argument → `gh pr view` uses the current branch's PR.
- Exit code non-zero or empty → no PR is associated. Ask the user for a PR
  number or URL and retry with it.

## 2. Determine the default branch (for stacked-PR detection)

```bash
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
```

Compare against the PR's `baseRefName` from step 1. If they differ, the PR is
**stacked** — it targets another feature branch, not the default branch.

## 3. Fetch the diff

```bash
gh pr diff [PR]
```

For a stacked PR, `gh pr diff` already returns only the diff between the head
and its actual base branch, so it is naturally scoped to the changes unique to
this PR. Use this diff directly; do not diff against the default branch.

To measure size for the too-big guard, count added/removed lines:

```bash
gh pr diff [PR] | grep -cE '^[+-]'
```

If the count exceeds **10000**, stop and ask the author to split the PR.

## 4. Create the PENDING review

Build a JSON payload and post it. **Omit the `event` field** — that is what
leaves the review in PENDING state, visible only to the author until they
submit it on GitHub.

Write the payload to a temp file, then post it:

```bash
gh api --method POST repos/{owner}/{repo}/pulls/PR_NUMBER/reviews --input review.json
```

`review.json` shape:

```json
{
  "body": "<the PR explanation + approve-vs-escalate recommendation, Markdown>",
  "comments": [
    { "path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "<finding>" },
    { "path": "src/bar.ts", "start_line": 10, "line": 14, "side": "RIGHT", "body": "<finding spanning lines 10-14>" }
  ]
}
```

Rules for `comments`:

- `path` is the file path as it appears in the diff.
- `line` is the line number **in the file's new version** (the right side of the
  diff). Use `side: "RIGHT"` for added or unchanged context lines, `side: "LEFT"`
  for a line that was deleted.
- The line **must** be part of the diff hunk. Commenting on a line GitHub does
  not consider part of the diff returns `422 Unprocessable Entity`. Read the
  `@@ -old,+new @@` hunk headers in the diff to pick valid line numbers.
- For a multi-line comment, add `start_line` (and `start_side`); `line` is the
  end of the range.
- An empty `comments` array is valid — a summary-only pending review.

## 5. Handle a rejected comment

If the POST fails with `422` because a comment anchor is invalid, do not drop
the finding. Remove that comment from the `comments` array, append its text to
the `body` with an explicit `path:line` reference, and re-post. Report to the
user which findings were relocated to the summary and why.

## Caveat: reviewing your own PR

GitHub forbids **approving** your own PR, but a PENDING review carrying only
comments on your own PR is allowed. Since this skill never submits an approve
event, self-review during testing works. The human still submits the verdict.
````

- [ ] **Step 2: Verify the file exists and is well-formed**

Run:
```bash
test -f skills/guided-code-review/references/github-review-api.md && echo OK
grep -c '```' skills/guided-code-review/references/github-review-api.md
```
Expected: `OK`, and an **even** number of code-fence markers (all fences closed).

- [ ] **Step 3: Commit**

```bash
git add skills/guided-code-review/references/github-review-api.md
git commit -m "feat(guided-code-review): add GitHub review API reference"
```

---

### Task 2: Create the SKILL.md playbook

**Files:**
- Create: `skills/guided-code-review/SKILL.md`

- [ ] **Step 1: Create the file with this exact content**

````markdown
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
````

- [ ] **Step 2: Verify frontmatter and required sections**

Run:
```bash
test -f skills/guided-code-review/SKILL.md && echo OK
head -4 skills/guided-code-review/SKILL.md
grep -c '```' skills/guided-code-review/SKILL.md
grep -E '^## Step [0-6]:' skills/guided-code-review/SKILL.md
```
Expected: `OK`; the first four lines are the `--- / name / description / ---`
frontmatter block with `name: guided-code-review`; an **even** code-fence count;
and Step 0 through Step 6 all present.

- [ ] **Step 3: Verify the skill is discoverable by the plugin**

Run:
```bash
ls skills/guided-code-review/
```
Expected: `references` and `SKILL.md` — matching the `draft-spec`/`setup` layout
the plugin already loads from `skills/`.

- [ ] **Step 4: Commit**

```bash
git add skills/guided-code-review/SKILL.md
git commit -m "feat(guided-code-review): add guided review skill playbook"
```

---

### Task 3: Live dry-run verification

This is the only meaningful functional test for a prose skill. Run the skill end
to end against a real PR and confirm the behavior matches the spec.

**Files:** none (verification only).

- [ ] **Step 1: Pick a target PR**

Use an existing open PR in this repo (for example the RFC-001 PR, #14) or open a
small throwaway PR with a deliberate charter violation — e.g. a source line
containing a banned M-1 token like `Phase 2` in a comment — so you can confirm
the M-1 handling.

- [ ] **Step 2: Run the skill against it**

Invoke `/flight-rules:guided-code-review <PR#>` (or from the PR's branch with no
argument) and walk the full flow.

- [ ] **Step 3: Confirm each behavior**

Check, in order:
- Context loads: PR metadata, charter (`docs/coding-charter.md`), and diff.
- Guards: a >10k-line diff is refused; a PR whose base is not the default branch
  is announced as stacked and scoped to its own diff.
- The PR explanation appears **after** the silent analysis and reflects it.
- Charter findings are offered opt-in; declining one drops it.
- M-1: two or more leaked identifiers produce a single "pattern exists" mention,
  not one comment each; a lone instance produces exactly one finding.
- The approve-vs-escalate recommendation is stated but **not** submitted.
- Nothing is posted to GitHub until you confirm at Step 6.
- The posted review is in **PENDING** state (visible to you as the author,
  awaiting submission), with inline comments anchored to correct lines and the
  summary body carrying the explanation + recommendation.

- [ ] **Step 4: Confirm no `src/` regressions**

Run:
```bash
npm run typecheck && npm test
```
Expected: both pass unchanged — this feature touched no TypeScript.

- [ ] **Step 5: Clean up**

Delete any throwaway test PR/branch created in Step 1. No commit for this task
(verification only).

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Architecture & file layout → Tasks 1–2 (both files, correct paths).
- Invocation & inputs (PR-or-branch, three context loads, 10k guard, stacked
  detection, single-repo) → SKILL Step 0 + reference §1–3.
- Guided flow (analyze → explain → opt-in → decision → deep-dive → assemble) →
  SKILL Steps 1–6.
- Charter weighting (M-1 exactly-one rule, egregious-only, holistic outranks) →
  SKILL Step 1 weighting rules.
- Review mechanics (pending via omitted `event`, inline + summary, valid
  anchors, never approve) → reference §4–5.
- Error handling → SKILL "Error handling" + reference §5.
- Testing/verification → Task 3.

**Placeholder scan** — no TBD/TODO; every file's full content is embedded
verbatim; the 10k threshold and all `gh` commands are concrete.

**Consistency** — "PENDING via omitted `event`", the M-1 exactly-one rule, and
the base≠default stacked heuristic are stated identically in the spec, the
SKILL, and the reference. Reference section numbers cited in SKILL.md (§1–5)
match the headings in Task 1's file.
