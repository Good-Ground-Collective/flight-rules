---
name: draft-request-for-comments
description: "Forces a human to author an RFC before any agent touches a codebase, then sizes the work as a ticket, epic, or initiative. Builds the RFC interactively via Socratic dialogue or interrogates an existing file. Always the first step in the software factory pipeline."
---

# Draft Request for Comments

This skill forces a human to author an RFC before any agent starts planning or building. It either accepts an existing file and interrogates it, or guides the user through writing one from scratch via Socratic questions — no canned options, free-form answers only. It closes by sizing the work — ticket, epic, or initiative — so the rest of the pipeline knows what to do next.

This document is an **RFC** — the upstream "what and why" that collects comments — not a spec. A true spec is a downstream artifact that lives alongside its delivery (the code, the PR). Keep this skill lean; it must never grow into an implementation spec.

The RFC this skill produces is the grounding source for all downstream agents. Nothing proceeds without a merged RFC. The RFC is a human artifact that agents read, not an agent artifact that humans rubber-stamp.

## Entry Modes

Ask the user:

> "Do you have a spec file you'd like me to review, or would you like to write one from scratch?"

- **File provided** → use the File Review Flow
- **Start from scratch** → use the Interactive Flow

---

## Interactive Flow

Work through each section in order. Ask one section at a time. Never present multiple-choice options — ask open questions and wait for free-form answers. Do not move to the next section until the current one is solid.

### Problem Statement (required)

> "What problem are we solving? Write it as a single sentence — in your own words."

Push back if:
- The response is a solution in disguise ("We need to build X" instead of "Users can't do Y")
- It is too vague to act on ("things are broken", "the process is slow")
- It describes a symptom without surfacing the root cause
- It contains more than one problem

Keep pushing until you have a single, root-cause sentence. This is the most important field in the document — every other section must connect back to it.

### Solution (required)

> "What will we build to solve it?"

Push back if:
- The solution doesn't connect clearly to the problem
- It is too vague to implement ("make it better", "improve performance")
- It solves a different problem than the one stated

A good solution often opens with a statement and follows with a short bulleted list of what will be built.

### Background (optional)

> "Is there any context that would help someone understand why we're doing this — history, constraints, or prior decisions? Skip this if the problem and solution cover it."

If they skip: move on. Do not push.

### Technical Notes (optional)

> "Any technical constraints, schemas, architectural nudges, or design details worth calling out? Skip if not applicable."

This can be as brief as "we already use Octokit, follow that pattern" or as detailed as a Zod schema.

### Known Gaps and Edge Cases (optional)

> "What could send this sideways? Anything thorny, or anything you want to explicitly exclude from scope?"

---

## File Review Flow

When the user provides a spec file:

1. Read the file
2. Check every section against these standards:
   - **Problem Statement**: single sentence, root-cause level, not a feature request or disguised solution
   - **Solution**: connects directly to the problem, concrete enough to act on
   - **Gaps**: are there obvious edge cases or scope ambiguities the author hasn't surfaced?
3. Ask follow-up questions on anything thin, vague, or disconnected
4. Do not declare the spec ready until every required section is solid
5. Proceed to Sizing the Work

---

## Section Saving Rules

After each section is solid:

- **Save verbatim by default.** Do not rewrite, summarize, clean up, or paraphrase what the user typed.
- **Prompt for help only when the input is clearly rough** — significant typos, fragmented sentences, or clear stream-of-consciousness. When you prompt, offer exactly three options:
  1. **Save as-is** (always the default)
  2. **Add context** — keep their exact words as a verbatim block, then append structured context drawn from the conversation
  3. **Rewrite** — produce a clean version while preserving their intent

Err toward verbatim. A human voice in each section is the point — polished agent output defeats the purpose.

---

## Sizing the Work

Once the sections are solid, size the work before collecting frontmatter. Do not ask the user to pick a size cold — **propose** one from what they wrote, then let them confirm or override.

| Size | What it is | Rough scale (guidance, not a gate) |
|---|---|---|
| **ticket** | A single unit of work — one PR | ≤ ~1000 lines of reviewable code |
| **epic** | A bundle of smaller tickets | several tickets, ~100–330 reviewable lines each |
| **initiative** | A bundle of epics | several epics |

Read the RFC and weigh:

- How many independent deliverables are described?
- Does the whole thing ship as one unit, or as several?
- Does it span multiple repos or teams?
- Rough scale against the table above.

Then propose, with your reasoning. For example:

> "You've described three independent deliverables that span two repos and don't ship as one unit — that reads like an **initiative**, not a ticket. Size it as an initiative, or would you draw the line differently?"

The user confirms or overrides. Their call is final — the line counts are intuition, not rules. Record the agreed size; it becomes the `size` frontmatter field and drives the size-specific section below.

---

## Size-Specific Section

Append exactly one section based on the agreed size. Add nothing for the sizes that don't apply. Keep it rough — enough to justify the size and let a reviewer sanity-check it, never a full breakdown (that is downstream work).

### ticket → Acceptance Criteria

Ask:

> "What are the checkable conditions that tell us this ticket is done? Two to five, each independently verifiable."

Save as a bulleted checklist.

### epic → Ticket Sketch

Ask:

> "Roughly what tickets make this up? One line each — just enough to show the shape. Note ordering only where it matters."

Save as a bulleted list. Do not expand these into full tickets; that is a downstream task.

### initiative → Epic Sketch + Definition of Success

Ask two questions:

> "Roughly what epics make this up? One line each."

> "How will we know this initiative succeeded — in product-outcome terms, not code?"

Save the epic sketch as a bulleted list and the Definition of Success as a short paragraph or bulleted outcomes.

---

## Frontmatter Collection

Once all sections are solid, collect the following in order:

**Size** is already agreed from the Sizing step above — do not re-ask. Carry it into the `size` frontmatter field below.

**1. Title**
Ask for a short title if the spec doesn't already have one.

**2. Repos**
> "Which repository or repositories will this work touch? Use org/repo format."

**3. Reviewers**
Run the following command and present the returned list to the user:

```bash
flight-rules users get
```

> "Who should review this RFC before agents begin work? Pick from the list or add others."

**4. RFC ID** — auto-generated:

```bash
flight-rules rfc next-id
```

**5. RFC directory** — auto-resolved:

```bash
flight-rules rfc dir
```

**6. Author** — resolve from git:

```bash
git config user.name
```

---

## Writing the RFC File

Write the RFC to `<rfc-dir>/<id>.md`. Use the following format exactly:

```markdown
---
id: RFC-NNN
title: <title>
date: <today's date in YYYY-MM-DD>
author: <git user name>
status: draft
size: <ticket | epic | initiative>
reviewers:
  - <reviewer1>
  - <reviewer2>
repos:
  - <owner/repo>
---

# <title>

## Problem Statement

<verbatim problem statement>

## Solution

<verbatim solution>

## Background

<background text>

## Technical Notes

<technical notes>

## Known Gaps and Edge Cases

<gaps text>

<Size-specific section for the agreed size — see "Size-Specific Section" above.
 ticket → "## Acceptance Criteria" (checklist);
 epic → "## Ticket Sketch" (bulleted one-liners);
 initiative → "## Epic Sketch" (bulleted one-liners) and "## Definition of Success" (outcomes).>
```

Omit optional sections entirely (including their heading) if the user skipped them. The size-specific section is required — include the one (or two, for an initiative) that matches the `size` field.

---

## Committing and Opening the PR

After the file is written:

```bash
# Branch, stage, commit
git checkout -b "rfc/<id>"
git add "<rfc-dir>/"
git commit -m "docs(rfc): add <id> — <title>"
git push -u origin HEAD
```

Open the PR with reviewer requests:

```bash
gh pr create \
  --title "<id>: <title>" \
  --body "RFC for review — proposed size: **<size>**. Reviewers: please confirm the size or challenge it as part of your review. See the document for full context." \
  --reviewer <reviewer1> \
  --reviewer <reviewer2>
```

For Atlassian (Bitbucket), add `@<reviewer>` mentions to the PR description body instead of using `--reviewer` flags.

---

## What Good Looks Like

A solid RFC before it leaves this skill:

- Problem Statement is one sentence, describes a real pain, is not a feature request
- Solution connects directly to the problem and is specific enough to act on
- At least one human-written sentence exists in every included section
- All frontmatter fields are populated — no empty `title`, `reviewers`, or `repos`
- Reviewers are real team members who must approve before agents begin work
- A size is agreed (`ticket`, `epic`, or `initiative`) and recorded in the `size` frontmatter field
- The size-specific section for that size is present and non-empty (Acceptance Criteria, Ticket Sketch, or Epic Sketch + Definition of Success)
- The PR body states the proposed size and asks reviewers to confirm or challenge it
