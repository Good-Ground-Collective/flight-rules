---
name: remediate-review
description: "Works the open review threads of an existing pull request: grounds itself in the PR description and the linked ticket, triages every thread through code-verifier, fixes accepted findings in a bounded verified loop, pushes only verified fixes to the PR branch, replies in each thread and posts one summary comment. Never resolves a thread and never merges. Use when a PR has review feedback to address, including unattended in CI."
---

# Remediate Review

This skill runs the shared review-remediation procedure against a pull request that already exists. You are handed a **PR number**; you hand back a PR branch that carries only verified fixes, a reply in every open thread you worked, and one summary comment.

**The hard rule: this skill never resolves a thread, never merges, and never pushes an unverified change.** Closing a thread is the reviewer's decision. The verifier is the gate on every push.

**Terminal state:** every in-scope thread has a reply (fix, clarification or escalation), exactly one summary comment is posted, and any verified fixes are pushed to the PR branch. An incomplete run is reported to the caller: unverified work is left uncommitted and, when the PR head moved, the verified commit is left local and unpushed.

## Orchestration context

Read `flight-rules doc orchestration-interface` and `flight-rules doc native-orchestration` before dispatch. Initialize one run context with the PR number, the ticket id when one is found, a unique run ID, the active checkout root, working directory, the PR head branch as the fixed base and attempt 1. Select agents by registry name through `dispatch`, validate each role report with its original request identity, and retain the paired receipts across retries. An unavailable dispatch is a named stop, never inline replacement work.

Human questions require invocation-level `allowHumanQuestions: true` and supported `ask`; otherwise every instruction below to ask means return `QUESTIONS_DISABLED` or `QUESTIONS_UNAVAILABLE` with the unresolved question. The default is that human questions are disabled, because the first consumer runs unattended. Without them the run never waits for an answer: it escalates in the thread (step 6) and reports in the summary (step 7). When opted in, wait for an actual answer before dependent work.

## Inputs

- **PR number** (required) on the current repository.
- **Trusted author logins** (optional, repeatable). The authors whose root comments may carry finding markers. `name[bot]` trusts only that bot; a bare `name` trusts only a user of that name. Never add a trusted author the invoker did not name, and never trust markers from arbitrary commenters.
- **Whether human questions are allowed** (default: no).

## Preconditions

- Run each repository-specific command from the target **repo root**.
- Read and write config only through the CLI (`flight-rules config show`, `flight-rules config set`); never hand-edit config files.
- Before the first repository or tracker mutation, run `flight-rules check --workflow remediate-review` and require `"ok": true` for the environment checks.
- The **working tree is clean**. A dirty tree stops the run before any mutation.
- You are not merging, approving or requesting changes. The only PR writes are the thread replies, the single summary comment and the push of verified fixes.

## Process

You MUST create a todo per step and complete them in order.

### 1. Preflight

Run `flight-rules check --workflow remediate-review` and `git status --porcelain`. A failed required check or any output stops the run, per Preconditions.

### 2. Read the threads and check out the PR branch

```bash
flight-rules pr threads <number> --trusted-author <login> --trusted-author <bot-name>[bot]
```

Pass one `--trusted-author` per login the invoker supplied; pass none when it supplied none (no marker is then parsed, and every thread is treated as a human thread). Record `pullRequest.headRefOid` as the reviewed head, and note `title`, `body`, `url` and `headRefName`.

Get onto the PR head branch `headRefName` at `headRefOid`. First read the current state:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

When the current branch equals `headRefName` and `HEAD` equals `headRefOid` (a host may already have checked the branch out), skip the checkout. Otherwise, whether the branch differs or the branch matches with a different `HEAD`, check out the branch and re-read `HEAD`:

```bash
gh pr checkout <number>
git rev-parse HEAD
```

If `HEAD` still differs from `headRefOid`, the run stops before any work.

### 3. Ground in the ticket

Take the ticket key from the first place that yields one:

1. the PR title, in `type(KEY):` form;
2. the branch name, in `type/KEY-…` form;
3. the PR body (a ticket link or `KEY` reference).

In this repository tickets are GitHub issue numbers (`feat(42): …`); on a Jira-tracked repository they are Jira keys (`feat(ABC-123): …`), resolved through the configured tracker.

With a key, run `flight-rules ticket get <key>` and apply `execute-work` step 1's format detection exactly: `issueType` of `Bug` is a bug report, anything else a layered body, `metadata.kind` overrides, and otherwise the first level-2 heading decides (`## Symptom` or `## Problem Statement`). Extract the contract section for that format (Acceptance Criteria, or Fixed When) verbatim and in order. These are the **original criteria** the verifier rechecks. Read the Problem Statement or Symptom and the Solution as context, not contract.

With no key, a ticket that cannot be read, or a ticket in neither format, or a ticket whose contract section is empty, ground in the PR description alone, take no original criteria from it, and say so in the summary. Never infer criteria from prose and never write them yourself.

### 4. Build the findings list

For each thread in the `pr threads` output, decide scope:

- **In scope:** unresolved (`isResolved` false), non-outdated (`isOutdated` false), not `commentsTruncated`, and either carrying a trusted finding marker (`finding` not null) or coming from a human reviewer.
- **Skipped:** resolved threads, outdated threads, and truncated threads. A thread whose finding marker has status `resolved` or `withdrawn` is also skipped. A thread whose root author is a bot not named by `--trusted-author` is skipped with the reason `untrusted bot`. Record every skipped thread with its link and the reason for the summary.
- **Awaiting reviewer:** resolve the account running the skill read-only (`gh api user --jq .login`). Skip an unresolved thread whose most recent comment was authored by that account, with the reason `awaiting reviewer`. A thread where a reviewer commented after the skill's last reply stays in scope. If the running account cannot be determined, skip nothing on this basis and say so in the summary; never guess.
- Every unresolved, non-outdated thread is therefore either in scope or listed as skipped with a reason.
- A thread with a `markerError` is treated as a human comment from its root author: its text is still read, its marker is not.

Each in-scope thread becomes one finding. Its id is the **thread node id** (`thread.id`). Keep a private map from id to the full finding: the thread id, path and line, every comment with its author and URL, the marker's finding when present, and the source (`trusted marker` or `human`). Never copy a marker from a non-trusted commenter into a finding.

With no in-scope threads, skip to step 7 and post the summary stating nothing was in scope.

### 5. Triage, remediate and publish

Run `flight-rules doc review-remediation` and read the full output. Follow it with the findings from step 4 and the original criteria from step 3. For this skill it applies as follows:

- **Scope.** The findings in scope are the step 4 threads, the PR's open public threads, and nothing else. There is no private review. When the ticket supplied no original criteria, the verifier's fixed criteria are the accepted `[review:<id>]` criteria alone, and the PR description is passed as context.
- **Dispatch brief.** Hand each implementer the full ticket body (or the PR description when ungrounded), the thread findings, and the pointers printed by `flight-rules charter --repo --path`, which it reads in full.
- **Summary comment.** Exactly one summary comment is allowed and is posted in step 7.
- **Initial loop.** There is no initial loop in this run. The bounded remediation pass in the doc is the only pass: at most three attempts, attempts 1 and 2 on `code-implementation`, attempt 3 on `code-implementation-escalated` only after two verifier FAILs.
- **Triage stops.** A `needs_input` is escalated in its thread (step 6), never answered by this skill, and never prompts a human when questions are disabled. Any triage `needs_input` or `openQuestions` stops the run before remediation: no remediation attempt, no commit and no push, even for findings triaged `fix` or `ignore`. The stop is reported in step 6 replies and the step 7 summary.

**Commit and push only after a PASS.** Once every original criterion and every accepted review criterion passed, commit the union of paths changed across every attempt, writing a body file outside the repo first:

```bash
flight-rules git commit --type fix --scope <key> --description "<description>" --body-file "$TMPDIR/<number>-remediation.md" --file <path> --file <path>
```

Without a ticket key use `--scope <number>`, the PR number. Then, where the repository has it:

```bash
npm run check:source-status
```

**Reconcile the head before pushing.** Re-read the PR head with `flight-rules pr threads <number>` and compare `headRefOid` to the recorded one. If the PR head moved to a commit this run did not create, stop without pushing, leave the verified work committed locally and unpushed, and report the unexpected commit. Otherwise:

```bash
flight-rules git push
```

There is no force flag. A rejected push stops the run and is reported.

Triage with no accepted fixes skips remediation and push.

### 6. Reply in every in-scope thread

Write each reply to a file outside the repo and post it with the thread node id:

```bash
flight-rules pr thread-reply <thread-id> --body-file <path>
```

- `fix`: the commit SHA that was pushed and the verifier or test evidence for that finding.
- `ignore`: an evidence-backed explanation grounded in code, applicable rules or existing evidence. A clarification, not a dismissal.
- `needs_input`: an escalation that states the open question and why the evidence could not settle it.

Reply to every in-scope thread, once. When triage stopped on an open question, a `fix` thread gets no fix claim: reply that the fix was accepted but not attempted because triage stopped on an open question, and an `ignore` thread still gets its evidence-backed explanation. When remediation stopped before a push, a `fix` thread gets no fix claim: reply that the fix was not verified and was not pushed, with the reason. Never claim an unverified fix is complete. Do not edit or answer a reviewer's state marker.

### 7. Post one summary comment

Write one body to a file and post it exactly once:

```bash
flight-rules pr comment <number> --body-file <path>
```

The body lists, with a link to each thread's source URL:

- **Fixed** threads and the pushed commit SHA.
- **Explained** threads (`ignore`).
- **Escalated** threads (`needs_input`) with each question.
- **Skipped** threads and the reason (resolved, outdated, truncated, resolved or withdrawn marker, untrusted bot, awaiting reviewer), and a line when the running account could not be determined.
- The **remediation attempt count** (0 to 3).
- The **grounding**: the ticket key and format, or a line saying no ticket was usable and the PR description alone was the ground.
- Any stop (unexpected head, rejected push, exhausted attempts) and the unpushed work it left.

Post the summary even when the run stopped early, so the PR carries the outcome.

### 8. Report

Report to the caller, in this order: attempts used; per-criterion verdicts for every original and accepted review criterion with evidence; each thread's disposition and reply link; the commit SHA and push state; the summary comment link; every `charterConcerns` and `openQuestions` entry, unanswered.

## Guardrails

- **Never resolve a thread.** No resolve call, no marker edit. Closure belongs to the reviewer.
- **Never answer a `needs_input` yourself**, and never ask a human mid-run when human questions are disabled.
- **Never push an unverified change.** Commit and push only after every original criterion and accepted review criterion passed, with the head reconciled.
- **Maximum three remediation attempts**, no restart, no fourth attempt. Do not start another automatic pass.
- **Exactly one summary comment** per run, and no review, approval or hold decision on the PR.
- **Trust only named authors.** Finding markers count only from `--trusted-author` matches; `name[bot]` trusts only that bot and a bare name only a user.
- **Never overrule the verifier.** A FAIL stays a FAIL; feed it back or stop.
- **All git and tracker mutations go through `flight-rules`** (commit, push, thread replies, comment). Checking out the existing PR branch and read-only inspection with plain `git` or `gh` are the only exceptions.
- **Never merge.**

## Error handling

- **Dirty working tree or failed `flight-rules check`** → stop before mutating anything and report it.
- **Checked-out head differs from `headRefOid`** → stop before any work.
- **PR head moved during the run** → stop without pushing; keep the verified commit local; report the unexpected commit.
- **Ticket unreadable, in neither format, or without a contract** → ground in the PR description alone and say so in the summary.
- **Triage `needs_input` or `openQuestions`** → stop before remediation with no commit and no push; reply `needs_input` threads with the escalation, `fix` threads that the fix was accepted but not attempted because triage stopped on an open question, `ignore` threads with their explanation; list the questions in the summary.
- **Verifier `UNVERIFIABLE`, `openQuestions`, malformed output or unavailable worker** → stop the pass, push nothing, reply `needs_input` in the affected threads with the question, and report. Questions reach a human only through the thread replies and summary when questions are disabled.
- **Third consecutive FAIL** → stop, push nothing, leave the work uncommitted, reply in each `fix` thread that the fix was not verified, and summarize the itemized evidence.
- **`git push` rejected** → stop and report; no force.
- **`pr thread-reply` fails** → continue with the remaining threads, list the failed thread in the summary and the report. Do not retry in a loop.
- **`pr comment` fails** → report it to the caller; do not post a second summary.

## What Good Looks Like

- The PR number and trusted authors were the only inputs; no marker from an untrusted commenter was used.
- The ticket key came from the title, then the branch, then the body, and the summary says what grounded the run.
- Every in-scope thread got exactly one reply of the right kind, and skipped threads are listed with reasons.
- A triage `needs_input` stopped the run before remediation; no fix or ignore finding proceeded past it, and nothing was committed or pushed.
- A thread whose latest comment is the running account's own is skipped as awaiting reviewer, unless a reviewer commented after the skill's last reply.
- Nothing was pushed that the verifier did not pass against every original and accepted review criterion, and the head was reconciled first.
- Exactly one summary comment was posted, with attempt count and links.
- No thread was resolved, no `needs_input` was answered by the skill, and no human was asked mid-run when questions were disabled.
- The PR is unmerged, waiting on its reviewers.
