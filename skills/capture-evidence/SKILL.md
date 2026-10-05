---
name: capture-evidence
description: "Headless web-client capture for the QA lane: takes capture directions and the repo's QA instructions, drives playwright-cli for one verified 1080p take with before/after screenshots, and writes an evidence manifest under .claude/evidence/<ticket>/. Never prompts; never writes to the tracker, git, or a PR. Invoked by reproduce-bug, verify-ticket, and execute-work — not usually by hand."
---

# Capture Evidence

This skill turns capture directions plus the repo's QA instructions into a verified take and a manifest, asking no one anything. It drives `playwright-cli` for one take at 1920×1080. It brackets the take with before and after screenshots and gates it on those screenshots rather than the exit code. It then writes the manifest the QA lane consumes. Its callers — `reproduce-bug`, `verify-ticket`, and `execute-work` — invoke it inside a larger flow, so it must finish or fail on its own.

**This skill never prompts and never writes anywhere except `.claude/evidence/<ticket>/`.** A missing input is a failure with a reason, not a question.

**Terminal state:** the manifest exists at `.claude/evidence/<ticket>/manifest.json`, every item it lists exists on disk and passed verification, and the caller holds the manifest path plus a one-line summary — or the caller holds a single line beginning `No visual evidence:` with the reason.

Run `flight-rules doc evidence-capture` and read the full output for the protocol: named sessions, the viewport paired with `--size`, the one-take rule, `video-chapter` narration, the credential rules, the `ffprobe`/`ffmpeg` verification, and the manifest schema. Run `flight-rules doc qa-instructions` and read the full output for where QA instructions live and what they usually cover. Read both outputs before you plan a take. This skill points at them and restates neither.

## Inputs

The caller passes:

- **`ticket`** — the tracker id. It names both the evidence directory (`.claude/evidence/<ticket>/`) and the browser session (`fr-<ticket>`).
- **`directions`** — a short markdown block stating what to show, which phases are wanted (`before` and `after`, or `after` only), an optional API symptom written as "the `<method> <path>` response field `<name>` should …", and an optional environment name.
- **`from`** (optional) — the directory of the code the ticket touches. Defaults to the working directory.

The QA instructions are not passed in. Read them from the CLI:

```bash
flight-rules qa instructions --from <from>
```

## Preconditions

Each of these is a hard stop. When one fails, return the exact message and write nothing further. `flight-rules check` reports the tool versions too. This skill re-probes because it is often the first thing to run on a fresh machine.

- `playwright-cli --version` prints `0.1.17` or later. Otherwise return `No visual evidence: playwright-cli 0.1.17 or later is required on PATH`.
- `ffmpeg -version` and `ffprobe -version` both succeed. Otherwise return `No visual evidence: ffmpeg and ffprobe are required on PATH`.
- `flight-rules qa instructions` reports `"found": true`. Otherwise return `No visual evidence: no QA instructions found — add a QA.md at the repo root or a QA section in AGENTS.md (see docs/qa-instructions.md)`.
- The instructions describe a web surface a browser can reach. Otherwise return `No visual evidence: the QA instructions describe no web surface for this change`.
- `git check-ignore -q .claude/evidence` exits 0. Otherwise return `No visual evidence: .claude/evidence is not gitignored in this repo; add .claude/ to .gitignore`. An un-ignored evidence directory dirties the working tree, and a caller that commits by path sweeps it in.
- Every credential and access the take needs is available (step 2). Otherwise return `No visual evidence: needs: <exactly what to provide>`.

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the instructions and the directions

Read every source the CLI returned, nearest first. A nearer source wins where two disagree; a farther one fills in what the nearer one leaves out. When a source carries `"legacy": true`, use it and include its `hint` in the report.

From the instructions, note: the environment to use (the one the directions name, else the instructions' default), its app URL, the viewport (default `1920x1080`), the login or auth-workaround steps, what the logged-in state looks like, the credentials and where each comes from, and any trap that touches the flow the directions describe.

Decide the phases from the directions. A bug wants `before` and `after`; a story or a shipped change wants `after` only. The directions override this default when they state otherwise.

`mkdir -p .claude/evidence/<ticket>` first, then write `.claude/evidence/<ticket>/plan.md`: the ordered steps, the chapter titles, which step yields the before screenshot and which yields the after screenshot, and the API request to inspect when the directions name one.

### 2. Check access

For each credential the instructions name, decide where it comes from and confirm it is there without printing it:

- **An environment variable** — `printenv <VAR> >/dev/null && echo set`. Empty means stop with `No visual evidence: needs: export <VAR> (<what the instructions say it is>)`.
- **A secrets manager the instructions name, such as `op run`** — write `.claude/evidence/<ticket>/qa.env` with the reference lines the instructions give. This file holds references, never secrets. Do not pre-check the manager's sign-in state; the take runs inside it in step 4.
- **Something a human must supply** that the environment does not already provide — stop with `No visual evidence: needs: <what to provide, and where the instructions say it comes from>`.

When the instructions need no credentials, record `credentials: none`. Otherwise record where they came from (`environment`, or the manager's name) in the plan.

Never run a secret-reading command, such as `op read`, in a Bash call whose output you see. A resolved secret exists only inside the take subprocess.

### 3. Write the take

Generate `.claude/evidence/<ticket>/take.sh` from the skeleton in Section 5 of the `flight-rules doc evidence-capture` output. Use `set -uo pipefail`, never `set -e`: `playwright-cli` exits 0 on a failed step, so `-e` hides the failure, and the verification checks are the real gate. Fill in:

- The session `fr-<ticket>` on every `playwright-cli` call via `-s=fr-<ticket>`.
- `resize` and `video-start … --size=<viewport>` both set to the viewport, so the take is not scaled to the recorder's 800×800 default.
- `goto "$APP_URL"`, then the login or auth-workaround steps from the instructions as `fill`/`click`/`check` calls, passing credentials as `"$VARIABLE"` references, never literal values.
- A `find` for the logged-in marker, then `state-save`.
- The planned steps, each with a `video-chapter` card and a one-second `sleep` between actions.
- `screenshot --filename` at the before point (when the phase is wanted) and the after point.
- `video-start` gated on a `find` for a real element, so recording does not begin on a blank page, and `video-stop` after the last recorded step. `close` last.
- The three verification commands from Section 6, writing the `ffprobe` dimensions to `"$OUT/dims.txt"`, extracting `frame-2s.png`, and writing the `blackdetect` count to `"$OUT/black.txt"`.

When the directions name an API symptom, add `$PW requests > "$OUT/requests.txt"` after the step that triggers the call, then `$PW request <index> > "$OUT/request.txt"` for the matching line. Write the grep that finds the index from the path into the script.

Make the script executable.

### 4. Run the take, once

Run the whole script in one Bash call, per the one-take rule. Splitting it across calls records the gaps as dead air, and another job may reuse the session between calls.

- **Environment or no credentials:** `bash .claude/evidence/<ticket>/take.sh <ticket> <appUrl>`.
- **Secrets manager:** wrap the same command as the instructions say, for example `op run --env-file=.claude/evidence/<ticket>/qa.env -- bash .claude/evidence/<ticket>/take.sh <ticket> <appUrl>`. The manager exposes the values only to the subprocess. When it fails because nobody is signed in, stop with `No visual evidence: needs: <sign in to the manager, as its error says>`.

### 5. Verify

Check the recorded take against the three gates, not the exit code:

- Read `dims.txt`. It must equal the viewport, `1920,1080` by default.
- Confirm `frame-2s.png` exists and is not empty.
- Read `black.txt`. It must be `0`.

Then open `before.png` (when captured) and `after.png` with the Read tool and confirm each shows the surface the directions describe, not a login form or a blank page.

When any check fails, re-plan once. A selector that did not match is the usual cause: run `playwright-cli -s=fr-<ticket> snapshot` in a separate probe to find the real selector. Add a `find` gate when the page had not painted. Return to step 3 one time. A second failure stops the run with `No visual evidence: <the failing check and what it showed>`.

### 6. Same-layer confirmation

Run this step only when the directions named an API symptom. Read `request.txt` and confirm the response carries the symptom field (for a `before` phase) or lacks it (for an `after` phase). Put the request index and the observed value into the caption of the matching screenshot. When the request is absent from the list, say so in the report and do not invent it.

### 7. Write the manifest

Write `.claude/evidence/<ticket>/manifest.json` to the schema in Section 10 of the `flight-rules doc evidence-capture` output:

- `version: 1`, `ticket`, `instructions` (the absolute paths of the QA instruction sources from step 1, nearest first), `capturedAt` (an ISO 8601 timestamp in UTC).
- `items`, one per captured file, each with an absolute `path`, `kind` derived from the extension (`png` is `image`, `webm` is `video`), `phase` set per item, and a one-sentence caption. Include `take.webm` with the phase of the flow it shows.

Do not list `frame-2s.png`, `auth.json`, `qa.env`, `plan.md`, or `take.sh`.

### 8. Report

On success, return the manifest path, then one line per item as `phase kind — caption`, then the credentials line from step 2, then any note from step 6 and any legacy hint from step 1.

On failure, return exactly one line beginning `No visual evidence:` followed by the reason. Leave `plan.md` and any partial files on disk for a human.

## Guardrails

- Never `AskUserQuestion`. A missing input is a failure with a reason.
- Never write outside `.claude/evidence/<ticket>/`.
- Never call `flight-rules ticket …`, `flight-rules pr …`, or `gh`, and never call `git` for anything but `git check-ignore`.
- Never echo a credential, and never run a secret-reading command where its output is visible.
- Never pass `--headed`. The browser stays headless.
- One take per attempt, at most two attempts.

## Error handling

| Failure | Message returned | What the caller does |
| --- | --- | --- |
| No QA instructions | `No visual evidence: no QA instructions found — …` | Adds a `QA.md` or a `QA` section in `AGENTS.md`, then re-invokes. |
| No web surface in the instructions | `No visual evidence: the QA instructions describe no web surface for this change` | Records it; verification happens another way. |
| A credential or access is missing | `No visual evidence: needs: <what to provide>` | Provides it, then re-invokes. |
| Login selectors do not match | re-plan once with `snapshot`; then `No visual evidence: login form did not match the QA instructions (<selector>)` | Fixes the login steps in the QA instructions. |
| Wrong dimensions or detected black | `No visual evidence: <the failing check and what it showed>` | Reads the reason and the plan left on disk. |
| `.claude/evidence` not gitignored | `No visual evidence: .claude/evidence is not gitignored in this repo; add .claude/ to .gitignore` | Adds `.claude/` to `.gitignore`. |

## What Good Looks Like

A reviewer can grade a run against this list:

- One Bash call recorded the take; the take was never split across calls.
- The manifest lists only files that exist and passed verification, with absolute paths, `kind` from the extension, a `phase` per item, and one-sentence captions.
- No secret appears in any command output or in any file on disk; `qa.env`, when present, holds references, not resolved values.
- The caller never had to answer a question.
- `git status --porcelain` is unchanged after the run.
- A failure is one line beginning `No visual evidence:`, with `plan.md` left in place for a human.
