---
name: execute-work
description: "Drives a single ticket from to-do to PR-in-review: reads it through the flight-rules CLI, branches deterministically, runs the code-implementation and code-verifier agents in a bounded loop, then opens a PR and privately reviews it with verifier-triaged remediation. Never merges and never lets an unverified change reach a PR. Use when an engineer or agent picks up a ticket to implement it."
---

# Execute Work

This is the skill that builds the thing. You are handed a **ticket id**; you hand back an open pull request that an independent verifier has already checked, criterion by criterion, against that ticket's Acceptance Criteria. Where `sharpen-the-saw` deliberately stops at a red test suite so a human can implement, this skill carries the work all the way to review.

**The hard rule: this skill never merges, and never lets an unverified change reach a PR.** Those are one rule, not two. The verifier is the gate, and a human is the merge button. If you catch yourself opening a PR on the strength of the implementer's own say-so, stop — you have removed the only independent check in the pipeline.

**Terminal state:** the PR is open, the ticket sits in the tracker's in-review status, and the caller has the private review, triage decisions and verification evidence. No self-review is published on the PR. An incomplete review or unresolved remediation is reported explicitly to the caller.

## Orchestration context

Read `flight-rules doc orchestration-interface` and `flight-rules doc native-orchestration` before dispatch. Initialize one run context with the ticket ID, unique run ID, active checkout root, working directory, fixed base and attempt 1, or preserve the context supplied by `execute-wave`. Select agents by registry name through `dispatch`, validate each role report with its original request identity, and retain the paired receipts across retries. An unavailable dispatch is a named stop, never inline replacement work.

Human questions require invocation-level `allowHumanQuestions: true` and supported `ask`; otherwise every instruction below to ask means return `QUESTIONS_DISABLED` or `QUESTIONS_UNAVAILABLE` with the unresolved question. When opted in, wait for an actual answer before dependent work. Existing user answers and authorizations remain valid; do not ask again for an already settled decision. Invoke sibling skills in this caller context, without adding a worker nesting level.

## Preconditions

- You are handed a **ticket id**, and optionally a **base branch**. `execute-wave` supplies the base when it drives you as one ticket of a wave; a human invoking you directly normally doesn't.
- The session may start outside the repository, such as in `~/Developer`. Run each repository-specific command from the target **repo root**, using the tool’s working-directory option or `cd <repo> && <command>`. This includes the parent’s preflight, tracker, Git and PR commands; changing only a worker’s directory is insufficient. Initialize task context for that repository and give workers the same target path. No session restart is needed.
- **Read and write config only through the CLI.** Config can live in several places that the CLI merges key by key: the user's `~/.claude/settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json` (each under `pluginConfigs["flight-rules@flight-rules"].options`), and the config file that `flight-rules config path` prints. `flight-rules config show` prints the merged values and where each came from; `flight-rules config set` writes one. Never hand-edit any of these files — a value written to the wrong layer is shadowed by another and silently ignored.
- Before the first repository or tracker mutation, run `flight-rules check --workflow execute-work` and require `"ok": true` for the workflow’s environment checks. Resolve failed required checks before continuing. Use the native harness for permissions and worker dispatch; no runtime evidence file is required.
- Config carries a **`repo`** field (`owner/repo`). `flight-rules pr create` needs it regardless of tracker — the PR always lands on GitHub — and it throws before parsing a single option when it is missing. On a Jira-tracked repo `repo` is often absent, because the tracker doesn't need it and `skills/setup/SKILL.md` doesn't ask for it. **Step 2 discovers and stores it**, and it must be settled _before_ the loop runs: reaching step 7 without it means a pushed branch and no PR.
- The **working tree is clean**. A dirty tree stops the run _before any mutation_: the commit step commits by explicit path, so pre-existing edits to a file the implementer also touched would be swept into the commit silently.
- **Ariadne reporting is optional.** The `flight-rules board post` lines below report the run to Ariadne's Agents page. When Ariadne is not configured, or the ticket is not a Jira key, they print nothing and exit 0. A failed post prints one line and still exits 0. Never retry one, wait on one, or let its output change the run.

### Plain-git mode

Some harnesses refuse any command that runs git on the agent's behalf; a worktree-isolated session rejects `flight-rules git …` because it cannot see which directory the CLI's git targets. When a `flight-rules git` command is refused that way, switch to these equivalents for the rest of the run. Everything else in this skill stays the same, and the message and branch name are still the CLI's.

- **Branch (step 4).** Get the name, then either take over a disposable worktree branch or create one:

  ```bash
  flight-rules branch-name --type <type> --scope <id> --description <slug>
  git rev-list --count HEAD --not --exclude="$(git rev-parse --abbrev-ref HEAD)" --branches --remotes
  ```

  If that count is `0`, the current branch has no upstream, it is not the default branch, and no `--from` base was given (or HEAD already sits on it), rename it: `git branch -m <branch>`. Otherwise `git checkout -b <branch> [<base>]`.

- **Commit (step 7).** Write the message with the CLI, then commit that file by path:

  ```bash
  flight-rules commit-message --type <type> --scope <id> --description "<description>" --body-file "$TMPDIR/<id>-commit.md"
  git add -- <path> <path>
  git commit --cleanup=whitespace -F <printed path> --only -- <path> <path>
  ```

  The commit guard lets this through because the file carries the CLI's `Flight-Rules-Version` trailer. Use the same `<path>` set the CLI form would take.

- **Push (step 7).** `git push --set-upstream origin <branch>`. There is still no force push.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the ticket

```bash
flight-rules ticket get <id>
```

First settle which format the ticket is in. Read `issueType` from the returned JSON: `Bug` is a bug report, anything else is a layered body. `metadata.kind` overrides that when present (`bug` or `layered-body`). If neither is set, sniff the first level-2 heading: `## Symptom` is a bug report, `## Problem Statement` is a layered body. Say which format you settled on; every later step keys off it.

**Layered body** — extract:

- **Problem Statement** — the why. Context for the implementer, not a contract.
- **Solution** — the intended shape. This grounds the PR body's "Why Was It Changed" section in step 7.
- **Acceptance Criteria** — the contract. This is the original contract the verifier checks; step 8 adds accepted review fixes without changing it.
- **Guided Walkthrough** — files, patterns, and test approach, when the ticket has one.

**Bug report** — extract:

- **Symptom** — the why; context, not a contract.
- **Environment** — the host, build, account, and browser the bug was seen on.
- **Steps To Reproduce** — what the reproduction did; the implementer re-runs it to see the bug.
- **Expected vs Actual** — the gap, stated plainly.
- **Root Cause** — where the reproduction points; trust the code over it on conflict.
- **Fixed When** — the contract. This is the original contract the verifier checks; step 8 adds accepted review fixes without changing it.
- **Reproduction Notes** — the collapsed agent-facing block: the API calls that carry the symptom, the selectors, the data setup. It plays the Guided Walkthrough's role for the implementer.

Also note the ticket's title (for the branch slug), its labels, and its `metadata` — `metadata.epicId` is how you find the parent epic in step 5.

**If the contract section for this format is missing or empty — Acceptance Criteria on a layered body, Fixed When on a bug report — stop and ask the user.** Never infer the contract from the Problem Statement or the Symptom, and never write criteria yourself — a fabricated contract makes the verifier's PASS meaningless. A ticket with no contract isn't ready; say so and stop.

**The ticket is the source of truth.** Run as if you were on a fresh machine with only this repo's clone, the tracker, and the URLs the ticket links to. Your context comes from the ticket, its parent epic and initiative, and the published artifacts they link (step 5). Nothing else. Scan the body for a reference that does not resolve that way:

- an absolute or home path (`/Users/…`, `/home/…`, `~/…`) or a `file://` URL;
- a repo-relative path that neither exists in this clone nor is a file the ticket asks you to create;
- a pointer to something unwritten: "per the planning doc", "see decisions.md", or a decision ID that no body or artifact defines.

**On any of these, stop and report a ticket defect.** Name each unresolvable reference and say the ticket needs it inlined or published (see the Portable context section of `flight-rules doc layered-body-format`). Do not look for the file on this machine, even if it happens to exist. A run that works only on the author's laptop hides the defect from the next engineer.

If the ticket carries the `sharpen-the-saw` label, stop and point the user at `/sharpen-the-saw` instead. That work is reserved for a human.

Confirm the working tree is clean before going further:

```bash
git status --porcelain
```

Any output means stop, per Preconditions. (Read-only git inspection like this is fine; it is _mutations_ that must go through `flight-rules`.)

### 2. Resolve the config the run depends on

Three config values decide whether step 7 can finish, and none of them is guaranteed to be there. The skill has to move the ticket twice — into "work started" and into "PR open" — but only the board knows what those statuses are called; and it has to open a PR on GitHub, which needs `owner/repo` even when the tracker is Jira. `Config.inProgressStatus`, `Config.inReviewStatus` and `Config.repo` are all **optional with no defaults**; their absence is precisely the signal to discover and store. Never assume a value.

This step is **discover → ask → store**, and it is interactive **once per repo**. After the first run it is a silent config read.

**Read** the merged config with `flight-rules config show`. If `values.inProgressStatus`, `values.inReviewStatus` and `values.repo` are all present, use them and move on.

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

**Ask the human and wait for an answer**, once per missing field:

- **Always offer a free-text answer**, whatever the discovered list contains. The correct status name may not be in it — see above — and a discovered name that merely _looks_ plausible is how a wrong `inReviewStatus` gets stored and a run dies at the final transition. Offer the discovered names as convenience options, never as the closed set.
- When the list is **empty**, that is a valid state, not an error (a fresh GitHub repo has no `status:` labels yet). Free text is then the only answer; explain that the tracker will create the status on first use.
- For `repo`, present what `gh` returned and ask the user to confirm or correct it. It must be exactly `owner/repo` — the CLI splits on `/` and rejects anything else.

Questions to ask: "Which status means work has started?", "Which status means a PR is open and awaiting review? (it may not appear in the list — the tracker only reports statuses reachable from where the ticket sits now)", and "PRs will be opened against `<owner/repo>` — is that right?"

The repo question is closed, so also post it to Ariadne when you ask it in chat:

```bash
flight-rules board post item --skill flight-rules:execute-work --kind question --ticket <id> --title "Open PRs against <owner/repo>?" --option Yes --option No
```

The first answer wins. If the person says they answered in Ariadne, read the answer from `chosenOption` in `flight-rules board items --ticket <id> --json`. A `No` still needs the right `owner/repo` from chat.

**Store** each answer with `flight-rules config set`, one call per field:

```bash
flight-rules config set repo "<owner/repo>"
flight-rules config set inProgressStatus "<the chosen in-progress status>"
flight-rules config set inReviewStatus "<the chosen in-review status>"
```

Without `--scope`, each value lands where the key already lives, else in the config file when one exists, else in `.claude/settings.local.json`. That default is right for `repo`, which is per project. Status names belong to the board, and a board is usually shared across repos, so when no layer holds them yet, ask the user whether to store them for every project (`--scope user`) or just this one. If the command's JSON carries a `warning`, a higher-precedence layer still holds an older value — show the warning and offer to `flight-rules config unset <key> --scope <that scope>`.

Confirm with `flight-rules config show` that the merged values are the ones you stored; a re-prompt on the next run means the write was shadowed.

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
- `--from <base>` — pass it in two cases: when this work stacks on another in-flight branch, or when **the caller supplied a base branch**. Otherwise omit it and the branch is cut from current HEAD.

  The caller-supplied case exists because `git checkout -b <branch> <from>` cuts from the named base _regardless of where HEAD currently sits_. When `execute-wave` runs you as the third ticket of a wave, HEAD is still on the second ticket's branch — so omitting `--from` would silently stack ticket three on ticket two, and its PR diff would carry the previous ticket's commits. Passing the base makes each ticket in a wave branch from the same place.

The command prints `{"branch":"…","from":null,"renamedFrom":null}`. Keep that branch name — the PR's `--head` needs it. In a linked worktree whose branch is disposable (no upstream, no commits of its own, not the default branch, and at `--from` when given), the command renames that branch instead of stacking a new one on it, and `renamedFrom` names the old branch.

### 5. Assemble the implementation dispatch

Build the brief you will hand `code-implementation`. It gets exactly:

- **The ticket's full body, in whichever format step 1 settled** — every section, including the Guided Walkthrough on a layered body or the Reproduction Notes on a bug report. Don't summarize it; the agent is a lower-tier model and paraphrase loses the contract.
- **Pointers to the coding charters**: run this command in the repository and pass every printed path — the core charter plus the language charter for each language in the repository. The agent must read them in full, not your précis.

  ```bash
  flight-rules charter --repo --path
  ```

- **Parent RFC / TDD content, when the ticket links one.** Read the parent epic for the technical writeup, using the `metadata.epicId` you noted in step 1:

  ```bash
  flight-rules epic get <epicId>
  ```

  On **Jira** the epic payload does **not** resolve `tdd` — `getEpic` omits it. So when the tracker is Jira and the epic's `metadata.tddId` is set, fetch the design separately:

  ```bash
  flight-rules tdd get <tddId>
  ```

  On GitHub the epic payload already carries `tdd`, so no second call is needed. Include only the parts that bear on this ticket.

- **The parent initiative and any other linked artifact.** The epic payload does not name its initiative. Find it on the `**Context:**` line that opens the High-level technical writeup of the ticket or epic, then read it:

  ```bash
  flight-rules initiative get <initiativeId>
  ```

  Fetch any other artifact that line links: a design by `flight-rules tdd get <id>`, a GitHub file or Discussion URL with `gh`. Include only what bears on this ticket. When a link cannot be fetched, stop and report it the way step 1 reports a ticket defect.

Do not include your own opinion on how to build it. The walkthrough and the charter are the guidance; anything you add is a third voice the agent has to reconcile.

### 6. The implement / verify loop — hard maximum 3 iterations

Dispatch the two agents in strict alternation. Count iterations out loud; you will report the count. Follow `VerifiedImplementationLoop` from the shared contract: `next` derives the implementation request from paired receipts and `verify` derives the independent verifier request. Native parents apply the same transitions through their available dispatch tools. Use the native harness for dispatch and handle its access or capacity errors; three attempts never imply three concurrent workers or three levels of nesting.

**a. Dispatch the implementer selected in the table below** with the brief from step 5. Report the step first, with `--state caution` on iterations 2 and 3:

```bash
flight-rules board post heartbeat --ticket <id> --step implement --state nominal --branch <branch> --skill flight-rules:execute-work
```

Then dispatch. On **iterations 2 and 3**, add the previous verifier's itemized FAIL entries **verbatim** — the criterion, the verdict, and the evidence exactly as the verifier wrote them. That evidence _is_ the definition of what still needs fixing; rewriting it in your own words is how a retry loses the thread.

**Select the agent by iteration.** The agent's declared tier is mapped by the host adapter; dispatch by name without overriding its model.

| Iteration | Agent | Tier |
| --------- | ----- | ---- |
| 1 | `code-implementation` | standard |
| 2 | `code-implementation` | standard |
| 3 (final) | `code-implementation-escalated` | escalated |

The standard tier is what this pipeline is built around: `break-down-work` writes each ticket's Guided Walkthrough so a standard-tier agent can build from it. By iteration 3 the verifier has rejected the work twice with itemized reasons. Use the escalated registration for that final attempt rather than repeat the same tier against the same unresolved criteria.

This is bounded by construction: escalation requires two recorded verifier rejections. Do **not** escalate early on a hunch that the ticket looks hard; the retry count is the only signal.

**Always dispatch `code-verifier` itself at every iteration**, including against an escalated implementer. It stays at its declared standard tier: checking explicit acceptance criteria with evidence is a different task from synthesizing an implementation. The verifier does not escalate.

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

**b. Dispatch `code-verifier`** with the contract, fetched fresh and structured. Report the step first, with `<n>` the iteration number:

```bash
flight-rules board post heartbeat --ticket <id> --step "verify <n>/3" --state nominal --branch <branch> --skill flight-rules:execute-work
```

Fetch the contract section for the ticket's format:

```bash
flight-rules ticket get <id> --section acceptance-criteria
```

for a layered body, or

```bash
flight-rules ticket get <id> --section fixed-when
```

for a bug report. Either returns `{id, section, markdown, items:[{text,done}]}`. Compare the items to the original ordered contract from step 1; a changed contract stops this run for a caller decision, rather than silently changing what a retry must satisfy. Hand the verifier the original criteria and the union of changed paths across attempts as `filesChanged: [{ path }]` — **not** the implementer's `summary`, `approach`, `testsRun` or change descriptions. Require the verifier to quote every criterion exactly once, in its original order, so each verdict binds to its criterion without interpreting a paraphrase. A verifier that has read the implementer's victory lap is not an independent check.

Use a fresh worker context for every verification. Do not fork the parent's conversation or resume an implementation worker as the verifier: inherited history would leak the implementation rationale even when the explicit brief is clean. If the host cannot isolate the verifier's context, stop with `DISPATCH_UNAVAILABLE` and the isolation requirement.

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

**c. Validate the report and handoff before reading `verified`:** reject mismatched context/attempt, missing or altered criteria, and a `verified` flag that disagrees with the itemized verdicts. Malformed or failed execution is a named stop, not a verifier FAIL. Surface any `openQuestions` and stop before shipping or retrying. Then branch in this order:

1. **`verified: true`** → exit the loop and ship (step 7).
2. **Any `UNVERIFIABLE` verdict** → **stop and ask the user**, before spending another iteration. UNVERIFIABLE takes precedence over FAIL. The verifier also reports `verified: false` in this case, so do not let that pull you into a retry: an UNVERIFIABLE criterion is untestable _as written_, which is a ticket bug the implementer cannot fix with code. Re-dispatching burns an iteration of a hard-capped three and changes nothing.
3. **FAIL only, no UNVERIFIABLE** → iterate. Go back to (a) with the FAIL evidence, unless you have already used three iterations, in which case stop (see Error handling).

Only a FAIL-only result iterates.

Three iterations is a **hard ceiling**, not a target. Do not restart the count, do not run a "quick fourth fix yourself", and never overrule a FAIL because you disagree with the verifier.

### 7. Ship it

Only once `verified: true`.

**Capture the evidence.** Decide whether this change has a visible surface. Read the ticket's Solution, its contract items, and its Guided Walkthrough or Reproduction Notes, and look at the union of `filesChanged[].path`: client or UI paths, or a contract item that names something a user sees, mean yes. A backend change still counts when its consequence renders somewhere — an endpoint that now returns a differently formatted string has a visible surface on the page that shows it, so that page is what you capture. The repo's QA instructions often say which page shows which backend change; read them with `flight-rules qa instructions --from <directory of the changed code>`. When they report `"found": false`, or describe no web surface for this change, there is nothing to capture. Write two or three lines of **capture directions**: which screen, what to do, and whether the take is before-and-after (a bug) or after-only (a story).

When there is a visible surface, report the QA step:

```bash
flight-rules board post heartbeat --ticket <id> --step qa --state nominal --branch <branch> --skill flight-rules:execute-work
```

Then invoke the `capture-evidence` skill with the directions, the ticket id, and the directory of the changed code as `from`. It drives the app, writes screenshots and video under the directory `flight-rules qa evidence-dir <ticket>` prints, and returns an evidence manifest: one entry per file with `path`, `kind` (`image` or `video`), `phase` (`before` or `after`), and `caption`. Keep the manifest; step 7 hands it to the PR body and the ticket comment, and step 9 reports it.

When there is no visible surface, write one line instead: `No visual evidence: <reason>` — for example `No visual evidence: API-only change with no UI consequence.` That line travels everywhere the manifest would have.

When capture fails on a visible change, write `No visual evidence: capture failed — <reason>` and carry on. The verifier already passed this tree; a missing picture is a missing signal, not a failed run. Do not re-run the loop and do not stop the ship.

The evidence directory is gitignored, or outside this worktree entirely when running in a linked worktree, so nothing from it shows in `git status --porcelain` and nothing from it ever goes in the `--file` set below.

**Commit.** Report the PR step first:

```bash
flight-rules board post heartbeat --ticket <id> --step pr --state nominal --branch <branch> --skill flight-rules:execute-work
```

Stage by explicit path. Passing any `--file` scopes the commit to exactly those paths, so an unrelated stray edit cannot ride along; **omitting `--file` entirely commits the whole index**, which is why you always pass it. Repeat `--file` once per path.

**Always write a body.** A squash merge builds the PR's merge message from the commit messages, so a commit with no body reaches the default branch as a subject and a pile of `Flight-Rules-Version` trailers. Write the body to a file outside the repo, for example `$TMPDIR/<id>-commit.md`, and pass it with `--body-file`. Use a file rather than `--body "…"` so newlines, backticks, and `$` survive without shell escaping. The body says what changed and why, in a few short paragraphs or a bullet list: the behaviour the ticket asked for, the approach and any non-obvious choice, and the ticket id. Take it from the ticket and the implementer's report. Do not paste the diff or the verifier's checklist. Do not add trailers to the file either; the CLI appends them.

```bash
flight-rules git commit --type <type> --scope <id> --description "<description>" --body-file "$TMPDIR/<id>-commit.md" --file <path> --file <path>
```

`<description>` is **prose, not the kebab slug from step 4** — an imperative phrase like `add ticket transitions command`, matching the commit history. `feat(KAN-35): add-execute-work-orchestrator` is the shape to avoid; the branch is the only place kebab belongs.

The `--file` set is the **union of `filesChanged[].path` across every iteration**, not just the last one. Each dispatch reports only what _that_ dispatch touched, so a retry's list is a subset. Iteration 1 might create a module and its test; iteration 2 fixes only the module and reports only the module — staging that alone would ship the fix without the test, so the PR diff would no longer be the tree the verifier passed. Accumulate the paths as you go, and de-duplicate.

Never use a Claude Code auto-generated commit. The CLI owns the message format.

**If the change touches `src/`, rebuild before committing** to validate the CLI and native packages:

```bash
npm run build
```

In flight-rules, release preparation owns `bin/`, `dist/`, the generated review JSON schemas and root plugin catalogs/manifests. Catalog templates live under `adapters/`. Commit canonical sources only: omit generated paths from the `--file` set. CI builds them and rejects added or modified artifacts in source PRs. Release commits may track those ignored files, so a local rebuild can still show generated changes in git status; leave those changes out of source commits.

Then confirm you committed everything:

```bash
npm run check:source-status
```

For flight-rules, this must pass: it ignores release-owned output and rejects remaining canonical source changes, staged or unstaged, including untracked source files. In repositories without that script, use `git status --porcelain` and reconcile remaining changes according to their artifact policy. The CLI commits with `git commit --only -- <paths>`: a path the implementer left behind, or staged without reporting, is excluded from the commit and still needs reconciliation.

**Push.** The command resolves the branch from HEAD and sets upstream by default:

```bash
flight-rules git push
```

There is no force flag. If the push is rejected, stop and tell the user — do not reach for raw git to get around it.

**Write the PR body — dispatch the `tech-writer` agent in `author` mode.** The
body is not yours to hand-write; a human reads it, so a human's editor writes it.
Run `flight-rules doc pr-body-format` and read the full output. Resolve the required document paths before dispatch:

```bash
flight-rules doc prose-charter --path
flight-rules doc claudeish-tells --path
flight-rules doc pr-body-format --path
```

Also resolve the optional style reference when available:

```bash
flight-rules doc google-style-digest --path
```

Pass the printed paths, labelled by document id. The agent has read-only tools and must read the required files in full.
It reads the optional digest in full only when needed. If a required path cannot be resolved, stop and report the error.

Hand the agent:

- **The resolved document paths.**

- **The ticket's Problem Statement and Solution** — the grounding for "Why Was It Changed."
- **A summary of the diff** — `git diff --stat <default-branch>..<branch>` and `git log <default-branch>..<branch> --format='%s'`, both read-only, so it describes what actually shipped rather than what the ticket wished for.
- **The verifier's per-criterion evidence** — the raw material for "What Was Changed."
- **The evidence manifest from the capture step, or its `No visual evidence: <reason>` line.** The manifest's `path` and `caption` fields are what the agent references in OTS Materials; hand them over exactly as the capture step returned them.
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
flight-rules pr create --type <type> --scope <id> --description "<description>" --why "<whyWasItChanged>" --what "<bullet>" --what "<bullet>" --ots "<otsMaterials>" --ticket-id <id> --ticket-url <url> --attach <path>#<caption> --attach <path>#<caption> --base <default-branch> --head <branch>
```

- `--description` — the same prose phrase as the commit, since it becomes the PR title. Not the kebab branch slug.
- `--why` — the agent's `whyWasItChanged` prose, verbatim. Grounded in the ticket, phrased for a human.
- `--what` — one per `whatWasChanged` bullet, repeated. The schema caps these at five bullets of 256 characters; if the agent somehow overran, it re-runs, you do not truncate by hand.
- `--ots` — the agent's `otsMaterials`, verbatim. It carries the evidence references or the no-evidence line, so it is present on every run this pipeline produces.
- `--ticket-url` — the link the reviewer follows back to the ticket.
- `--attach` — one per evidence manifest item, as `<path>#<caption>`, using the manifest's `path` exactly. The command uploads each file and rewrites the matching `![caption](<path>)` reference in the OTS Materials block to the hosted asset; a file the block does not reference is appended at the end. So the paths in `--ots` and the paths in `--attach` must be the same strings, or the body ships a dead link and an orphaned image below it. When the capture step produced `No visual evidence: <reason>`, pass no `--attach` at all; the agent has put that line in `otsMaterials`.

Report the open PR, with `<number>` from the URL `pr create` printed:

```bash
flight-rules board post activity --skill flight-rules:execute-work --ticket <id> --text "Opened PR #<number>" --level success
```

**Move the ticket:**

```bash
flight-rules ticket status <id> --to "<inReviewStatus>"
```

**Post the evidence to the ticket.** The board now says in-review; give whoever reads the ticket the same picture the reviewer gets. Write a short body to a temp file: the PR URL on the first line, one or two sentences taken from the tech-writer's `whatWasChanged`, and then each evidence item as `![<caption>](<path>)` using the manifest's `path` exactly — or the `No visual evidence: <reason>` line when that is what the capture step produced. Then post it:

```bash
flight-rules ticket comment <id> --body-file <path> --attach <path>#<caption> --attach <path>#<caption>
```

One `--attach` per manifest item, the same `<path>#<caption>` pairs you passed to `pr create`, referenced in the body as `![<caption>](<path>)` with that same path. The command uploads each file to the ticket and rewrites the matching reference in the body so it renders inline; a file the body does not reference is appended at the end. Pass no `--attach` when the capture step recorded `No visual evidence: <reason>`; the PR URL goes in the body either way. This comes _after_ the transition because it describes a state that already exists.

Continue to the private review in step 8. Do not merge or approve your own PR.

### 8. Private review, verifier triage and remediation

**Every `execute-work` invocation uses a private review**, including invocations by a harness or `execute-wave`. Invoke `autonomous-code-review` as a sibling skill with **action mode (return structured output only)**. Do not invoke its posting stages or hand its output to a poster. Never publish self-review findings, inline comments, summary/state markers, or decisions such as APPROVED or HOLD on the PR. The independent review bot retains its own publishing behavior.

Pass the PR URL, current head SHA, the verifier's `charterConcerns` verbatim, and outstanding questions. Validate the returned object with `flight-rules review validate <review-json-file>` and require its `head_sha` to match the current PR head and the clean local checkout. A failed, partial or stale review is incomplete, never an empty successful review. Distinguish incomplete review execution from a complete review that identifies an unresolved `clarify` or `decide` finding: the latter proceeds to triage with its evidence gap explicit. Preserve the result in the caller's private run artifacts, outside the committed tree.

**a. Triage before editing.** Dispatch a fresh `code-verifier` with `mode: triage`, the original ordered ticket criteria, head SHA, complete review findings, and any existing feedback from other reviewers (including replies and source URLs). Preserve existing finding IDs; assign private IDs to new findings without IDs using the reviewed SHA and their array index. Keep a private map from each ID to its full finding and source. New private IDs are not GitHub review records.

The verifier reads the code and returns `ReviewTriageReportSchema`: one `fix`, `ignore`, or `needs_input` disposition per supplied finding, with evidence. A `fix` includes a concrete verification criterion; `ignore` requires a reason grounded in code, applicable rules or existing evidence. Unanswered policy decisions and unavailable evidence require `needs_input`; the verifier cannot waive a mandatory requirement or another reviewer's blocking finding. This triage evaluates findings, not the implementer's rationale, and does not count as an implementation attempt or a verifier rejection.

Validate the dispatch receipt and triage schema. Require the same head SHA and exactly the supplied finding IDs, each once, with no omissions or additions. Stop for any `needs_input` or `openQuestions` and return the questions under the invocation's question policy. Do not let a malformed report, missing finding or changed head silently remove work. An `ignore` disposition is private triage, not authority to resolve a public review thread or overwrite a bot's records.

If the caller supplies the requested evidence or decision before remediation starts, preserve the original review and triage receipts, recheck the PR/local head, and dispatch a fresh triage worker with the same findings plus that evidence. Validate the new receipt and complete ID coverage again; never hand-edit a `needs_input` into `fix` or `ignore`. A changed head requires a fresh private review first. This does not consume an implementation attempt or reset an existing remediation budget.

**b. Run one bounded remediation pass.** If triage accepts fixes, start one separate `VerifiedImplementationLoop` run with a new run ID linked to the original run and review snapshot. Preserve the ticket, checkout and base. This follow-up pass is authorized by this workflow; it does not reopen or reset the initial implementation history. Its fixed `criteria` list is:

1. Every original acceptance criterion (or Fixed When item), verbatim and in its original order.
2. One criterion per accepted finding, in triage order, formatted `[review:<id>] <criterion>`.

Keep the mapping to the original comments, their resolution conditions and triage evidence in the implementation brief. Pass accepted fixes and the full original ticket to the implementer. Record ignored findings separately; do not turn them into implementation tasks. The verifier receives only the complete ordered criteria and union of changed paths, with a fresh context every time. Each review criterion must contain the relevant behavior, source location and sufficient verification condition so it stands on its own without the implementer's claims.

Use the same implementation/verifier alternation, report schemas, independent evidence requirements and failure handling as step 6. When refreshing the ticket contract, compare only its original criteria to the original ticket snapshot; keep the accepted review criteria fixed and appended for dispatch. A successful follow-up returns to step 8c, not the PR-creation path in step 7. Attempts 1 and 2 use `code-implementation`; attempt 3 uses `code-implementation-escalated` only after two verifier FAILs. The verifier checks **all original criteria and every accepted review criterion on every attempt**. All must PASS before committing or pushing. Preserve each FAIL verbatim on retry, including failed review criteria. UNVERIFIABLE, open questions, malformed output and unavailable workers stop the pass. Maximum three remediation attempts; never start another automatic pass to evade the cap. If triage accepts no fixes, skip implementation and retain the original verification plus triage evidence.

**c. Publish verified changes and respond to others.** After successful remediation, commit the union of paths changed in this pass and push to the existing PR using step 7's commit/push procedure. Do not create another PR or repeat the ticket transition. Reconcile the current PR head before pushing; unexpected commits require a caller decision, not a stale verification claim. Refresh affected visual evidence and PR body details when behavior changed. Preserve the original and remediation receipts and report both attempt counts separately.

When other reviewers have left feedback, reply in their existing threads with the verified fix and commit/test evidence, or an evidence-backed explanation for a disagreement. The implementation report supplies the fix details; the verifier's evidence supports the response. Never claim an unverified fix is complete. Do not publish replies to private findings, a full self-review, a decision summary, or edits to another reviewer's state markers. Leave public finding closure to its reviewer; triage alone cannot resolve it. Replies to existing external feedback are the only review comments this step authorizes.

If review, triage or remediation stops, retain the existing PR and ticket status and report the incomplete work privately. Leave unverified local edits uncommitted and unpushed. Do not restart the initial loop, invent a successful outcome, or post a self-review explaining the stop.

After successful completion, report the wait on a person to Ariadne, not as a PR comment:

```bash
flight-rules board post heartbeat --ticket <id> --step pr --state hold --branch <branch> --skill flight-rules:execute-work --detail "PR #<number> is waiting for review"
```

### 9. Report

Give the user, in this order:

- **Iterations used** — initial implementation attempts (1–3) and remediation attempts (0–3), separately. Triage is not an implementation attempt.
- **Per-criterion verdicts** — every original criterion and accepted review criterion with its verdict and evidence, including any `UNVERIFIABLE`. Distinguish the published head from unverified local edits.
- **The PR URL**, and the branch name.
- **Evidence** — each manifest item's caption and path, the PR's OTS Materials, and the ticket comment that carries them; or the `No visual evidence: <reason>` line.
- **Private review and triage** — review completeness, every finding's disposition and evidence, accepted fixes and their verification, ignored findings and reasons, and unresolved questions or decisions. State that no self-review was posted. Include links to replies to other reviewers when present.
- **Every `charterConcerns` entry** the verifier raised, verbatim, including how triage handled it when applicable.
- **Any `openQuestions`** from either agent, still unanswered.

## Guardrails

- **Maximum 3 initial implementation attempts and 3 remediation attempts.** Step 8 permits one separate remediation pass after the initial run passed. Neither pass can restart its count or gain a fourth attempt; new findings at the cap go to the caller.
- **Dispatch `code-implementation-escalated` only on iteration 3, and the verifier never escalates.** Iterations 1 and 2 dispatch `code-implementation`. A ticket that "looks hard" is not a reason to escalate early — two recorded FAILs is the only one.
- **Never merge.** This skill opens a PR and stops. Merging is a human decision.
- **Never let an unverified change reach a PR.** `verified: true` is the only key that unlocks step 7.
- **Review remediation is private and verified.** Follow step 8: triage first, then one bounded follow-up pass. Reverify the original contract and accepted fixes before publishing changes. No self-review comments, summaries, state markers or approval/hold decisions on the PR.
- **Never tick contract checkboxes.** The `items[].done` flags are read-only to this skill; the verifier's itemized verdict is the record of what passed. A ticked box in a tracker is a claim nobody checked.
- **All git and tracker mutations go through `flight-rules`.** Never hand-rolled `git commit`/`checkout`/`push`, never host-generated commits, never native tracker APIs (`gh issue edit`, the Jira REST API) for state changes. Read-only inspection with plain `git` or `gh` is fine. The plugin's commit guard hook blocks a raw `git commit` in any repo with flight-rules config. When it fires, switch to `flight-rules git commit`; do not reach for the `FLIGHT_RULES_RAW_GIT=1` bypass during a run. The one exception to running git through `flight-rules` is plain-git mode, above, which still takes its message and branch name from the CLI.
- **`openQuestions` and `UNVERIFIABLE` always reach the user, unanswered.** The agents ask when they are genuinely unsure. Answering on their behalf converts a flagged unknown into a silent guess — which is the exact failure the loop exists to prevent.
- **Never overrule the verifier.** A FAIL you disagree with is still a FAIL. Feed it back to the implementer or stop.

## Error handling

When a red gate below stops the run, report it before you stop. Pass the step you were on and the gate's one-line reason, and leave out `--branch` when step 4 has not run yet:

```bash
flight-rules board post heartbeat --ticket <id> --step <current step> --state abort --branch <branch> --skill flight-rules:execute-work --detail "<one-line reason>"
```

- **Dirty working tree** → stop before mutating anything. Report the dirty paths and ask the user to commit or stash. No branch, no transition, no dispatch.
- **Missing or empty contract section** (Acceptance Criteria, or Fixed When on a bug report) → stop and ask. Never invent the contract.
- **Ticket references something a fresh clone can't resolve** (step 1 or step 5) → stop before mutating anything and report a ticket defect, listing each reference. Don't search this machine for the file. The fix belongs in the ticket, so the next engineer gets it too.
- **`flight-rules check` fails** → stop and show the report. Fix config or credentials before running.
- **`ticket status` reports the transition is unreachable** → the CLI's error carries an `available:` list. Show it to the user, ask which status they meant, then **store the corrected value** with `flight-rules config set inReviewStatus "<status>"` (or `inProgressStatus`) so the next run doesn't repeat the mistake. Don't retry blind.
- **Verifier returns `UNVERIFIABLE`** → do not treat it as PASS and do not treat it as FAIL, and **do not iterate**. Stop before spending another iteration, surface the criterion and the verifier's question to the user, and ask how to proceed. An untestable criterion is usually a ticket bug, not a code bug — another implementation pass cannot fix it. This takes precedence over any FAIL in the same result.
- **Either agent returns `openQuestions`** → surface them unanswered, alongside whatever else that iteration produced.
- **Third consecutive FAIL in either pass** → stop. Present the itemized evidence from the final verification, state that three iterations were used, and **leave the branch intact** with the work in place so a human can pick it up. Do not commit, do not push, do not open a PR, and do not move the ticket to in-review. For initial implementation, leave it in-progress. If remediation failed after the PR opened, keep that PR and the in-review status, and report the unpushed work to the caller.
- **`git push` rejected** → stop and report. There is no force flag, and inventing one with raw git is not the fix.
- **`pr create` fails on `repo`** — either `repo (owner/repo) is required in config to create pull requests` or `Invalid repo format …`. This is a config error, not a work error, and by the time you see it **the commit has landed and the branch is pushed**. So: fix `repo` with `flight-rules config set repo "<owner/repo>"` (confirm the value with the user first) and re-run **only** the `pr create` command, then carry on to the in-review transition. Do **not** redo the implement/verify loop, do not re-commit, and do **not** fall back to raw `gh pr create` — that bypasses the PR template, so the body would lose the authored What/Why sections, the OTS Materials block and the ticket link, which is the whole point of routing through the CLI. Re-run `pr create` with the same authored fields the tech-writer produced and the same `--attach` set — don't re-summon the agent and don't hand-write a body. If the user can't supply a valid `owner/repo`, stop and report the branch name and commit sha so the PR can be opened by hand.
- **`pr create` exits non-zero but printed a PR URL** → a partial attachment upload. The PR exists, with the files that did upload. Do **not** run `pr create` again — that opens a duplicate. Record the URL, note which attachments failed for the step 9 report, and carry on to the in-review transition. The missing images can be attached to the PR later by hand.
- **`ticket comment` fails** → report it in step 9 and finish the run. The PR is open, the work is verified, and the ticket has moved; the comment is the only thing missing, and it can be posted by hand from the manifest. Do not roll the ticket status back and do not retry the loop.
- **Private review or triage fails** → report the incomplete stage in step 9. Keep the existing PR and ticket status; do not substitute an empty review, skip a finding, publish a self-review, or reset either attempt budget.

## What Good Looks Like

A reviewer can grade a run against this list:

- The branch name follows the convention `flight-rules git checkout` produces — no hand-cut branches in the history.
- Every commit message is CLI-generated, correctly typed and scoped to the ticket id.
- The commit contains exactly the union of the paths the implementer reported across all iterations: nothing unrelated rode along, and nothing the verifier passed was left behind. The working tree is clean afterwards.
- A visible change produced evidence under the directory `flight-rules qa evidence-dir <ticket>` prints, or the run recorded `No visual evidence: <reason>`; nothing from that directory was committed.
- The ticket carries a comment linking the PR and, for a visible change, the same evidence the PR shows; it was posted after the in-review transition.
- The PR body matches `docs/pr-body-format.md`: tech-writer-authored What/Why sections, the ticket linked, and — when present — an OTS Materials block whose images and video render from GitHub-hosted assets, not relative paths, or which states `No visual evidence: <reason>`.
- The ticket's status trail reads to-do → in-progress → in-review, with the in-review transition happening _after_ the PR exists.
- No contract item — acceptance criterion or Fixed When item — shipped without a PASS verdict backed by evidence, and no checkbox was ticked. Every accepted review criterion also passed before remediation was pushed.
- The run summary states the iteration count, and every `charterConcerns` and `openQuestions` entry reached the user.
- Iterations 1 and 2 dispatched `code-implementation`; `code-implementation-escalated` appeared only if a third iteration was reached, and the verifier remained `code-verifier`.
- The autonomous review stayed private. The verifier triaged every finding with evidence; all accepted fixes and original criteria passed before remediation was pushed. Only replies to other reviewers' existing feedback were posted, with no author self-review or verdict summary.
- The PR is open and unmerged, waiting on a human.
