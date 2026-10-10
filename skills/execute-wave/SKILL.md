---
name: execute-wave
description: "Drains every startable ticket under an epic or initiative, one at a time, by running execute-work on each. Reads the dependency graph through the flight-rules CLI, works only the tickets nothing is blocking, and stops at the wave boundary so a human can review and merge. Never merges and never advances to the next wave on its own. Use when you want to hand an agent a whole epic or initiative instead of one ticket."
---

# Execute Wave

You are handed an **epic or initiative id**. You hand back a set of open pull
requests — one per ticket that was startable — and a report of what parked and
what unblocks when the human merges.

This skill is a driver, not a builder. Every ticket is built by `execute-work`,
which owns branching, the implement/verify loop, committing, the PR, and the
tracker transition. You decide **what to work and in what order**, and you decide
nothing else.

**The hard rule: one wave per invocation.** You drain the tickets that are
startable _now_, then stop. You never advance to the next wave, because the next
wave unblocks only when this wave's tickets **close**, and closing requires a
human to merge. An agent that "keeps going" past the wave boundary is an agent
building on unreviewed work.

**Terminal state:** every startable ticket has either an open PR or a recorded
reason it parked, the working tree is clean, HEAD is back on the base branch, and
the user is holding a report they can act on.

## Preconditions

- You are handed an **epic id** or an **initiative id**.
- Run everything from the **repo root**.
- The **working tree is clean**. Checked once, here, before any mutation.
- `flight-rules check` reports `"ok": true`.
- Config carries a **`repo`** field (`owner/repo`). `execute-work` needs it to open each PR, and discovering it missing on ticket four means three PRs and a broken run. Settle it now.
- **Ariadne reporting is optional.** The `flight-rules board` lines below report the wave to Ariadne's Agents page and read answers people gave there. When Ariadne is not configured, or the node is not a Jira key, they print nothing and exit 0. Treat empty output as "no answer". Never let a post change the run. Answers come only from people in Ariadne; this skill reads them and never answers an item itself.

## Process

You MUST create a todo per step and complete them in order.

### 1. Resolve the node

If the user said "epic" or "initiative", take them at their word. If they gave a
bare id or a link, resolve it:

```bash
flight-rules epic get <id>
```

If that fails, try:

```bash
flight-rules initiative get <id>
```

State which one you resolved it as before doing anything else. Working an
initiative when the user meant an epic silently widens the blast radius.

If the id is a **ticket**, stop and point the user at `/execute-work`. This skill
does not drive single tickets.

### 2. Preflight, once

Run the precondition checks now rather than letting `execute-work` discover them
per ticket:

```bash
flight-rules check
```

Confirm the working tree is clean (`git status --porcelain` is empty — plain
read-only `git` is fine here). Confirm `repo` is in config.

**Record the base branch.** Read the current branch and keep it; every ticket in
the wave branches from it.

If the base branch is not the repo's default branch, say so and confirm before
continuing. Draining a wave onto a feature branch is legitimate but rarely what
someone means. Post that closed question to Ariadne too, and take whichever
answer comes first, in chat or in `chosenOption` from `flight-rules board items --json`:

```bash
flight-rules board post item --kind question --ticket <node id> --title "Drain the wave onto <base branch>, not the default branch?" --option Continue --option Stop
```

### 3. Plan the graph

For an epic:

```bash
flight-rules epic plan <id>
```

For an initiative:

```bash
flight-rules initiative plan <id>
```

Both print `{"waves": [[…]], "cycles": []}` and both **throw on a cycle**, after
printing. A cycle is a breakdown bug, not a work item: stop, show the cycle, and
send the user to `/break-down-work`. Never try to pick a starting point inside a
cycle.

Use `initiative plan` — never a loop of `epic plan` calls — when the node is an
initiative. It builds one graph across every child epic, so a ticket blocked by a
ticket in a sibling epic is correctly held back. Per-epic planning cannot see
that edge and would report the blocked ticket as ready.

### 4. Select the wave

**Take `waves[0]` and nothing else.** Do not walk `waves[1]`, and do not reach
into later waves for something that "looks independent." Every ticket past wave 0
is blocked by an open ticket, by construction.

Then filter `waves[0]` down to what is genuinely startable:

- **Keep** tickets in the tracker's to-do status.
- **Drop** tickets already in-progress or in-review. They stay in the graph as blockers — that is correct and load-bearing, because a dependent must not start until the blocker merges — but they are not work. `execute-work` leaves a ticket in **in-review**, not closed, so an already-driven ticket reappears in `waves[0]` on every subsequent run. Re-driving it would cut a second branch for work that already has a PR.
- **Drop** tickets labeled `sharpen-the-saw`. That work is reserved for a human, and `execute-work` redirects on the label anyway.

Report every dropped ticket with its reason. A silently skipped ticket reads as a
ticket that didn't exist.

**If nothing is startable, say precisely why.** The three causes are different
and the user needs to know which one they have:

- Everything in wave 0 is in-review → the wave is already drained; you are waiting on their merges. Go to step 9 to route those PRs for review, then stop.
- Wave 0 is empty but later waves aren't → shouldn't happen; report it as a planner inconsistency rather than guessing.
- No open tickets at all → the epic or initiative is done.

### 5. Confirm before spending

First read the wave gate the previous run left in Ariadne (step 10):

```bash
flight-rules board items --session wave-<node id> --json
```

Take the newest `wave-gate` item, and remember how many `wave-gate` items there are (zero when nothing prints) for step 10. If its `chosenOption` is `Start wave` and its `detail` lists exactly the tickets you selected, that answer is the go-ahead: say so and start draining without asking. `Review wave` means stop and tell the user they asked to review first. Otherwise there is no answer yet, so continue below.

Show the user the wave: each ticket id, its title, and the count. List what you
dropped and why. Then ask for a go-ahead. Post the same closed question to Ariadne, and take whichever answer comes first, in chat or in `chosenOption` from `flight-rules board items --json`:

```bash
flight-rules board post item --kind question --ticket <node id> --title "Start <count> tickets under <node id>?" --option Start --option Stop
```

**Past five tickets, make the cost explicit** before asking. Each ticket runs an
implement/verify loop of up to three iterations with two agents per iteration,
and the transcript accumulates in this session for the whole run. A twelve-ticket
wave is a very large spend and may exhaust context before it finishes. Offer to
work a subset in that case, and let the user pick.

Never start draining without an explicit go-ahead.

### 6. Drain, one ticket at a time

For each selected ticket, in `waves[0]` order:

1. **Invoke `execute-work`** with the ticket id **and the base branch from step 2**. Passing the base is not optional: `execute-work` cuts its branch with `git checkout -b <branch> <from>`, and without `--from` it branches off current HEAD — which, after ticket one, is ticket one's branch. Omitting it silently stacks every ticket in the wave on its predecessor and puts the previous ticket's commits in the next ticket's PR diff.
2. **Record the outcome** as a short structured entry: ticket id, iterations used, PR URL, review verdict, and any unresolved `charterConcerns` or `openQuestions`.
3. **Move on.** Do not carry the full transcript of a finished ticket forward. The entry from (2) is the whole record you need, and context is the binding constraint on how wide a wave can go.

Run tickets **sequentially**. `execute-work` requires a clean working tree and
mutates the branch; two runs in one tree collide.

### 7. Handle a ticket that can't finish

`execute-work` stops without a PR in several states: three consecutive FAILs, an
`UNVERIFIABLE` verdict, a rejected push, `openQuestions` it can't answer, a ticket
defect where the body points at something a fresh clone can't resolve.

A ticket defect stops before any mutation, so it leaves no branch and a clean
tree. Park it, list its unresolvable references in the report, and keep draining.
Don't patch the ticket from your own machine's files.

**Park the ticket and keep draining.** A sibling that doesn't depend on the
failure has no reason to wait — wave 0 is independent work by definition.

**Freeing the working tree.** A parked ticket leaves uncommitted work on its
branch, and `execute-work` deliberately says to leave it there for a human. That
is right for a single run and wrong here: a dirty tree fails the next ticket's
preconditions, so the wave would halt on the first failure regardless of your
intent.

So when a ticket parks with a dirty tree, commit the work to its own branch
before continuing:

```bash
flight-rules git commit --type chore --scope <id> --description "park unverified work for handoff" --body-file "$TMPDIR/<id>-park.md" --file <path>
```

In plain-git mode (see `execute-work`), build the same message with `flight-rules commit-message` and commit that file with `git commit -F`.

Stage by explicit path, exactly as `execute-work` does. The body file says why the ticket parked and what the verifier's last failures were, so whoever checks out the branch knows what state it is in without reading this run's report. Then:

- **Do not push it.** Do not open a PR.
- **Leave the ticket in in-progress.** That is now true.
- **Say so, loudly, in the report.** The commit exists to free the tree, and it contains code no verifier passed. A human resumes by checking out that branch.

This is a deliberate divergence from `execute-work`'s handling, and it preserves
the invariant that actually matters: **unverified work never reaches a PR.** It
relaxes only the one about leaving the tree untouched, which cannot hold when
another ticket has to run next.

**Halt the whole run** — don't park — when the environment itself becomes
untrustworthy: `flight-rules check` starts failing, a cycle appears, or the tree
is dirty from something you didn't cause. Continuing would compound a problem you
can't see the shape of.

### 8. Return to base

When the wave is drained, check out the base branch recorded in step 2 and
confirm the tree is clean. Leaving the user on the last ticket's branch means
their next command runs somewhere they didn't choose.

### 9. Review hand-off

Run this when the run is blocked on merges: everything in wave 0 is in-review (step 4), or the wave you just drained left open PRs. It asks for review and nothing more. It never merges and never starts the next wave.

For an epic:

```bash
flight-rules epic review-plan <node>
```

For an initiative:

```bash
flight-rules initiative review-plan <node>
```

Use `initiative review-plan` for an initiative, never a loop of `epic review-plan` calls. It plans across every child epic, so dependencies between epics are kept and the simple/complex rule is applied once to the whole set of PRs you are blocked on. Per-epic plans would lose cross-epic waves and apply the size trigger to each epic separately.

Read `route`, `reasons`, `missing`, `blocked` and `unblocksOnMerge`. Each `blocked` entry carries a `pr` (`number`, `url`, `headRefName`, `baseRefName`), or `null` when no open PR matched the ticket. If a `blocked` entry has `pr: null`, skip it and list it in the report instead of failing.

The route is `incomplete` if any blocked ticket has no open PR. Otherwise it is `complex` if the PR set spans more than one wave, if any PR's base is not the default branch, or if it has more than 4 PRs, and `simple` if none of those hold.

- **`incomplete`:** report the tickets in `missing` as "in review with no open PR found" and stop routing. Request nothing and do not offer a packet until those PRs exist.
- **`simple`:** ask the human once, for the whole set, which reviewer logins to request. Nothing is requested before they answer. Then, for each blocked PR that has a `pr`:

  ```bash
  flight-rules pr request-review <number> --reviewer <login>
  ```

  Pass `--reviewer` once per login. Record `requested` and `failed` for each PR. If a call exits non-zero, carry on with the remaining PRs and logins, then list every failed login and its PR in the report. Never fall back to raw `gh pr edit`.
- **`complex`:** show the `reasons` and the ordered PR list from `blocked`, then offer to invoke the `author-review-packet` skill with the review-plan payload so the author can build a sequenced Review Packet. If the human declines, offer the simple path above, or stop, as they choose.

Ariadne board items need a Jira-style ticket key, so this step posts no board item on GitHub-tracked repos.

### 10. Report

First post the wave gate, so a person can approve the next wave in Ariadne. Run it under the node's own session, `wave-<node id>`, so the next run finds it in step 5. Take `<n>` from the count of `wave-gate` items step 5 read, plus one. Write `<waves[1] ids>` as the ticket ids that unblock on merge, comma-separated:

```bash
flight-rules board post heartbeat --session wave-<node id> --ticket <node id> --step "wave gate" --state hold --skill flight-rules:execute-wave
flight-rules board post item --session wave-<node id> --kind wave-gate --ticket <node id> --id wave-<node id>-<n> --title "<k> PRs open for review; <m> tickets can start once they merge" --detail "<waves[1] ids>" --option "Start wave" --option "Review wave"
```

Then give the user, in this order:

- **The node** — epic or initiative, id and title, and which you resolved it as.
- **Wave size** — how many tickets were startable, out of how many open.
- **Per ticket, one line each**: id, outcome, iterations used, PR URL.
- **Parked tickets** — for each, why it parked, the branch holding the work, whether you committed to free the tree, and the verifier's final evidence.
- **Every `charterConcerns` and `openQuestions`** raised across every ticket, verbatim and unanswered.
- **What unblocks on merge** — read `waves[1]` from the plan and name those tickets. This is what the user gets by reviewing, and it is the reason to stop here rather than push on.
- **Review routing** — the block from step 9: the route taken (`simple`, `complex` or `incomplete`), reasons, per-PR request results or the packet id, every failed login with its PR, and tickets in review with no open PR found.
- **The next step, plainly:** review and merge these PRs, then run this skill again on the same id.

## Guardrails

- **One wave per invocation.** Never re-plan and continue after draining. The user merges, then re-invokes.
- **Never work a ticket outside `waves[0]`.** Later waves are blocked by construction.
- **Never re-drive a ticket that is in-progress or in-review.** It already has a branch, and probably a PR.
- **Never merge.** This skill opens PRs and stops, exactly as `execute-work` does.
- **The review hand-off requests review only.** It never merges, never starts the next wave, and requests nothing without the human's confirmation. Blocked tickets with no matching PR are reported, not guessed, and a failed review request never stops the rest of the set.
- **Never start without an explicit go-ahead** from step 5.
- **Never run tickets concurrently.** One working tree, one branch at a time.
- **Never build the ticket yourself.** If `execute-work` parks a ticket, that is the outcome. Picking up the implementation by hand removes the verifier from the loop, which is the only independent check in the pipeline.
- **All git and tracker mutations go through `flight-rules`.** Read-only inspection with plain `git` is fine.
- **Every dropped, parked, or skipped ticket reaches the user.** A wave report that mentions only successes is a false report.

## Error handling

- **Id resolves to neither an epic nor an initiative** → stop and ask. Don't guess at the level.
- **Id is a ticket** → point at `/execute-work` and stop.
- **Cycle detected** → stop, show the cycle, send the user to `/break-down-work`. Never pick an arbitrary entry point.
- **Dirty tree at preflight** → stop before any mutation. Report the dirty paths and ask the user to commit or stash.
- **`flight-rules check` fails** → stop and show the report.
- **`repo` missing from config** → settle it now, before the first ticket. Confirm the value with the user and write it into the config file.
- **Nothing startable** → not an error. Report which of the three causes applies. When everything in wave 0 is in-review, run the review hand-off (step 9) first, then stop.
- **A ticket parks** → record it, free the tree per step 7, continue with the next ticket.
- **Context is running short mid-wave** → stop cleanly at the current ticket boundary rather than starting one you can't finish. Return to base, and report exactly which tickets were not attempted so the user can re-invoke for the remainder.

## What Good Looks Like

- Exactly the tickets in `waves[0]` that were in the to-do status got worked — no more, no fewer.
- Every PR's diff contains only its own ticket's commits. No accidental stacking.
- The tracker shows each worked ticket in in-review, each parked ticket in in-progress.
- HEAD is back on the base branch and the tree is clean.
- The report names every parked ticket, its branch, and whether unverified work was committed to free the tree.
- No PR was merged, and no ticket outside wave 0 was touched.
- The user knows what merging unblocks, and that re-invoking is how they get it.
