---
name: execute-work
description: "Drives a single ticket from to-do to PR-in-review: reads it through the flight-rules CLI, branches deterministically, runs the code-implementation and code-verifier agents in a bounded loop, then commits, pushes, opens a PR and moves the ticket. Never merges and never lets an unverified change reach a PR. Use when an engineer or agent picks up a ticket to implement it."
---

# Execute Work

This is the skill that builds the thing. You are handed a **ticket id**; you hand back an open pull request that an independent verifier has already checked, criterion by criterion, against that ticket's Acceptance Criteria. Where `sharpen-the-saw` deliberately stops at a red test suite so a human can implement, this skill carries the work all the way to review.

**The hard rule: this skill never merges, and never lets an unverified change reach a PR.** Those are one rule, not two. The verifier is the gate, and a human is the merge button. If you catch yourself opening a PR on the strength of the implementer's own say-so, stop — you have removed the only independent check in the pipeline.

**Terminal state:** the PR is open and carries an autonomous charter review, the ticket sits in the tracker's in-review status, and the user is holding a run summary they can grade.

## Preconditions

- You are handed a **ticket id**.
- Run everything from the **repo root** (the `flight-rules` CLI resolves config relative to CWD).
- **The config file is `$FLIGHT_RULES_CONFIG` when that variable is set, otherwise `.claude/flight-rules.local.md`.** The CLI honours the override, so every read and write below means whichever path is in effect — reading one file and writing the other would strand your answers where nothing looks for them.
- `flight-rules check` reports `"ok": true`. If it doesn't, fix the environment first — the run mutates tracker state, and a half-configured CLI fails partway through.
- Config carries a **`repo`** field (`owner/repo`). `flight-rules pr create` needs it regardless of tracker — the PR always lands on GitHub — and it throws before parsing a single option when it is missing. On a Jira-tracked repo `repo` is often absent, because the tracker doesn't need it and `skills/setup/SKILL.md` doesn't ask for it. **Step 2 discovers and stores it**, and it must be settled *before* the loop runs: reaching step 7 without it means a pushed branch and no PR.
- The **working tree is clean**. A dirty tree stops the run *before any mutation*: the commit step commits by explicit path, so pre-existing edits to a file the implementer also touched would be swept into the commit silently.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the ticket

```bash
flight-rules ticket get <id>
```

From the returned layered body, extract:

- **Problem Statement** — the why. Context for the implementer, not a contract.
- **Solution** — the intended shape. This grounds the PR body's "Why Was It Changed" section in step 7.
- **Acceptance Criteria** — the contract. This is what the verifier checks and the only definition of done.
- **Guided Walkthrough** — files, patterns, and test approach, when the ticket has one.

Also note the ticket's title (for the branch slug), its labels, and its `metadata` — `metadata.epicId` is how you find the parent epic in step 5.

**If the Acceptance Criteria section is missing or empty, stop and ask the user.** Never infer the contract from the Problem Statement, and never write criteria yourself — a fabricated contract makes the verifier's PASS meaningless. A ticket with no criteria isn't ready; say so and stop.

If the ticket carries the `sharpen-the-saw` label, stop and point the user at `/sharpen-the-saw` instead. That work is reserved for a human.

Confirm the working tree is clean before going further:

```bash
git status --porcelain
```

Any output means stop, per Preconditions. (Read-only git inspection like this is fine; it is *mutations* that must go through `flight-rules`.)

### 2. Resolve the config the run depends on

Three config values decide whether step 7 can finish, and none of them is guaranteed to be there. The skill has to move the ticket twice — into "work started" and into "PR open" — but only the board knows what those statuses are called; and it has to open a PR on GitHub, which needs `owner/repo` even when the tracker is Jira. `Config.inProgressStatus`, `Config.inReviewStatus` and `Config.repo` are all **optional with no defaults**; their absence is precisely the signal to discover and store. Never assume a value.

This step is **discover → ask → store**, and it is interactive **once per repo**. After the first run it is a silent config read.

**Read** `.claude/flight-rules.local.md`. If `inProgressStatus`, `inReviewStatus` and `repo` are all present, use them and move on.

**Discover** the reachable statuses when either status is missing:

```bash
flight-rules ticket transitions <id>
```

It prints something like `{"id":"…","transitions":["In Progress","Done"]}` and mutates nothing.

**That list is not the board.** On **Jira** it is scoped to the ticket's **current** status — only transitions reachable from where the issue sits right now. You are taking this snapshot while the ticket is still in to-do, so on any gated company-managed workflow the in-review status is simply **not in it**; you won't reach that status until step 7. The illustrative list above shows that restrictive case — a permissive team-managed board might return every status at once, but do not count on it. On **GitHub** the list is the repo's existing `status:` labels, lowercased, which is likewise whatever happens to have been used before; a Jira board returns its own capitalisation (`In Review`), so the two trackers legitimately differ in form.

**Discover** `repo` when it is missing — read it from the git remote, read-only:

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
```

**Ask** with `AskUserQuestion`, once per missing field:

- **Always offer a free-text answer**, whatever the discovered list contains. The correct status name may not be in it — see above — and a discovered name that merely *looks* plausible is how a wrong `inReviewStatus` gets stored and a run dies at the final transition. Offer the discovered names as convenience options, never as the closed set.
- When the list is **empty**, that is a valid state, not an error (a fresh GitHub repo has no `status:` labels yet). Free text is then the only answer; explain that the tracker will create the status on first use.
- For `repo`, present what `gh` returned and ask the user to confirm or correct it. It must be exactly `owner/repo` — the CLI splits on `/` and rejects anything else.

Questions to ask: "Which status means work has started?", "Which status means a PR is open and awaiting review? (it may not appear in the list — the tracker only reports statuses reachable from where the ticket sits now)", and "PRs will be opened against `<owner/repo>` — is that right?"

**Store** all the answers in **one** `Write` of `.claude/flight-rules.local.md`, exactly as `skills/setup/SKILL.md` does — one write, not one per field. The new keys go **inside the `---` frontmatter fences**, alongside the existing fields, which you preserve verbatim. Write the whole file:

```markdown
---
tracker: <existing value>
<every other existing field, unchanged>
repo: <owner/repo>
inProgressStatus: <the chosen in-progress status>
inReviewStatus: <the chosen in-review status>
---
```

A key that was already present and correct needs no new value — carry it through unchanged. This is about which keys you *add*, not which keys survive: every existing field stays in the file, and no key appears twice.

The delimiters matter. The config loader reads only the block between the **first** `---` pair at the very start of the file, and the schema is non-strict — so anything written after the closing `---` is silently dropped with no error, and this step would then re-prompt on every single run instead of once.

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
- `--description` — a short kebab slug from the ticket title. It is kebab **because it becomes a branch name**; the commit and the PR in step 7 take prose instead, so don't reuse this token there.
- `--from <base>` — **only** when this work stacks on another in-flight branch; otherwise omit and it branches off current HEAD.

The command prints `{"branch":"…","from":null}`. Keep that branch name — the PR's `--head` needs it.

### 5. Assemble the implementation dispatch

Build the brief you will hand `code-implementation`. It gets exactly:

- **The ticket's full layered body** — Problem Statement, Solution, Acceptance Criteria, and the Guided Walkthrough when present. Don't summarize it; the agent is a lower-tier model and paraphrase loses the contract.
- **A pointer to the coding charter**: `${CLAUDE_PLUGIN_ROOT}/docs/coding-charter.md`. Pass the path, not your précis of it — the agent is required to read it in full.
- **Parent RFC / TDD content, when the ticket links one.** Read the parent epic for the technical writeup, using the `metadata.epicId` you noted in step 1:

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

**Set the model by iteration.** `Agent`'s `model` parameter overrides the agent's frontmatter, so pass it explicitly on the dispatch:

| Iteration | `model` |
|---|---|
| 1 | *omit* — inherits `sonnet` from frontmatter |
| 2 | *omit* — inherits `sonnet` from frontmatter |
| 3 (final) | `opus` |

Sonnet is the tier this pipeline is built around: `break-down-work` writes each ticket's Guided Walkthrough so a Sonnet-tier agent can build from it, and a first attempt against a good walkthrough is exactly the case that choice was made for. But by iteration 3 the verifier has rejected the work twice with itemized reasons, and re-running the same tier against the same criteria is close to a coin flip. Escalate rather than spend the last of a hard-capped three on a repeat.

This is bounded by construction — it can only fire on a ticket that has already failed verification twice, so the happy path never leaves sonnet. Do **not** escalate early on a hunch that the ticket looks hard; the retry count is the only signal.

**The verifier stays on sonnet at every iteration**, including against an escalated implementer. That asymmetry is deliberate: the verifier checks explicit acceptance criteria and reports per-criterion verdicts with evidence — it checks a stated contract rather than synthesizing one — and a cheap gate is a feature, not a compromise. Never pass `model` on a `code-verifier` dispatch.

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

Keep `filesChanged[].path` — the commit step stages and commits exactly that set, and the implementer leaves its edits unstaged, so a path it forgot to report is a path that does not ship. If `openQuestions` is present, see Error handling: it goes to the user, unanswered.

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

**c. Read `verified`, then branch in this order:**

1. **`verified: true`** → exit the loop and ship (step 7).
2. **Any `UNVERIFIABLE` verdict** → **stop and ask the user**, before spending another iteration. UNVERIFIABLE takes precedence over FAIL. The verifier also reports `verified: false` in this case, so do not let that pull you into a retry: an UNVERIFIABLE criterion is untestable *as written*, which is a ticket bug the implementer cannot fix with code. Re-dispatching burns an iteration of a hard-capped three and changes nothing.
3. **FAIL only, no UNVERIFIABLE** → iterate. Go back to (a) with the FAIL evidence, unless you have already used three iterations, in which case stop (see Error handling).

Only a FAIL-only result iterates.

Three iterations is a **hard ceiling**, not a target. Do not restart the count, do not run a "quick fourth fix yourself", and never overrule a FAIL because you disagree with the verifier.

### 7. Ship it

Only once `verified: true`.

**Commit.** Stage by explicit path. Passing any `--file` scopes the commit to exactly those paths, so an unrelated stray edit cannot ride along; **omitting `--file` entirely commits the whole index**, which is why you always pass it. Repeat `--file` once per path:

```bash
flight-rules git commit --type <type> --scope <id> --description "<description>" --file <path> --file <path>
```

`<description>` is **prose, not the kebab slug from step 4** — an imperative phrase like `add ticket transitions command`, matching the commit history. `feat(KAN-35): add-execute-work-orchestrator` is the shape to avoid; the branch is the only place kebab belongs.

The `--file` set is the **union of `filesChanged[].path` across every iteration**, not just the last one. Each dispatch reports only what *that* dispatch touched, so a retry's list is a subset. Iteration 1 might create a module and its test; iteration 2 fixes only the module and reports only the module — staging that alone would ship the fix without the test, so the PR diff would no longer be the tree the verifier passed. Accumulate the paths as you go, and de-duplicate.

Never use a Claude Code auto-generated commit. The CLI owns the message format.

**If the change touches `src/`, rebuild the bundle before committing** and add it to the `--file` set:

```bash
npm run build
```

`bin/flight-rules.mjs` is a tracked build artifact this repo commits deliberately. CI builds but never diffs the result, so a PR that changes `src/` without rebuilding ships a bundle contradicting its own diff — and the stale binary is what anyone running the CLI from this branch actually executes.

Then confirm you committed everything:

```bash
git status --porcelain
```

It must be **empty**. Any remaining output — unstaged *or* staged — means the verified tree is wider than what you committed, so stop and reconcile before pushing rather than opening a PR that doesn't match what was verified. This check has teeth because the CLI commits with `git commit --only -- <paths>`: a path the implementer left behind, or staged without reporting, is excluded from the commit and therefore still visible here. It cannot be swept in silently.

**Push.** The command resolves the branch from HEAD and sets upstream by default:

```bash
flight-rules git push
```

There is no force flag. If the push is rejected, stop and tell the user — do not reach for raw git to get around it.

**Write the PR body — dispatch the `tech-writer` agent in `author` mode.** The
body is not yours to hand-write; a human reads it, so a human's editor writes it.
The format is `${CLAUDE_PLUGIN_ROOT}/docs/pr-body-format.md`. Hand the agent:

- **The ticket's Problem Statement and Solution** — the grounding for "Why Was It Changed."
- **A summary of the diff** — `git diff --stat <default-branch>..<branch>` and `git log <default-branch>..<branch> --format='%s'`, both read-only, so it describes what actually shipped rather than what the ticket wished for.
- **The verifier's per-criterion evidence** — the raw material for "What Was Changed" and, absent screenshots, for the OTS Materials block.
- **The audience** — "a reviewer deciding whether to merge, and a QA/PM confirming the ask was built."

It returns YAML with `whatWasChanged` (1-5 bullets), `whyWasItChanged` (prose,
which may embed a Mermaid or `diff`-fenced diagram when the change has a shape),
and optionally `otsMaterials`. Pass the `whyWasItChanged` value through `--why`
verbatim — fences and all; GitHub renders them in the PR body. Surface any
`openQuestions` it raises to the user with the run summary; do not answer them on
its behalf.

**Open the PR.** The base is the repository's default branch — read it read-only, and ask for the bare string rather than a nested object:

```bash
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
```

Build the **ticket URL** from config: Jira is `https://<jiraHost>/browse/<id>`; a
GitHub-tracked repo is `https://github.com/<repo>/issues/<id>`. The head is the
branch `git checkout` printed in step 4. Pass each `whatWasChanged` bullet as its
own repeated `--what`:

```bash
flight-rules pr create --type <type> --scope <id> --description "<description>" --why "<whyWasItChanged>" --what "<bullet>" --what "<bullet>" --ticket-id <id> --ticket-url <url> --base <default-branch> --head <branch>
```

- `--description` — the same prose phrase as the commit, since it becomes the PR title. Not the kebab branch slug.
- `--why` — the agent's `whyWasItChanged` prose, verbatim. Grounded in the ticket, phrased for a human.
- `--what` — one per `whatWasChanged` bullet, repeated. The schema caps these at five bullets of 256 characters; if the agent somehow overran, it re-runs, you do not truncate by hand.
- `--ots` — the agent's `otsMaterials`, when present. Omit the flag entirely when it isn't.
- `--ticket-url` — the link the reviewer follows back to the ticket.

**Move the ticket:**

```bash
flight-rules ticket status <id> --to "<inReviewStatus>"
```

Then **stop.** Do not merge. Do not approve your own PR.

### 8. Review the PR

Invoke the **`autonomous-code-review`** skill against the PR you just opened. It is unattended and it never edits code — it posts a `COMMENT` review enumerating every objective charter violation on the diff, and ends in a machine-readable `verdict` of `ESCALATE` or `CLEAR`.

Hand it three things:

- **The PR number or URL** from `pr create`.
- **The verifier's `charterConcerns`**, verbatim. This is the step where they stop being a line in a run summary and start being review comments on the diff. The reviewer confirms each one against the PR before raising it, so passing a concern is not asserting it.
- **Any `UNVERIFIABLE` criteria or `openQuestions`** still outstanding. They force `ESCALATE` on their own.

Run this **after** the in-review transition, not before. The review is commentary on a PR that already exists and is already on the board; sequencing it earlier only widens the window where the ticket's status lies about reality.

**The verdict does not gate anything here.** `ESCALATE` doesn't reopen the loop and `CLEAR` doesn't approve anything — this skill's terminal state is unchanged either way. The verdict is a routing hint for whoever picks the PR up, and you pass it through to the report.

If the review fails to post, report that and carry on to step 9. A failed review is a missing signal, not a failed run: the PR is open, verified, and on the board, and re-running the review costs nothing. Do not retry the loop, and do not roll back the ticket status.

### 9. Report

Give the user, in this order:

- **Iterations used** — 1, 2, or 3. Say it plainly; it is the honest signal of how hard this was.
- **Per-criterion verdicts** — every criterion with its verdict and the verifier's evidence, including any `UNVERIFIABLE`.
- **The PR URL**, and the branch name.
- **The review verdict** — `ESCALATE` or `CLEAR`, its reasons, and the finding counts. Say plainly whether a human still needs to run `guided-code-review`.
- **Every `charterConcerns` entry** the verifier raised, verbatim. These didn't block the PR — so don't quietly drop them, even where the review picked them up.
- **Any `openQuestions`** from either agent, still unanswered.

## Guardrails

- **Maximum 3 loop iterations, hard.** No restarting the count, no fourth attempt under another name.
- **The implementer escalates to opus only on iteration 3, and the verifier never escalates.** Iterations 1 and 2 run the frontmatter default. A ticket that "looks hard" is not a reason to escalate early — two recorded FAILs is the only one.
- **Never merge.** This skill opens a PR and stops. Merging is a human decision.
- **Never let an unverified change reach a PR.** `verified: true` is the only key that unlocks step 7.
- **The autonomous review's verdict gates nothing.** `ESCALATE` does not reopen the implement/verify loop, `CLEAR` does not approve anything, and neither changes where this skill stops. Acting on a review finding here would put an unverified edit on the branch after the verifier signed off.
- **Never tick acceptance-criteria checkboxes.** The `items[].done` flags are read-only to this skill; the verifier's itemized verdict is the record of what passed. A ticked box in a tracker is a claim nobody checked.
- **All git and tracker mutations go through `flight-rules`.** Never hand-rolled `git commit`/`checkout`/`push`, never Claude Code auto-generated commits, never native tracker APIs (`gh issue edit`, the Jira REST API) for state changes. Read-only inspection with plain `git` or `gh` is fine.
- **`openQuestions` and `UNVERIFIABLE` always reach the user, unanswered.** The agents ask when they are genuinely unsure. Answering on their behalf converts a flagged unknown into a silent guess — which is the exact failure the loop exists to prevent.
- **Never overrule the verifier.** A FAIL you disagree with is still a FAIL. Feed it back to the implementer or stop.

## Error handling

- **Dirty working tree** → stop before mutating anything. Report the dirty paths and ask the user to commit or stash. No branch, no transition, no dispatch.
- **Missing or empty Acceptance Criteria** → stop and ask. Never invent the contract.
- **`flight-rules check` fails** → stop and show the report. Fix config or credentials before running.
- **`ticket status` reports the transition is unreachable** → the CLI's error carries an `available:` list. Show it to the user, ask which status they meant, then **write the corrected value back** into `.claude/flight-rules.local.md` so the next run doesn't repeat the mistake. Don't retry blind.
- **Verifier returns `UNVERIFIABLE`** → do not treat it as PASS and do not treat it as FAIL, and **do not iterate**. Stop before spending another iteration, surface the criterion and the verifier's question to the user, and ask how to proceed. An untestable criterion is usually a ticket bug, not a code bug — another implementation pass cannot fix it. This takes precedence over any FAIL in the same result.
- **Either agent returns `openQuestions`** → surface them unanswered, alongside whatever else that iteration produced.
- **Third consecutive FAIL** → stop. Present the itemized evidence from the final verification, state that three iterations were used, and **leave the branch intact** with the work in place so a human can pick it up. Do not commit, do not push, do not open a PR, and do not move the ticket to in-review. Leave it in the in-progress status — that is now true.
- **`git push` rejected** → stop and report. There is no force flag, and inventing one with raw git is not the fix.
- **`pr create` fails on `repo`** — either `repo (owner/repo) is required in config to create pull requests` or `Invalid repo format …`. This is a config error, not a work error, and by the time you see it **the commit has landed and the branch is pushed**. So: fix `repo` in `.claude/flight-rules.local.md` (confirm the value with the user first) and re-run **only** the `pr create` command, then carry on to the in-review transition. Do **not** redo the implement/verify loop, do not re-commit, and do **not** fall back to raw `gh pr create` — that bypasses the PR template, so the body would lose the authored What/Why sections, the OTS Materials block and the ticket link, which is the whole point of routing through the CLI. Re-run `pr create` with the same authored fields the tech-writer produced — don't re-summon the agent and don't hand-write a body. If the user can't supply a valid `owner/repo`, stop and report the branch name and commit sha so the PR can be opened by hand.
- **`autonomous-code-review` fails to post** → report it in step 9 and finish the run. By this point the PR is open, the work is verified and the ticket has moved, so the review is the only thing missing and it can be re-run against the PR at any time. Do not retry the implement/verify loop, do not roll the ticket status back, and do not withhold the run summary.

## What Good Looks Like

A reviewer can grade a run against this list:

- The branch name follows the convention `flight-rules git checkout` produces — no hand-cut branches in the history.
- Every commit message is CLI-generated, correctly typed and scoped to the ticket id.
- The commit contains exactly the union of the paths the implementer reported across all iterations: nothing unrelated rode along, and nothing the verifier passed was left behind. The working tree is clean afterwards.
- The PR body matches `docs/pr-body-format.md`: tech-writer-authored What/Why sections, the ticket linked, and — when present — an OTS Materials block carrying the verifier's evidence or real output.
- The ticket's status trail reads to-do → in-progress → in-review, with the in-review transition happening *after* the PR exists.
- No acceptance criterion shipped without a PASS verdict backed by evidence, and no acceptance-criteria checkbox was ticked.
- The run summary states the iteration count, and every `charterConcerns` and `openQuestions` entry reached the user.
- Iterations 1 and 2 ran the implementer at its default tier; opus appears only if a third iteration was reached, and never on the verifier.
- The PR carries a submitted `COMMENT` review from `autonomous-code-review`, posted after the in-review transition, and the run summary states its verdict.
- The PR is open and unmerged, waiting on a human.
