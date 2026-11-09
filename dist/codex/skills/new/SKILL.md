---
name: new
description: "Starts new work, or adds to existing work, by interviewing the human until you both agree on what is being built. Takes an idea, a file, or a tracker node (initiative, epic or ticket). Questions Socratically, one at a time with a recommended answer, and opens an interactive page with diagrams, mocks and toggle-or-free-text questions when there are many unknowns. Sizes the work, then writes the agreed result into the tracker as a layered body at that size. Use when someone wants to build something new or extend an existing initiative, epic or ticket."
---

# New

This skill turns "I want to build X" into a tracker node that you and the human both understand the same way. Most of the work is the interview. Writing the node at the end is quick once the two of you agree.

Treat it like a design review with a sharp colleague. Interview the human about every part of the work until neither of you is guessing. The point is shared understanding, not a document. The node you write at the end only records what you agreed.

This replaces the RFC as the usual way to start work. The RFC still exists for work that needs comments from people beyond the person in this session; see [When to write an RFC instead](#when-to-write-an-rfc-instead).

## Inputs

Take whatever the human brings:

- **Nothing.** Ask what they want to build, in their own words.
- **Free text** in the invocation. Treat it as their first answer.
- **A file**, such as notes, a spec draft, a Slack export or an old RFC. Read the whole file. Treat its claims as things to confirm, not settled decisions.
- **A tracker node** (an id, key or URL for an initiative, JPD idea, epic or ticket). This is additive mode; see [Adding to existing work](#adding-to-existing-work). Read it with the CLI, never the tracker's API:

  ```bash
  flight-rules initiative get <id>
  flight-rules epic get <id>
  flight-rules ticket get <id>
  ```

Run each repository-specific command from the target repository root. If the session started elsewhere, use the tool's working-directory option or `cd <repo> && <command>` on every call.

## How to question

- **One question at a time.** Wait for the answer before asking the next one. A question that depends on an earlier answer waits until that answer exists.
- **Recommend an answer every time.** Give your best guess and one line on why. The human corrects a guess faster than they write from nothing, and your guess shows what you already assume.
- **Socratic, not a form.** Ask the question that exposes the assumption under the last answer. "Who hits this first?", "What happens today when that fails?" and "What would make you call this done?" do more than "Any requirements?"
- **Push back.** Name it when an answer is a solution posing as a problem, when it is too vague to build, when it carries two problems at once, or when it contradicts something said earlier. Keep asking until the answer holds up.
- **Read the code instead of asking.** If the codebase can answer a question (what exists, which pattern is used, where a seam lives), go and look. Bring back what you found and ask only what the code cannot tell you. Keep this light. The deep, code-grounded research belongs to `break-down-work`.
- **Walk the design tree.** Settle the decisions other decisions depend on first, then follow each branch to its end before starting the next.
- **Keep a running ledger** of what is decided, deferred, still open, and the traps you have found. Show it every few questions, or whenever the human asks where you are.

Don't stop at the first plausible answer, and don't drag it out. Stop when you can state the whole thing back and the human agrees with every line.

## What the interview must cover

These topics are a checklist, not a script. Take them in whatever order the conversation goes, and keep going until each is solid.

| Topic | Solid when |
| --- | --- |
| **Problem** | One sentence that states a real pain at its root cause. Not a feature request and not a symptom. |
| **Who and why now** | You know who feels the pain, what it costs today, and why it matters now. |
| **Must-haves** | The few things that make this worth building. If any one is missing, the work has failed. |
| **Deferred** | What the human explicitly agrees can wait, and roughly when it would be picked up. Name each item; "later" on its own is not an answer. |
| **Out of scope** | What this work will not do, stated plainly so nobody builds it by accident. |
| **Gaps and traps** | Unknowns, risky assumptions, sharp edges in the code, data or integrations, and anything that could make the work look done when it isn't. |
| **Done** | Checkable conditions. For a ticket these become Acceptance Criteria; for bigger work they become the outcomes the children add up to. |
| **Shape and size** | How many separately shippable pieces there are, which repositories they touch, and what order they go in. |
| **Decisions** | Each choice made along the way, with its reason. These go in the body, never just in the conversation. |

## The interactive page

Some work has too much unknown to settle in a chat: a flow across several systems, a UI nobody has drawn, or a handful of linked decisions. Open an interactive page for it. You don't have to; mix chat questions and the page however suits the work, and skip the page for small, clear work.

**Use a page when** a picture would settle something faster than words (a sequence across services, a state machine, a data model, a screen layout), or when you have several decisions to put to the human at once.

**What goes on it:**

- Diagrams: architecture, sequence flows, state, data. Draw the real mechanism, not boxes with arrows between them.
- Rough mocks of screens or CLI output, labeled as mocks.
- Question cards. Each card holds the question, your recommended answer with its reason, a control (a toggle, a choice of options, or a short select) set to your recommendation, and a free-text box for anything the control can't say. Every card accepts free text.
- The ledger: decided, deferred, open and traps.

**Getting answers back.** Every page has a **Copy answers** button. It copies a compact plain-text block (one line per card: the question id, the chosen value, any free text) that the human pastes into the session. If the host lets a page send data back to the session, use that as well, but keep the copy button so the page always works.

**Host mechanics:**

- **Claude Code:** publish the page with the Artifact tool, following its design guidance. Republish to the same URL as decisions land, so the page stays the current picture.
- **Codex, or any host without a page tool:** write a single self-contained HTML file in a scratch directory outside the repository and give the human its absolute path to open. Rewrite the same file as things change.
- **No way to show a page:** draw ASCII or Mermaid diagrams in the chat and ask the cards' questions one at a time.

The page is a thinking tool. It is never the record: every decision it settles goes into the body you write at the end. Never link to the page from a tracker node, because a private page or local file does not exist for the next reader.

## Play it back

When the ledger has no open items that matter, write an **alignment brief** in the chat, short enough to read in a minute:

- Problem, one sentence.
- What gets built, a few bullets.
- Must-haves, deferred and out of scope.
- Gaps and traps, each with how it will be handled or that it is accepted.
- Done.
- Decisions, each with its reason.

Ask the human whether anything is wrong or missing. Fix it and play it back again until they say it's right.

## Size the work

Propose a size with your reasoning, and let the human confirm or override it. Their call is final.

| Size | What it is | Rough scale (a guide, not a gate) |
| --- | --- | --- |
| **ticket** | One unit of work, one PR | up to ~1000 lines of reviewable code |
| **epic** | A set of tickets that ship together | several tickets, ~100–330 reviewable lines each |
| **initiative** | A set of epics | several epics, often across repositories or teams |

Weigh how many separately shippable pieces there are, whether they ship as one unit, and how many repositories or teams they touch. On Jira an initiative is a Jira Product Discovery idea, and a ticket is a story or task.

## Write the layered body

Run `flight-rules doc layered-body-format` and read the whole output, then write one body at the agreed size. Write the human's own words where they gave them. Don't polish their voice away.

- `## Problem Statement`: the agreed problem, with who feels it and why now.
- `## Solution`: what will be built.
- `## Acceptance Criteria`: `- [ ]` checkboxes. For a ticket, the conditions under which it is done. For an epic or initiative, the outcomes its children add up to.
- `## High-level technical writeup`: open with a `**Context:**` line when the node has a parent (for example, a new epic added to an existing initiative). Then add these level-3 subsections. Level 3 matters: the section reader splits on level-2 headings.
  - `### Ticket Sketch` (epic) or `### Epic Sketch` (initiative): one line per child, with ordering only where it matters. This is the outline `break-down-work` grounds in code. A ticket has no sketch.
  - `### Decisions`: one bullet per decision, with its reason.
  - `### Deferred`: what can wait, and when it would be picked up.
  - `### Out of scope`
  - `### Gaps and traps`
- No Guided Walkthrough. `break-down-work` writes that after researching the code.
- The LLM Context block, as the format document describes.

Every reference must be portable: tracker keys, published URLs, and repo-relative paths that exist on the default branch. No local paths, no private page links, no "as discussed".

## Adding to existing work

When the input is a tracker node, read it and its parents first, then interview about the change, not the whole node. Settle which of these the human wants:

- **Refine the node.** New scope, a sharper problem, a decision, a trap. Edit the body in place: change only the sections the change touches, and keep existing human-written text unless the human asks to change it.
- **Add children.** A new epic under an initiative, or a new ticket under an epic. Interview the child as new work, carrying the parent's problem and decisions as given. Ask about a parent decision only when the new child would break it.
- **It's actually different work.** If the change doesn't fit under the parent, say so and propose a separate node instead of stretching the parent.

Show what will change before writing. For an edit, show each changed section before and after. For a new child, show the full body.

## Preview, then write

Creating or editing tracker nodes is visible to everyone and hard to take back. Show the human the title and full body of each node, ask *"Good to write this, or adjust?"*, and wait for a clear yes.

Then check the environment and write through the CLI only:

```bash
flight-rules check
```

Write each body to a temporary file outside the repository and pass it with `--body-file`. The file only carries the body; never name it in a body.

New work, by size:

```bash
flight-rules ticket create --title "<title>" --body-file ticket.md
flight-rules epic create --title "<title>" --body-file epic.md
flight-rules initiative create --title "<title>" --body-file initiative.md
```

Adding to existing work:

```bash
flight-rules ticket edit <ticketId> --body-file ticket.md
flight-rules epic edit <epicId> --body-file epic.md
flight-rules initiative edit <initiativeId> --body-file initiative.md
flight-rules tdd edit <tddId> --body-file tdd.md
flight-rules ticket create --title "<title>" --body-file ticket.md --epic-id <epicId>
flight-rules epic create --title "<title>" --body-file epic.md
flight-rules epic link-initiative <epicId> --initiative <initiativeId>
```

A new ticket for a standalone change takes no `--epic-id`; don't invent a wrapper epic. When adding a child, update the parent's sketch to include it.

Read each node back with its `get` command, as someone who never saw this conversation. Fix anything that only makes sense with the chat open.

## Hand off

Report the ids and links, then name the next step:

- **Initiative or epic:** `/break-down-work <type> <id>` (for example `/break-down-work epic 31`) takes it one level down, grounded in the code. When the node already has children, it matches them against the sketch and creates only the missing ones.
- **Ticket:** `/break-down-work ticket <id>` adds the code-grounded Guided Walkthrough; then `/execute-work <id>` builds it.

Always name the type: the same id can mean different things to different getters.

Stop there. Don't break the work down in this skill.

## When to write an RFC instead

Suggest `/draft-request-for-comments` when the work needs comments from people other than the human in this session, for example a cross-team change, a contested direction, or anything that needs sign-off before work starts. Hand it the alignment brief as its starting file, so nothing from the interview is lost.

## Guardrails

- One question at a time, each with a recommended answer.
- Read the code rather than ask what the code can answer.
- Never write to the tracker without showing the body and getting a clear yes.
- Never put a decision only in the conversation or on the interactive page; it goes in the body.
- In additive mode, change only what the human asked to change, and keep their existing words.
- Don't break the work down or implement anything. One node, or one node plus the new children the human asked for, then stop.

## What good looks like

- The human could explain the work back the way you would, and you the way they would.
- The body names its must-haves, what was deferred, what is out of scope, and the traps, each in plain words.
- The size was proposed with reasons and confirmed by the human.
- Every decision in the node has its reason next to it.
- The node reads cleanly to someone with only the tracker and a fresh clone.
- `break-down-work` can take the node as its input without asking what anything means.
