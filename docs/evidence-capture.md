# Evidence Capture — Protocol and Manifest

How a web-client capture is taken, verified, and handed downstream. This file is
tool-generic: it names `playwright-cli` and `ffmpeg`, but no hosts, selectors,
endpoints, or credentials. Those live in the repo's QA instructions
(`docs/qa-instructions.md`). A skill references this file as
`${CLAUDE_PLUGIN_ROOT}/docs/evidence-capture.md`.

## 1. Purpose

A take is one recorded run of a flow, plus the before and after frames that
bracket it. A capturing skill writes the files and a manifest describing them.
`reproduce-bug`, `verify-ticket`, and `execute-work` read the manifest and
attach the evidence to a ticket or a pull request.

## 2. Prerequisites

- `playwright-cli` 0.1.17 or later on `PATH` (`npm install -g @playwright/cli`).
- `ffmpeg` and `ffprobe` on `PATH`, for frame extraction and dimension checks.
- Whatever the QA instructions name for access, such as a secrets-manager CLI.

`flight-rules check` reports whether these are present and at which version. This
file installs nothing and assumes `check` already passed.

## 3. Session and viewport

Always pass `-s=<name>`. The default session is shared across parallel runs, so
another run navigates your page mid-take. Name the session after the ticket,
`fr-<ticket>`, so two runs never collide.

Always `resize 1920 1080`, and always pair it with `video-start <file>
--size=1920x1080`. Without `--size`, the recorder scales the clip to fit 800×800
and the frames come out soft. The browser runs headless by default. A skill never
passes `--headed`.

## 4. The one-take rule

A take is one shell script, run in one Bash call. Each Bash call starts after the
previous one returns, so a flow split across calls records the gaps as dead air.

Plan the take before you record it. List every step, the before frame, the after
frame, and the chapter titles. Write the script from that list, then run it once.
Re-plan a failed take from the beginning. Do not patch it mid-recording.

## 5. Recording a take

The complete script. Login steps come from the QA instructions; the credential
rules are Section 8.

```bash
#!/usr/bin/env bash
set -uo pipefail                      # not -e: playwright-cli exits 0 on script errors
TICKET="$1"; APP_URL="$2"
OUT=".claude/evidence/${TICKET}"; mkdir -p "$OUT"
PW="playwright-cli -s=fr-${TICKET}"

$PW open
$PW resize 1920 1080
$PW goto "$APP_URL"
# login steps come from the QA instructions; credentials arrive as
# environment variables the instructions name, e.g. "$ACME_QA_EMAIL"
$PW state-save "$OUT/auth.json"

$PW screenshot --filename="$OUT/before.png"
$PW video-start "$OUT/take.webm" --size=1920x1080
$PW video-chapter "Reproduce" --description="Open the failing record" --duration=2000
# ... the steps, with short sleeps between them ...
$PW video-chapter "Result" --description="What the viewer should see" --duration=2000
$PW video-stop
$PW screenshot --filename="$OUT/after.png"
$PW close

# frame verification — the real gate (Section 6)
ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
  -of csv=p=0 "$OUT/take.webm"
ffmpeg -y -loglevel error -ss 2 -i "$OUT/take.webm" -frames:v 1 "$OUT/frame-2s.png"
```

`video-show-actions` is a mode, not a per-step callout. It annotates every
following action with a cursor and a label until `video-hide-actions` turns it
off. Turn it on once after `video-start` when you want cursor callouts across the
whole take. Per-step narration is `video-chapter`, which cards a title over the
clip for its `--duration`.

## 6. Verifying a take

`playwright-cli` exits 0 when a click or a fill fails. The exit code is not a
signal, so the frames are the gate. Check three things against the recorded clip:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
  -of csv=p=0 "$OUT/take.webm"
# expect: 1920,1080

ffmpeg -y -loglevel error -ss 2 -i "$OUT/take.webm" -frames:v 1 "$OUT/frame-2s.png"
# a real frame confirms the recorder painted the page

ffmpeg -loglevel info -i "$OUT/take.webm" \
  -vf "blackdetect=d=1:pic_th=0.98" -an -f null - 2>&1 | grep -c black_start
# expect: 0 (a count above 0 means a black stretch of at least one second)
```

Wrong dimensions, a missing frame, or detected black means the take failed.
Report the reason and re-plan; a soft or black take reads as success until
someone opens it.

## 7. Same-layer confirmation

When a direction names an application programming interface (API) symptom,
capture it at that layer. `requests` lists the network requests since the page
loaded, each with a number. `request <index>` shows one request in full: its
headers, its body, and the response. Read the symptom straight from that output.
Because `request` already carries the response, you need no separate response
command.

Record the request index and the field that carries the symptom in the caption
of the screenshot that shows it. A reviewer then reads the manifest and knows
which call to inspect.

## 8. Credentials

The QA instructions name each credential and where it comes from: an environment
variable, a secrets-manager item, or a human. The take script reads credentials
from the environment and never echoes them.

When the instructions use a secrets manager, write an env file of reference
lines, never resolved values, and run the take inside the manager's wrapper. For
1Password:

```bash
op run --env-file=qa.env -- bash take.sh "$TICKET" "$APP_URL"
```

The secrets exist only inside that subprocess. Do not pre-check the manager's
sign-in state: `op whoami` blocks on an unlock prompt when no terminal is
attached. Let the wrapped take fail and report its error.

When a credential the take needs is missing and the instructions say a human
supplies it, the capture stops with `No visual evidence: needs: <what to
provide>`. A QA skill never prompts.

## 9. Output layout

Every file lands under `.claude/evidence/<ticket>/`: `before.png` and
`after.png` for the bracketing frames, `take.webm` for the run, `frame-2s.png`
for the extracted verification frame, `auth.json` for saved storage state,
`qa.env` for secrets-manager references (never resolved secrets), `take.sh` for the
script that produced the take, and `manifest.json` for the manifest (Section
10).

`.claude/` must be gitignored so the working tree stays clean. Confirm it before
you write anything: `git check-ignore -q .claude/evidence` exits 0 when the path
is ignored.

## 10. Evidence manifest

The manifest is a skill-to-skill contract. A capturing skill writes it; a
consuming skill reads it and turns each item into an `--attach '<path>#<caption>'`
flag for `ticket comment`, `ticket edit`, `pr create`, and `pr comment`. No code
in this plugin parses it, so it is documented JSON, not a validated schema.

Top-level fields:

| Field | Type | Rule |
| --- | --- | --- |
| `version` | number | Manifest schema version. `1`. |
| `ticket` | string | Tracker id the capture belongs to. |
| `instructions` | string[] | Absolute paths of the QA instruction sources that drove the take, nearest first. |
| `capturedAt` | string | Capture time as an ISO 8601 timestamp in UTC. |
| `items` | array | One entry per captured file. |

Each `items` entry:

| Field | Type | Rule |
| --- | --- | --- |
| `path` | string | Absolute path to the file. |
| `kind` | string | `image`, `video`, or `text`, derived from the extension. |
| `phase` | string | `before` or `after`. |
| `caption` | string | One sentence a reviewer reads with the attachment. |

Derive `kind` from the file extension, never by hand. `png`, `jpg`, `jpeg`,
`gif`, `webp`, and `svg` are `image`; `webm`, `mp4`, and `mov` are `video`;
`txt`, `log`, and `json` are `text`. Text evidence comes from a check that has no
browser surface: a request and response, a command's output, a log line.

`phase` is `before` or `after`. A capture with no before frame uses `after`
alone.

A complete manifest:

```json
{
  "version": 1,
  "ticket": "PROJ-123",
  "instructions": ["/repo/QA.md"],
  "capturedAt": "2026-09-10T03:00:00Z",
  "items": [
    { "path": "/repo/.claude/evidence/PROJ-123/before.png", "kind": "image", "phase": "before", "caption": "Score reads 0% FAIL on a passing section" },
    { "path": "/repo/.claude/evidence/PROJ-123/take.webm",  "kind": "video", "phase": "before", "caption": "Full reproduction, one take" },
    { "path": "/repo/.claude/evidence/PROJ-123/after.png",  "kind": "image", "phase": "after",  "caption": "Score agrees with the section" }
  ]
}
```

## 11. Troubleshooting

- **Soft or pixelated video.** `--size` was omitted, so the clip fits 800×800.
  Match `video-start --size` to the `resize` viewport.
- **Identical screenshots, or a page that jumps to another route mid-take.** Two
  runs share one session. Pass `-s=fr-<ticket>`.
- **A black take.** Recording started before the page painted. Gate
  `video-start` on a `find` for a real element first.
- **The login form is not found.** Selectors belong to the QA instructions.
  Confirm them against the live page with `snapshot`.
- **`interactive IO not available` from `op`.** No terminal is attached. Report
  `needs:` a service-account token in `OP_SERVICE_ACCOUNT_TOKEN`, or another
  credential route the QA instructions allow.
