---
name: verify-ticket
description: "Verifies a ticket in the running product once its fix or feature has landed in the target environment: gates on verify-readiness, re-runs a bug's documented reproduction or exercises a story's acceptance criteria through the qa-engineer agent, posts a verdict comment with after evidence, and swaps the Agentic-Verification label. One skill for bugs and stories. Never fixes, never changes workflow status, never prompts. Use when a ticket reaches the QA column."
---

# Verify Ticket

This is the skill that confirms the thing. You are handed a **ticket id**; you hand back a verdict comment, backed by evidence captured in the running product, and exactly one outcome label — or, when an item could not be tested, no label and a stated reason. A fixed bug and a finished story both reach the QA column with nothing yet proving them in the app. This skill produces that proof for either one: it re-runs a bug's recorded reproduction and confirms the symptom is gone, or it exercises a story's acceptance criteria and confirms each held.

**The hard rule: this skill never fixes code or data, never changes workflow status, and never prompts in its happy path.** It reads the contract, dispatches a tester, and records what the tester saw. If you catch yourself editing a file to make an item pass, moving the ticket's board column, or asking the user a question to get past a gate, stop — none of those is this skill's job, and each one destroys the value of an independent after-the-fact check.

**Terminal state:** the ticket carries a verdict comment with a per-item verdict and after evidence, plus exactly one of `Agentic-Verification-Success` or `Agentic-Verification-Failure` — or, when an item was UNVERIFIABLE, no outcome label and a comment stating what blocked verification.

## Preconditions

- You are handed a **ticket id**.
- Run everything from the **repo root of the app the recipe describes** — the `flight-rules` CLI resolves config relative to CWD, and the tester drives that app.
- **The config file is `$FLIGHT_RULES_CONFIG` when that variable is set, otherwise `.claude/flight-rules.local.md`.** The CLI honours the override, so every read and write below means whichever path is in effect.
- `flight-rules check` reports `"ok": true`, including the tool probes the QA lane depends on. A half-configured CLI fails partway through, after it has already labelled the ticket in progress.
- The **tracker is Jira**. The failure mention and the native attachments are Jira shapes.
- The **QA recipe is resolvable**:

  ```bash
  flight-rules qa recipe
  ```

  Its stdout is the recipe path you hand the tester. A non-zero exit is a stop, not a prompt — report the CLI's own error and point the user at setup.
- **Credentials resolve headlessly** — `FLIGHT_RULES_QA_USERNAME` and `FLIGHT_RULES_QA_PASSWORD` in the environment, or the `op://` references the recipe names with `OP_SERVICE_ACCOUNT_TOKEN` exported. The tester resolves them; you only confirm they are present before you mutate the ticket.
- **The fix or feature under test is already deployed** to the recipe's environment. This skill verifies; it does not deploy.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the ticket and detect the format

```bash
flight-rules ticket get <id>
```

The format is **bug** when `issueType` is `Bug` or `metadata.kind` is `bug`; otherwise it is a **story**. Say which you settled on; every later step keys off it.

Stop before touching anything when `labels` already contains `Agentic-Verification-In-Progress` — reason: **another verification is active** for this ticket. Note `assignee` and `reporter` from the JSON; the failure comment mentions one of them.

### 2. Gate on verify-readiness

The gate is a hard stop with a stated reason. It does not label, dispatch, or prompt.

**Bug:**

```bash
flight-rules ticket get <id> --section steps-to-reproduce
```

Stop unless `labels` contains `Agentic-Reproduction-Success` **and** the returned `markdown` is non-null. Reason: **not verify-ready: run reproduce-bug first**. A bug with no recorded reproduction has no script to re-run, so there is nothing to confirm gone.

**Story:**

```bash
flight-rules ticket get <id> --section acceptance-criteria
```

Stop unless `items` is non-empty. Reason: **no acceptance criteria to verify**. A story with no criteria has no contract to exercise.

### 3. Mark the ticket in progress

```bash
flight-rules ticket label <id> --add Agentic-Verification-In-Progress
```

This is the lock. From here on, a CLI error must clear it before you stop (see Error handling).

### 4. Fetch the contract fresh

Read the contract from the ticket now, so a stale copy from step 1 can never stand in for it. Hand the tester only the contract and, for a bug, the recorded script — **never a summary of the fix, the PR, the ticket's comments, or the implementation.** A tester that has read the victory lap is not an independent check.

**Bug** — the Fixed When items are the contract:

```bash
flight-rules ticket get <id> --section fixed-when
```

```bash
flight-rules ticket get <id> --section root-cause
```

plus the Steps To Reproduce from step 2. Hand the tester the `items[].text` numbered, and the recorded steps and root cause verbatim.

**Story** — the Acceptance Criteria items from step 2 are the contract, and the Solution is context only:

```bash
flight-rules ticket get <id> --section solution
```

Hand the tester the `items[].text` numbered.

### 5. Dispatch the tester

Dispatch the **`qa-engineer`** agent in **`verify` mode**, **with `model: sonnet`** passed explicitly. Verify follows a recorded script rather than locating a symptom's layer from scratch, so it runs the cheap tier — the agent declares `opus` for reproduction, and this dispatch overrides it. Hand the agent:

- the **numbered contract items** — Fixed When for a bug, Acceptance Criteria for a story;
- for a bug, the recorded **Steps To Reproduce** and **Root Cause**, verbatim;
- the **recipe path** from Preconditions;
- the **evidence directory** `.claude/evidence/<id>/`;
- the charter `${CLAUDE_PLUGIN_ROOT}/docs/qa-charter.md` and the capture protocol `${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`, whose recipe format is `${CLAUDE_PLUGIN_ROOT}/docs/qa-recipe-format.md`.

Read the single trailing `yaml` block it returns: `items[].{item, verdict, evidence}`, an `evidence.items[].{path, kind, phase, caption}` manifest, `verified`, and an optional `openQuestions`. `verified` is true only when every item is PASS.

### 6. Branch on the verdict, in this order

1. **`verified: true`** — success. Write the comment to a file: the first line is `✅ **Fix verified in staging.** Re-ran the documented reproduction; the bug no longer occurs.` for a bug, or `✅ **Verified in staging.** Exercised each acceptance criterion in the running product.` for a story; then one line per item as `- PASS — <item>: <evidence>`; then each after frame referenced as `![<caption>](./<basename>)`. Post it, then swap the label:

   ```bash
   flight-rules ticket comment <id> --body-file <path> --attach <file>#<caption>
   ```

   ```bash
   flight-rules ticket label <id> --remove Agentic-Verification-In-Progress --add Agentic-Verification-Success
   ```

   Repeat `--attach` once per manifest item, referencing each in the body as `![<caption>](./<basename>)` with the same basename.

2. **Any FAIL** — failure. Write the comment to a file. The first line opens with a mention of the assignee, falling back to the reporter — `@{<accountId>|<display name>}` using that person's `accountId` and display name — then, for a bug, `⚠️ this fix does not resolve the bug — re-running the documented reproduction still triggers it; <reason>. Details/evidence below.`, or, for a story, `⚠️ this change does not satisfy the acceptance criteria — <n> of <m> failed; <reason>. Details/evidence below.`. `<reason>` is the first FAIL item's evidence with any trailing period stripped. A symptom that merely changed shape is a FAIL, not a pass — record its new shape as that item's evidence, per Q-2. Then one line per item with its verdict and evidence, then the evidence references. Post with the same `ticket comment … --attach` form, then swap the label:

   ```bash
   flight-rules ticket label <id> --remove Agentic-Verification-In-Progress --add Agentic-Verification-Failure
   ```

3. **Any UNVERIFIABLE and no FAIL** — the item could not be tested as handed over, which is a contract or environment problem, not a demonstrated defect. Write a comment: `Verification could not complete.` then one line per UNVERIFIABLE item with its evidence and the matching `openQuestions` entry. Post it with `ticket comment`, then remove the lock and add **no** outcome label:

   ```bash
   flight-rules ticket label <id> --remove Agentic-Verification-In-Progress
   ```

   Surface every `openQuestions` entry to the user in the report.

Check FAIL before the UNVERIFIABLE branch: an observed failure is a real signal about the deployed change and belongs on the ticket as `Agentic-Verification-Failure`, whereas UNVERIFIABLE only applies when nothing failed. Never collapse `verified: false` into FAIL without inspecting the items — an item that could not be tested is not an item that failed.

### 7. Report

Give the user, in order: the detected format, the gate result, the per-item verdicts, the final label (or that none was applied), the evidence paths, the ticket URL, and every `openQuestions` entry verbatim.

## Guardrails

- **Never `flight-rules ticket status`.** This skill does not move the board. The QA column is where it runs, not something it advances.
- **Never fix code or data.** A reversible flip the tester captures, observes, and restores is not a fix; anything you would edit to make an item pass is out of bounds.
- **Never re-discover a bug's steps.** The tester replays the recorded reproduction (Q-6). If the steps no longer match the UI, that is a FAIL item with that evidence — you post it, you do not go hunting for a different symptom.
- **Every tracker write goes through `flight-rules`** — `ticket label` and `ticket comment`, never the Jira REST API or `gh`. Read-only inspection with plain `flight-rules ticket get` is fine.
- **The tester never writes; you do.** The `qa-engineer` agent hands back a verdict and files under the evidence directory and nothing else. Comments and labels are yours.
- **No `AskUserQuestion` in the happy path.** A missing recipe or credential is a stop with a named reason, not a question.
- **Success and failure are each exactly one `ticket label` call** that removes the lock and adds the outcome in the same invocation.

## Error handling

- **Capture failed** — `verified: true` but `evidence.items` is empty. Do not post a success with no proof. Take the UNVERIFIABLE path with the reason **captured no evidence**: remove the lock, add no outcome label, and report it.
- **CLI error after step 3** — the lock is on and a later command failed. Attempt `flight-rules ticket label <id> --remove Agentic-Verification-In-Progress`, then stop and report; do not retry the dispatch and do not leave the ticket locked.
- **Missing recipe or credentials** — stop **before** step 3, name the missing thing (the recipe path, or which credential variable is empty), and never prompt. Nothing is labelled, so there is no lock to clear.

## What Good Looks Like

A reviewer can grade a run against this list:

- The comment lets a human see the fix or the feature working without opening the app: a per-item verdict, each backed by evidence at the layer the reproduction named, and after frames that render inline.
- Exactly one outcome label — `Agentic-Verification-Success` or `Agentic-Verification-Failure` — or, for an UNVERIFIABLE run, none, plus a comment stating what blocked verification.
- `Agentic-Verification-In-Progress` was added at the start and removed in the same call that set the outcome; it is never left hanging.
- No code, no data, and no board status changed; the human was never prompted.
- A bug marked verified is a symptom gone, not a symptom changed; a failure names the FAIL item and mentions the assignee, or the reporter when there is no assignee.
- Every `openQuestions` entry reached the user, unanswered.
