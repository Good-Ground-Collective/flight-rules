---
name: reproduce-bug
description: "Reproduces a Jira bug in the running product and documents it on the ticket: reads the ticket through the flight-rules CLI, dispatches the qa-engineer agent to drive the web client and capture before/after evidence, writes a Bug Report body with steps, root cause and Fixed When criteria, attaches the evidence, and swaps the Agentic-Reproduction label. Never fixes the bug, never changes workflow status, never prompts. Use when a bug lands and a human needs steps and evidence before anyone touches code."
---

# Reproduce Bug

This is the skill that turns a landed bug into a document a human can act on. You are handed a **ticket id**; you hand back a ticket carrying a Bug Report body, a comment with before/after evidence, and exactly one outcome label. The `qa-engineer` agent looks; you write. Every tracker write is yours, and every one goes through `flight-rules`.

**The hard rule: this skill never fixes the bug, never changes the ticket's workflow status, and never prompts in its happy path.** Those are one rule with three faces. You reproduce and describe a bug — you do not touch the code that causes it, you do not move the ticket across the board, and you do not stop to ask a human anything the run can decide for itself.

**Terminal state:** the ticket carries a Bug Report body per `${CLAUDE_PLUGIN_ROOT}/docs/bug-report-format.md`, a comment with the before/after evidence inline, and exactly one of `Agentic-Reproduction-Success` or `Agentic-Reproduction-Failure`; the user holds a run summary with the outcome, the label, the evidence paths, and any open questions.

## Preconditions

- You are handed a **ticket id**.
- Run everything from the **repo root** of the app the QA recipe describes; the CLI resolves config relative to CWD, and the agent drives that app.
- **The config file is `$FLIGHT_RULES_CONFIG` when that variable is set, otherwise `.claude/flight-rules.local.md`.** The CLI honours the override, so every read and write below means whichever path is in effect.
- The tracker is **Jira**. The label lifecycle and the reporter mention are Jira shapes.
- `flight-rules check` reports `"ok": true`, including the `tools:*` probes for `playwright-cli`, `ffmpeg`, and `gh` that the agent's capture depends on.

  ```bash
  flight-rules check
  ```

- A QA recipe resolves — `qaRecipe` in config, or the default `.claude/flight-rules.qa.md` beside it. Its format is `${CLAUDE_PLUGIN_ROOT}/docs/qa-recipe-format.md`. Read the resolved path once:

  ```bash
  flight-rules qa recipe
  ```

- Credentials resolve headlessly, per `${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`: `FLIGHT_RULES_QA_USERNAME` and `FLIGHT_RULES_QA_PASSWORD` in the environment, or `op://` references in the recipe with `OP_SERVICE_ACCOUNT_TOKEN` set.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the ticket

```bash
flight-rules ticket get <id>
```

From the JSON take `title`, `body`, `issueType`, `labels`, `reporter`, `attachments`, and `metadata`.

Refuse before any mutation, each with the stated reason, when:

- `issueType` is not `Bug` **and** `metadata.kind` is not `bug` — "not a bug ticket; verify-ticket handles stories".
- `labels` contains `Agentic-Reproduction-Success` — "already reproduced; run verify-ticket after the fix lands".
- `labels` contains `Agentic-Reproduction-In-Progress` — "another reproduction is active; wait or clear the label".

Confirm the working tree is clean; read-only inspection is fine:

```bash
git status --porcelain
```

Any output means stop and report — the agent's reversible flips must start from a clean tree.

### 2. Mark the reproduction in progress

```bash
flight-rules ticket label <id> --add Agentic-Reproduction-In-Progress
```

From here every exit path swaps this label in a single `ticket label` call, so no run leaves `In-Progress` behind.

### 3. Dispatch the qa-engineer agent

Dispatch `qa-engineer` in **`reproduce`** mode. Pass **no `model` argument** — reproduce runs on the agent's frontmatter default, which is the tier chosen for locating a symptom's layer. Hand it, and nothing you have added on top:

- The ticket's **full body, verbatim** — every section, not a summary.
- The reporter's **`attachments`** (filenames and ids) as prior evidence.
- The **recipe path** you read in Preconditions.
- The **evidence directory** `.claude/evidence/<id>/` (gitignored) it writes into.
- The **charter path** `${CLAUDE_PLUGIN_ROOT}/docs/qa-charter.md`.
- The **capture-protocol path** `${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`.

Do not include your own opinion on how to reproduce it. The charter and the recipe are the guidance; anything you add is a third voice the agent has to reconcile.

Read the agent's trailing YAML and branch on one key: `reproduced`.

### 4. Success path — `reproduced: true`

Author the Bug Report body to a temp file, in the exact section order of `${CLAUDE_PLUGIN_ROOT}/docs/bug-report-format.md`. Map the agent's YAML into the sections:

- `## Symptom` — the reporter's original description text, **verbatim**, then the agent's `summary`.
- `## Environment` — the recipe's environment name and host, the date, the account role used.
- `## Steps To Reproduce` — `steps` numbered, then `after` continuing the numbering; then the trap block, verbatim shape:

  ```markdown
  > [!CAUTION]
  > **Trap for QA:** <trapForQA>
  ```

- `## Expected vs Actual` — one line each: the expectation from the ticket, the observed symptom.
- `## Root Cause` — `rootCause`.
- `## Fixed When` — each `fixedWhen` entry as `- [ ] <text>`.
- `## Evidence` — one `![<caption>](./<basename>)` per image, before then after, then one per video.
- `<details><summary>Reproduction Notes</summary>` — the layer, the request and response the agent named, the data setup, the reversible flip and its restore.

Do **not** write the LLM Context block; the CLI splices it. Then write the body:

```bash
flight-rules ticket edit <id> --body-file <path>
```

Write a comment body to a temp file listing the before and after frames as `![<caption>](./<basename>)`, then post it with one `--attach` per manifest item, in phase order — before, then after, then video:

```bash
flight-rules ticket comment <id> --body-file <path> --attach <file>#<caption>
```

Swap the label in one call:

```bash
flight-rules ticket label <id> --remove Agentic-Reproduction-In-Progress --add Agentic-Reproduction-Success
```

### 5. Failure path — `reproduced: false`

Write a one-paragraph comment to a temp file. It **begins** with a reporter mention, then the agent's reason as a lead clause, then the fixed sentence:

```text
@{<reporter accountId>|<reporter display name>} <reason, no trailing period>; couldn't reproduce this from the ticket as written. Could you share any more detail — exact steps, environment, the affected record, or a screenshot/recording?
```

When the agent's reason names a native-only or offline-only surface — mobile app UI, offline mode, a gesture a web client cannot send — the reason is "This appears to be a mobile-app UI issue the automated reproduction cannot exercise yet". Post it:

```bash
flight-rules ticket comment <id> --body-file <path>
```

Swap the label in one call:

```bash
flight-rules ticket label <id> --remove Agentic-Reproduction-In-Progress --add Agentic-Reproduction-Failure
```

### 6. Report

Give the user, in this order: the outcome, the final label, the evidence paths, the ticket URL, and every `openQuestions` entry verbatim.

## Guardrails

- **Never `flight-rules ticket status`.** This skill documents a bug; it never moves the ticket across the board.
- **Never edit code or app data** beyond the reversible flip the agent captures and restores. The agent looks; it never writes. You write only to the tracker.
- **Every tracker write goes through `flight-rules`.** Read-only `git status` and `gh` inspection is fine; native tracker APIs are not.
- **One `ticket label` call per outcome**, removing `In-Progress` and adding the outcome together, so the label is never orphaned.
- **The label lifecycle is exactly** `Agentic-Reproduction-In-Progress`, `Agentic-Reproduction-Success`, and `Agentic-Reproduction-Failure`. No other reproduction label exists.
- **No `AskUserQuestion` in the happy path.** A missing input is a failure with a reason, not a question.

## Error handling

- **Agent returns `openQuestions`** → surface them to the user unanswered, and take the failure path with the reason "reproduction blocked: <first question>", so the ticket is not left in progress.
- **Capture produced nothing** (`evidence.items` empty on `reproduced: true`) → take the failure path with the reason "captured no evidence".
- **A CLI error after step 2** → attempt the failure label swap with the error as the reason, then stop and report. Never leave `In-Progress` behind.
- **Missing recipe or credentials** → stop before step 2 with the missing thing named. Never prompt.

## What Good Looks Like

A reviewer can grade a run against this list:

- The Bug Report body reads top to bottom for a QA who never saw the code, in the section order of `docs/bug-report-format.md`, with the reporter's original description preserved under Symptom.
- The comment shows the symptom and its absence — the before and after frames, captioned, attached natively.
- The ticket carries exactly one of `Agentic-Reproduction-Success` or `Agentic-Reproduction-Failure`, and no run ever leaves `Agentic-Reproduction-In-Progress` behind.
- No code changed, no app data was left mutated, and the ticket's workflow status is untouched.
- On the failure path the comment opens with the reporter mention and carries the fixed sentence, and a native-only or offline-only surface took that path with the surface named.
- The human was never prompted.
