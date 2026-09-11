# QA Standards

These are mandates, not preferences. Violations are reviewable findings.

They govern the QA lane: reproducing a bug, verifying a bug fix or a story in
the running product, and the evidence either one produces. They do not govern
source code (see `coding-charter.md`) or prose (see `prose-charter.md`).

---

## Definitions

**Reproduced** — the symptom appeared at the layer that carries it, more than
once, by following steps another person can repeat exactly.

**Verified** — the contract holds in the running product. For a bug, the
recorded reproduction no longer triggers the symptom at the same layer. For a
story, each acceptance criterion was exercised and held.

**Evidence manifest** — the list of captured files you hand back. Each entry
names a path, a kind (image or video), a phase (before or after), and a
caption.

**Same layer** — the API response, database row, or rendered element where the
reproduction located the symptom. You confirm there, not somewhere that
happens to look better.

---

## Q-1 — Reproduce at the layer that carries the symptom

A screen shows a symptom. An API response or a stored value carries it. Locate
the call or the value, name it in your steps, and reproduce it twice, not
once.

Write: "The `/v1/claims/42` response returns `status: null`, observed twice."
Not: "The claim status looks wrong on the screen."

**Why:** a one-off on a screen is noise. The layer you name is what the fix
changes and what verification re-checks.

## Q-2 — Verified means gone, not different

Mark a bug verified only when the symptom you reproduced no longer triggers at
the same layer. A symptom that changed shape is a new finding, and it fails.

Banned: marking PASS because a 500 error became a 400 error at the same
endpoint.

**Why:** a fix that moves a bug is not a fix. A changed symptom deserves its
own report, not credit toward the old one.

## Q-3 — Confirm at the same layer the reproduction identified

Verify at the layer where you found the symptom. A screen that renders
correctly does not confirm a fix if the call underneath it still carries the
symptom.

Banned: closing an item as fixed because the page looks right, without
checking the response that carried the original symptom.

**Why:** rendering can mask stale data. The screen is the last place a bad
value shows up, not the first.

## Q-4 — One take, full size, frames verified

Record the entire flow in one Bash call at a 1920×1080 viewport, matched to
the browser window. Extract a frame with ffmpeg and check its dimensions
before you trust the clip.

Banned: trusting a recording you never opened. Banned: a capture left at the
recorder's 800×800 default.

**Why:** the recorder scales down by default and exits 0 on failure. A black
or undersized take looks like success until someone watches it.

## Q-5 — Before and after for a bug, after for a story

For a bug, capture a before frame showing the symptom and an after frame
showing its absence. For a story, capture after frames showing each
acceptance criterion held.

Banned: submitting a bug fix with only an after frame. The reviewer has
nothing to contrast it against.

**Why:** a reviewer needs the contrast to judge a bug fix and the proof to
judge a story.

## Q-6 — Follow the recorded steps

Verification replays the documented reproduction. It does not re-discover the
bug. If the steps no longer match the UI, report that as a separate finding.

Banned: clicking around until you find something wrong, then calling it
verification of the original report.

**Why:** re-discovery repeats a judgment the reproduction already made, and it
hides UI drift the next reader needs to know about.

## Q-7 — Reversible mutations only

Capture the original value before you change it, flip it, observe the result,
restore it, and confirm the restore. When a flip does not apply, build a
matched control beside the failing case. Prefer read-only confirmation when
you can.

Banned: leaving a staging record mutated because the check passed.

**Why:** staging is shared. Data you leave polluted becomes someone else's
false bug tomorrow.

## Q-8 — Write for a QA who never saw the code

Number your steps, before then after. State the root cause in one line. Add a
Trap for QA note naming why the bug can look fixed when it is not.

Write: "Trap for QA: the list re-sorts on refresh, so a stale row can look
correct after reload."

**Why:** the steps outlive your run. The next reader is a person who was not
in this session.

## Q-9 — Default to FAIL

Mark an item PASS only with evidence you observed yourself: a response you
read, a frame you captured, a value you checked.

Banned: passing an item because the reporter says it works, the implementer
says it's fixed, or the test suite is green.

**Why:** the QA lane exists because those sources were not enough on their
own.

## Q-10 — A surface the harness cannot reach is a failure with a reason

When the harness cannot exercise a surface, take the failure path and state
the reason. This covers native mobile UI, offline mode, and gestures a web
client cannot send.

Write: "FAIL: this flow needs a native swipe gesture; the harness drives a
browser and cannot send one." Not a guess dressed up as a reproduction.

**Why:** a false reproduction is worse than an honest refusal. It tells the
next reader the bug was checked when it wasn't.
