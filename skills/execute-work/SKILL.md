---
name: execute-work
description: "Drives a single ticket from to-do to PR-in-review: reads it through the flight-rules CLI, branches deterministically, runs the code-implementation and code-verifier agents in a bounded loop, then commits, pushes, opens a PR and moves the ticket. Never merges and never lets an unverified change reach a PR. Use when an engineer or agent picks up a ticket to implement it."
---

# Execute Work

This is the skill that builds the thing. You are handed a **ticket id**; you hand back an open pull request that an independent verifier has already checked, criterion by criterion, against that ticket's Acceptance Criteria. Where `sharpen-the-saw` deliberately stops at a red test suite so a human can implement, this skill carries the work all the way to review.

**The hard rule: this skill never merges, and never lets an unverified change reach a PR.** Those are one rule, not two. The verifier is the gate, and a human is the merge button. If you catch yourself opening a PR on the strength of the implementer's own say-so, stop — you have removed the only independent check in the pipeline.

**Terminal state:** the PR is open, the ticket sits in the tracker's in-review status, and the user is holding a run summary they can grade.

## Preconditions

- You are handed a **ticket id**.
- Run everything from the **repo root** (the `flight-rules` CLI resolves config relative to CWD).
- `flight-rules check` reports `"ok": true`. If it doesn't, fix the environment first — the run mutates tracker state, and a half-configured CLI fails partway through.
- The **working tree is clean**. A dirty tree stops the run *before any mutation*: the commit step stages by explicit path, so pre-existing edits to a file the implementer also touched would be swept into the commit silently.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the ticket

```bash
flight-rules ticket get <id>
```

From the returned layered body, extract:

- **Problem Statement** — the why. Context for the implementer, not a contract.
- **Solution** — the intended shape. This also becomes the PR summary.
- **Acceptance Criteria** — the contract. This is what the verifier checks and the only definition of done.
- **Guided Walkthrough** — files, patterns, and test approach, when the ticket has one.

Also note the ticket's title (for the branch slug) and its labels.

**If the Acceptance Criteria section is missing or empty, stop and ask the user.** Never infer the contract from the Problem Statement, and never write criteria yourself — a fabricated contract makes the verifier's PASS meaningless. A ticket with no criteria isn't ready; say so and stop.

If the ticket carries the `sharpen-the-saw` label, stop and point the user at `/sharpen-the-saw` instead. That work is reserved for a human.

Confirm the working tree is clean before going further:

```bash
git status --porcelain
```

Any output means stop, per Preconditions. (Read-only git inspection like this is fine; it is *mutations* that must go through `flight-rules`.)

### 2. Resolve the tracker's status names

The skill has to move the ticket twice — into "work started" and into "PR open" — but only the board knows what those statuses are called. `Config.inProgressStatus` and `Config.inReviewStatus` are **optional with no defaults**; their absence is precisely the signal to discover and store. Never assume a value.

This step is **discover → ask → store**, and it is interactive **once per repo**. After the first run it is a silent config read.

**Read** `.claude/flight-rules.local.md`. If both `inProgressStatus` and `inReviewStatus` are present, use them and move on.

**Discover** the reachable statuses when either is missing:

```bash
flight-rules ticket transitions <id>
```

It prints `{"id":"…","transitions":["To Do","In Progress","In Review","Done"]}` and mutates nothing.

**Ask** with `AskUserQuestion`, once per missing field:

- When the list is non-empty, offer the discovered names as the options — "Which status means work has started?" and "Which status means a PR is open and awaiting review?"
- When the list is **empty**, that is a valid state, not an error (a fresh GitHub repo has no `status:` labels yet). Ask for free text instead and explain that the tracker will create the status on first use.

**Store** both answers by rewriting `.claude/flight-rules.local.md` with `Write`, exactly as `skills/setup/SKILL.md` does — preserve every existing frontmatter field verbatim and add:

```markdown
inProgressStatus: <the chosen in-progress status>
inReviewStatus: <the chosen in-review status>
```

Later runs in this repo are then fully non-interactive.

Pass these stored names straight to `--to` and nothing else. **Do not compare a stored status name against the `status` field of `flight-rules ticket get`.** On the GitHub tracker those two are different formats — `transitions` returns human form (`in progress`), `ticket get` returns the slug (`in-progress`) — so such a comparison can never match. They round-trip correctly through `--to`, which re-slugifies. Compare nothing; just transition.

### 3. Move the ticket to in-progress

```bash
flight-rules ticket status <id> --to "<inProgressStatus>"
```

Do this before writing code, so the board reflects reality while the loop runs.

### 4. Create the branch

Use the deterministic CLI command — never hand-roll `git checkout`:

```bash
flight-rules git checkout --type <type> --scope <id> --description <slug> [--from <base>]
```

- `--type` — the semantic type matching the work (`feat`, `fix`, `chore`, …). Reuse it for the commits and the PR so the trail is consistent.
- `--scope` — the ticket id.
- `--description` — a short kebab slug from the ticket title.
- `--from <base>` — **only** when this work stacks on another in-flight branch; otherwise omit and it branches off current HEAD.

The command prints `{"branch":"…","from":null}`. Keep that branch name — the PR's `--head` needs it.

### 5. Assemble the implementation dispatch

Build the brief you will hand `code-implementation`. It gets exactly:

- **The ticket's full layered body** — Problem Statement, Solution, Acceptance Criteria, and the Guided Walkthrough when present. Don't summarize it; the agent is a lower-tier model and paraphrase loses the contract.
- **A pointer to the coding charter**: `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`. Pass the path, not your précis of it — the agent is required to read it in full.
- **Parent RFC / TDD content, when the ticket links one.** Read the parent epic for the technical writeup:

  ```bash
  flight-rules epic get <epicId>
  ```

  On **Jira** the epic payload does **not** resolve `tdd` — `getEpic` omits it. So when the tracker is Jira and the epic's `metadata.tddId` is set, fetch the design separately:

  ```bash
  flight-rules tdd get <tddId>
  ```

  On GitHub the epic payload already carries `tdd`, so no second call is needed. Include only the parts that bear on this ticket.

Do not include your own opinion on how to build it. The walkthrough and the charter are the guidance; anything you add is a third voice the agent has to reconcile.

### 6. The implement / verify loop — hard maximum 3 iterations

Dispatch the two agents in strict alternation. Count iterations out loud; you will report the count.

**a. Dispatch `code-implementation`** with the brief from step 5. On **iterations 2 and 3**, add the previous verifier's itemized FAIL entries **verbatim** — the criterion, the verdict, and the evidence exactly as the verifier wrote them. That evidence *is* the definition of what still needs fixing; rewriting it in your own words is how a retry loses the thread.

It returns a trailing YAML block:

```yaml
summary: …
filesChanged:
  - path: …
    why: …
testsRun:
  - command: …
    result: …
approach: …
openQuestions:
  - …
```

Keep `filesChanged[].path` — the commit step stages from it. If `openQuestions` is present, see Error handling: it goes to the user, unanswered.

**b. Dispatch `code-verifier`** with the acceptance criteria, fetched fresh and structured:

```bash
flight-rules ticket get <id> --section acceptance-criteria
```

That returns `{id, section, markdown, items:[{text,done}]}`. Hand it the criteria and nothing that could bias it — **not** the implementer's `summary`, `approach`, or `testsRun`. Its contract permits `filesChanged` as a map of *where to look*; never pass it as a claim that the work is done. A verifier that has read the implementer's victory lap is not an independent check.

It returns:

```yaml
summary: …
criteria:
  - criterion: …
    verdict: PASS | FAIL | UNVERIFIABLE
    evidence: …
charterConcerns:
  - …
verified: true | false
```

**c. Read `verified`.** `true` exits the loop and you ship. `false` means iterate — go back to (a) with the FAIL evidence, unless you have already used three iterations, in which case stop (see Error handling). Any `UNVERIFIABLE` verdict goes to the user, whatever `verified` says.

Three iterations is a **hard ceiling**, not a target. Do not restart the count, do not run a "quick fourth fix yourself", and never overrule a FAIL because you disagree with the verifier.

### 7. Ship it

Only once `verified: true`.

**Commit.** Stage by explicit path — the command has no all-files flag, and that is deliberate, so an unrelated stray edit can never ride along. Repeat `--file` once per `filesChanged[].path`:

```bash
flight-rules git commit --type <type> --scope <id> --description <slug> --file <path> --file <path>
```

Never use a Claude Code auto-generated commit. The CLI owns the message format.

**Push.** The command resolves the branch from HEAD and sets upstream by default:

```bash
flight-rules git push
```

There is no force flag. If the push is rejected, stop and tell the user — do not reach for raw git to get around it.

**Open the PR.** The base is the repository's default branch (read it read-only, e.g. `gh repo view --json defaultBranchRef`); the head is the branch `git checkout` printed in step 4:

```bash
flight-rules pr create --type <type> --scope <id> --description <slug> --summary "<from the ticket's Solution>" --ticket-id <id> --test-notes "<the verifier's per-criterion evidence>" --base <default-branch> --head <branch>
```

- `--summary` — drawn from the ticket's **Solution** section, not from the implementer's `summary`. The PR describes the intended change.
- `--test-notes` — the verifier's evidence. This is the artifact that makes the PR reviewable: the human reviewer sees which criteria were checked and how.
- `--change` is available and repeatable if the change list is worth spelling out.

**Move the ticket:**

```bash
flight-rules ticket status <id> --to "<inReviewStatus>"
```

Then **stop.** Do not merge. Do not approve your own PR.

### 8. Report

Give the user, in this order:

- **Iterations used** — 1, 2, or 3. Say it plainly; it is the honest signal of how hard this was.
- **Per-criterion verdicts** — every criterion with its verdict and the verifier's evidence, including any `UNVERIFIABLE`.
- **The PR URL**, and the branch name.
- **Every `charterConcerns` entry** the verifier raised, verbatim. These didn't block the PR — they are for the human reviewer, so don't quietly drop them.
- **Any `openQuestions`** from either agent, still unanswered.

## Guardrails

- **Maximum 3 loop iterations, hard.** No restarting the count, no fourth attempt under another name.
- **Never merge.** This skill opens a PR and stops. Merging is a human decision.
- **Never let an unverified change reach a PR.** `verified: true` is the only key that unlocks step 7.
- **Never tick acceptance-criteria checkboxes.** The `items[].done` flags are read-only to this skill; the verifier's itemized verdict is the record of what passed. A ticked box in a tracker is a claim nobody checked.
- **All git and tracker mutations go through `flight-rules`.** Never hand-rolled `git commit`/`checkout`/`push`, never Claude Code auto-generated commits, never native tracker APIs (`gh issue edit`, the Jira REST API) for state changes. Read-only inspection with plain `git` or `gh` is fine.
- **`openQuestions` and `UNVERIFIABLE` always reach the user, unanswered.** The agents ask when they are genuinely unsure. Answering on their behalf converts a flagged unknown into a silent guess — which is the exact failure the loop exists to prevent.
- **Never overrule the verifier.** A FAIL you disagree with is still a FAIL. Feed it back to the implementer or stop.

## Error handling

- **Dirty working tree** → stop before mutating anything. Report the dirty paths and ask the user to commit or stash. No branch, no transition, no dispatch.
- **Missing or empty Acceptance Criteria** → stop and ask. Never invent the contract.
- **`flight-rules check` fails** → stop and show the report. Fix config or credentials before running.
- **`ticket status` reports the transition is unreachable** → the CLI's error carries an `available:` list. Show it to the user, ask which status they meant, then **write the corrected value back** into `.claude/flight-rules.local.md` so the next run doesn't repeat the mistake. Don't retry blind.
- **Verifier returns `UNVERIFIABLE`** → do not treat it as PASS and do not treat it as FAIL. Surface the criterion and the verifier's question to the user and ask how to proceed. An untestable criterion is usually a ticket bug, not a code bug.
- **Either agent returns `openQuestions`** → surface them unanswered, alongside whatever else that iteration produced.
- **Third consecutive FAIL** → stop. Present the itemized evidence from the final verification, state that three iterations were used, and **leave the branch intact** with the work in place so a human can pick it up. Do not commit, do not push, do not open a PR, and do not move the ticket to in-review. Leave it in the in-progress status — that is now true.
- **`git push` rejected** → stop and report. There is no force flag, and inventing one with raw git is not the fix.

## What Good Looks Like

A reviewer can grade a run against this list:

- The branch name follows the convention `flight-rules git checkout` produces — no hand-cut branches in the history.
- Every commit message is CLI-generated, correctly typed and scoped to the ticket id.
- Only files the implementer reported are in the commit; nothing unrelated rode along.
- The PR body matches the template: summary from the ticket's Solution, the ticket id linked, and test notes carrying the verifier's per-criterion evidence.
- The ticket's status trail reads to-do → in-progress → in-review, with the in-review transition happening *after* the PR exists.
- No acceptance criterion shipped without a PASS verdict backed by evidence, and no acceptance-criteria checkbox was ticked.
- The run summary states the iteration count, and every `charterConcerns` and `openQuestions` entry reached the user.
- The PR is open and unmerged, waiting on a human.
