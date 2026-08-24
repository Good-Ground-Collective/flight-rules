---
name: review-prose
description: "Reviews or rewrites human-readable prose against the bundled prose charter and strips machine-writing tells. Takes a chunk of text or a filepath, in either feedback mode (findings only) or rewrite mode (the skill applies the tech-writer agent's proposed edits). For RFCs, tickets, design docs, READMEs, PR descriptions, release notes — never for source code. Use when a written artifact needs to read like a human wrote it."
---

# Review Prose

This skill puts a written artifact through the `tech-writer` agent and then acts
on what comes back. The two modes differ in what they do to your file:

- **Feedback** — the agent reports; nothing is written. Safe, always.
- **Rewrite** — the agent proposes exact edits and **this skill applies them**. The agent has no write tools; every change to a file passes through the steps below.

The charter is `${CLAUDE_PLUGIN_ROOT}/docs/prose-charter.md` and the tells
catalog is `${CLAUDE_PLUGIN_ROOT}/docs/claudeish-tells.md`. You don't need to
read either one — the agent does. Read them only if the user asks what a
particular mandate means.

---

## Step 0: Resolve the input and the mode

**The artifact.** The user gives you either a filepath or a chunk of text.

- A path — resolve it, confirm it exists. If it doesn't, say so and stop.
- Inline text — use it as given.
- Neither, or an ambiguous reference like "review the RFC" — ask which file.

**The mode.** Look for `--feedback` or `--rewrite`, or plain language meaning the
same ("just tell me what's wrong", "clean it up", "rewrite it").

If the mode is absent, **ask**. Do not guess. Feedback and rewrite differ by
whether the user's file changes, and a wrong guess in the rewrite direction is a
wrong guess that edits their work.

> "Feedback or rewrite? Feedback reports findings and changes nothing. Rewrite applies the fixes to the file."

**Audience.** If the user said who reads this, pass it through. If not, don't
invent it — the agent infers and declares its assumption.

---

## Step 1: Run the guards

**Source-file guard.** This skill handles prose, not code. If the target is a
source file — `.ts`, `.js`, `.tsx`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.sh`,
`.sql`, `.yaml`, `.json`, or any other code or config format — stop.

> "`review-prose` reviews prose, not code. For a code review, use `guided-code-review`. If you want the prose _inside_ this file reviewed — a docstring block, a README section — paste that text directly and I'll review it as text."

Handle: `.md`, `.txt`, `.rst`, `.adoc`, extensionless prose files, and inline
text of any origin, including PR bodies and ticket descriptions pasted in.

**Size guard.** Past roughly 1,500 lines, a single pass gets shallow and the
agent's `before` strings get less reliable. Split the file on its top-level
headings, dispatch one agent per section, and tell the user you're doing it.
Never silently review a prefix of a long document.

**Version-control guard — rewrite mode only.** Before any edit, check whether the
file is tracked by git. If it is not — not a repo, or an untracked file — the
user has no undo. Show the proposed changes and get a go-ahead before applying.
Under git, apply and report; the diff is recoverable.

---

## Step 2: Dispatch the agent

Dispatch **one** `tech-writer` agent with:

- The artifact — the file path, or the inline text verbatim.
- The mode, named explicitly: `feedback` or `rewrite`.
- The audience context, if the user gave any.

Pass the path, not your summary of the file. The agent reads the whole document
itself; structure and front-loading violations are invisible from an excerpt.

Do not dispatch several agents for one artifact and merge their findings. Prose
judgment doesn't average well — two editors produce two registers, and the merge
reads worse than either.

---

## Step 3 (feedback mode): Report the findings

Parse the agent's `yaml` block. Present it as prose and a list — not as raw YAML,
and not as a table.

Lead with `summary` and `verdict`. Then the findings **in the order the agent
returned them** — it ranks by cost to the reader, and re-sorting by line number
throws that away.

For each finding, show the quoted excerpt, the mandate, and the suggested
replacement. Keep the agent's wording; don't re-editorialize it.

Then:

- **`strengths`** — report these. They tell the author what's working, and a review that is nothing but corrections gets ignored.
- **`openQuestions`** — surface every one. Put them last, under their own heading, as questions addressed to the user.

Finally, offer the obvious next step: "Want me to apply these?" If the user says
yes, go to Step 4 — dispatch a fresh agent in rewrite mode rather than trying to
convert findings into edits yourself.

---

## Step 4 (rewrite mode): Apply the changes

The agent returns `changes` as before/after pairs, or `rewritten` for inline text
with no file.

**Inline text** — show the rewritten text. Nothing to apply.

**A file** — apply each change with the Edit tool, using `before` as the exact
match string and `after` as the replacement. Then:

1. **A `before` that doesn't match** — do not fuzzy-match it, and do not hand-repair it. Drop the change and list it as dropped.
2. **A `before` that matches more than once** — Edit will refuse. Drop it and list it as dropped.
3. **Never apply a change with an empty `after`** unless its `why` explicitly justifies a deletion. Silent deletion is the failure mode that loses an author's work.

After applying, report:

- What changed, grouped by mandate — so the author sees the pattern, not 40 disconnected edits.
- **Every dropped change**, with its `before` text and why it was dropped. A dropped change is a fix the author still needs to make by hand. Never round this to "applied successfully."
- `preserved` — what the agent deliberately left alone. This is the evidence it edited rather than flattened.
- `openQuestions` — surface all of them.

Then run `git diff` on the file, if it's tracked, and show the user the real
diff. Your account of what changed is a claim; the diff is the evidence.

---

## Step 5: Never claim more than you did

Report the outcome plainly.

- If changes were dropped, the file is **partly** rewritten. Say that.
- If the agent raised `openQuestions`, the review is **not** finished — it's blocked on the author. Say that.
- `verdict: CLEAN` means the agent found nothing. Report it as-is. Don't invent findings so the run feels productive.

This skill never approves a document and never merges anything. It reports, or
it edits a file and shows the diff. The author decides what ships.
