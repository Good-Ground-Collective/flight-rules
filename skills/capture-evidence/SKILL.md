---
name: capture-evidence
description: "Headless web-client capture for the QA lane: takes capture directions and the per-repo QA recipe, drives playwright-cli for one verified 1080p take with before/after screenshots, and writes an evidence manifest under .claude/evidence/<ticket>/. Never prompts; never writes to the tracker, git, or a PR. Invoked by reproduce-bug, verify-ticket, and execute-work — not usually by hand."
---

# Capture Evidence

This skill turns capture directions plus a QA recipe into a verified take and a manifest, asking no one anything. It drives `playwright-cli` for one take at 1920×1080. It brackets the take with before and after screenshots and gates it on those screenshots rather than the exit code. It then writes the manifest the QA lane consumes. Its callers — `reproduce-bug`, `verify-ticket`, and `execute-work` — invoke it inside a larger flow, so it must finish or fail on its own.

**This skill never prompts and never writes anywhere except `.claude/evidence/<ticket>/`.** A missing input is a failure with a reason, not a question.

**Terminal state:** the manifest exists at `.claude/evidence/<ticket>/manifest.json`, every item it lists exists on disk and passed verification, and the caller holds the manifest path plus a one-line summary — or the caller holds a single line beginning `No visual evidence:` with the reason.

The protocol this skill obeys is `${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`: named sessions, the viewport paired with `--size`, the one-take rule, `video-chapter` narration, the credential contract, the `ffprobe`/`ffmpeg` verification, and the manifest schema. The recipe format is `${CLAUDE_PLUGIN_ROOT}/docs/qa-recipe-format.md`: `environments`, `credentials` as `op://` references or variable names, and the Login, Token mint, Data setup, Traps, and Visible surfaces sections. Read both in full before you plan a take. This skill points at them and restates neither.

## Inputs

The caller passes two things and nothing else:

- **`ticket`** — the tracker id. It names both the evidence directory (`.claude/evidence/<ticket>/`) and the browser session (`fr-<ticket>`).
- **`directions`** — a short markdown block stating what to show, which phases are wanted (`before` and `after`, or `after` only), an optional API symptom written as "the `<method> <path>` response field `<name>` should …", and an optional environment name.

The recipe path is not passed in. Read it from the CLI:

```bash
flight-rules qa recipe
```

## Preconditions

Each of these is a hard stop. When one fails, return the exact message and write nothing further. `flight-rules check` reports the tool versions too. This skill re-probes because it is often the first thing to run on a fresh machine.

- `playwright-cli --version` prints `0.1.17` or later. Otherwise return `No visual evidence: playwright-cli 0.1.17 or later is required on PATH`.
- `ffmpeg -version` and `ffprobe -version` both succeed. Otherwise return `No visual evidence: ffmpeg and ffprobe are required on PATH`.
- `flight-rules qa recipe` exits 0. Its stdout is the recipe path. Otherwise return the CLI's own error so the caller can run setup.
- `git check-ignore -q .claude/evidence` exits 0. Otherwise return `No visual evidence: .claude/evidence is not gitignored in this repo; add .claude/ to .gitignore`. An un-ignored evidence directory dirties the working tree, and a caller that commits by path sweeps it in.
- Credentials resolve (step 2). Otherwise return `No visual evidence: credentials unavailable — export FLIGHT_RULES_QA_USERNAME and FLIGHT_RULES_QA_PASSWORD, or set credentials in the recipe and export OP_SERVICE_ACCOUNT_TOKEN`.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the recipe and the directions

Read the recipe file in full. Pick the environment: the one the directions name, else `defaultEnvironment`. Note `appUrl`, `apiUrl`, `viewport` (default `1920x1080`), the Login selectors, and any Trap that touches the flow the directions describe.

Decide the phases from the directions. A bug wants `before` and `after`; a story or a shipped change wants `after` only. The directions override this default when they state otherwise.

`mkdir -p .claude/evidence/<ticket>` first, then write `.claude/evidence/<ticket>/plan.md`: the ordered steps, the chapter titles, which step yields the before screenshot and which yields the after screenshot, and the API request to inspect when the directions name one.

### 2. Resolve credentials

Check the contract variables first:

```bash
echo "${FLIGHT_RULES_QA_USERNAME:+set} ${FLIGHT_RULES_QA_PASSWORD:+set}"
```

Branch on the result:

- **Both print `set`** — skip `op` entirely. Record `credentials: environment` in the plan and go to step 3.
- **The recipe's `credentials` are `op://` references** — confirm 1Password is authenticated with `op whoami --format=json`, which exits non-zero when nothing is signed in. On a non-zero exit, stop with the credentials message plus `1Password is not authenticated; export OP_SERVICE_ACCOUNT_TOKEN for headless runs`. On success, write `.claude/evidence/<ticket>/qa.env` with reference lines taken from the recipe:

  ```
  FLIGHT_RULES_QA_USERNAME=op://<vault>/<item>/username
  FLIGHT_RULES_QA_PASSWORD=op://<vault>/<item>/password
  ```

  Add `FLIGHT_RULES_QA_TOTP_SECRET=op://<vault>/<item>/one-time password` only when the recipe defines `totp`. This file holds references, never secrets. Record `credentials: 1Password via op run`.
- **The recipe names environment variables** — check each with `${VAR:+set}` and export it under the contract name inside the take script. A variable that reads empty stops the run with the credentials message.
- **None of the above** — stop with the credentials message.

Never run `op read` in a Bash call whose output you see. A resolved secret exists only inside the take subprocess.

### 3. Write the take

Generate `.claude/evidence/<ticket>/take.sh` from the skeleton in `${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`, Section 5. Use `set -uo pipefail`, never `set -e`: `playwright-cli` exits 0 on a failed step, so `-e` hides the failure, and the verification checks are the real gate. Fill in:

- The session `fr-<ticket>` on every `playwright-cli` call via `-s=fr-<ticket>`.
- `resize` and `video-start … --size=<viewport>` both set to the recipe's `viewport`, so the take is not scaled to the recorder's 800×800 default.
- `goto "$APP_URL"`, then the Login steps from the recipe as `fill`/`click`/`check` with the recipe's selectors, passing `"$FLIGHT_RULES_QA_USERNAME"` and `"$FLIGHT_RULES_QA_PASSWORD"` as values.
- A `find` for the logged-in marker from the recipe, then `state-save`.
- The planned steps, each with a `video-chapter` card and a one-second `sleep` between actions.
- `screenshot --filename` at the before point (when the phase is wanted) and the after point.
- `video-start` gated on a `find` for a real element, so recording does not begin on a blank page, and `video-stop` after the last recorded step. `close` last.
- The three verification commands from Section 6, writing the `ffprobe` dimensions to `"$OUT/dims.txt"`, extracting `frame-2s.png`, and writing the `blackdetect` count to `"$OUT/black.txt"`.

When the directions name an API symptom, add `$PW requests > "$OUT/requests.txt"` after the step that triggers the call, then `$PW request <index> > "$OUT/request.txt"` for the matching line. Write the grep that finds the index from the path into the script.

Make the script executable.

### 4. Run the take, once

Run the whole script in one Bash call, per the one-take rule. Splitting it across calls records the gaps as dead air, and another job may reuse the session between calls.

- **Environment path:** `bash .claude/evidence/<ticket>/take.sh <ticket> <appUrl>`.
- **1Password path:** `op run --env-file=.claude/evidence/<ticket>/qa.env -- bash .claude/evidence/<ticket>/take.sh <ticket> <appUrl>`. `op run` resolves every `op://` reference and exposes the values only to the subprocess, so the script inherits `FLIGHT_RULES_QA_*` without this skill ever printing them.

### 5. Verify

Check the recorded take against the three gates, not the exit code:

- Read `dims.txt`. It must equal the recipe's viewport, `1920,1080` by default.
- Confirm `frame-2s.png` exists and is not empty.
- Read `black.txt`. It must be `0`.

Then open `before.png` (when captured) and `after.png` with the Read tool and confirm each shows the surface the directions describe, not a login form or a blank page.

When any check fails, re-plan once. A selector that did not match is the usual cause: run `playwright-cli -s=fr-<ticket> snapshot` in a separate probe to find the real selector. Add a `find` gate when the page had not painted. Return to step 3 one time. A second failure stops the run with `No visual evidence: <the failing check and what it showed>`.

### 6. Same-layer confirmation

Run this step only when the directions named an API symptom. Read `request.txt` and confirm the response carries the symptom field (for a `before` phase) or lacks it (for an `after` phase). Put the request index and the observed value into the caption of the matching screenshot. When the request is absent from the list, say so in the report and do not invent it.

### 7. Write the manifest

Write `.claude/evidence/<ticket>/manifest.json` to the schema in `${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`, Section 10:

- `version: 1`, `ticket`, `recipe` (the absolute recipe path from step 1), `capturedAt` (an ISO 8601 timestamp in UTC).
- `items`, one per captured file, each with an absolute `path`, `kind` derived from the extension (`png` is `image`, `webm` is `video`), `phase` set per item, and a one-sentence caption. Include `take.webm` with the phase of the flow it shows.

Do not list `frame-2s.png`, `auth.json`, `qa.env`, `plan.md`, or `take.sh`.

### 8. Report

On success, return the manifest path, then one line per item as `phase kind — caption`, then `credentials: environment` or `credentials: 1Password via op run`, then any note from step 6.

On failure, return exactly one line beginning `No visual evidence:` followed by the reason. Leave `plan.md` and any partial files on disk for a human.

## Guardrails

- Never `AskUserQuestion`. A missing input is a failure with a reason.
- Never write outside `.claude/evidence/<ticket>/`.
- Never call `flight-rules ticket …`, `flight-rules pr …`, or `gh`, and never call `git` for anything but `git check-ignore`.
- Never echo a credential, and never run `op read` where its output is visible.
- Never pass `--headed`. The browser stays headless.
- One take per attempt, at most two attempts.

## Error handling

| Failure | Message returned | What the caller does |
| --- | --- | --- |
| `flight-rules qa recipe` exits non-zero | the CLI's own error | Runs setup, then re-invokes. |
| Credentials unresolvable | the credentials message from Preconditions | Exports the variables or sets the recipe's `credentials`. |
| 1Password not authenticated | `No visual evidence: 1Password is not authenticated; export OP_SERVICE_ACCOUNT_TOKEN` | Exports `OP_SERVICE_ACCOUNT_TOKEN`. |
| Login selectors do not match | re-plan once with `snapshot`; then `No visual evidence: login form did not match the recipe selectors (<selector>)` | Fixes the recipe's Login selectors. |
| Wrong dimensions or detected black | `No visual evidence: <the failing check and what it showed>` | Reads the reason and the plan left on disk. |
| `.claude/evidence` not gitignored | `No visual evidence: .claude/evidence is not gitignored in this repo; add .claude/ to .gitignore` | Adds `.claude/` to `.gitignore`. |

## What Good Looks Like

A reviewer can grade a run against this list:

- One Bash call recorded the take; the take was never split across calls.
- The manifest lists only files that exist and passed verification, with absolute paths, `kind` from the extension, a `phase` per item, and one-sentence captions.
- No secret appears in any command output or in any file on disk; `qa.env` holds `op://` references, not resolved values.
- The caller never had to answer a question.
- `git status --porcelain` is unchanged after the run.
- A failure is one line beginning `No visual evidence:`, with `plan.md` left in place for a human.
