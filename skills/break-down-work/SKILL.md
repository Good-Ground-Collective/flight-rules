---
name: break-down-work
description: "Decomposes a merged RFC (or a tracker node) one altitude down into code-grounded, right-sized deliverables, emitted as linked tracker issues. Reads the work's size to pick the target altitude and analysis depth, grounds the breakdown in real code via a parallel research fan-out, and writes each child as a layered-body artifact. Runs exactly one altitude-hop per invocation. Use after an RFC is merged, or to break an emitted epic into tickets."
---

# Break Down Work

The stage after the RFC. It takes a piece of work at one altitude and produces the next altitude **down** as linked, code-grounded tracker nodes an execution agent (or a human) can pick up. It is a **staff engineer working tightly with a PM**: it reads the "what and why," investigates the real codebase, and turns it into buildable deliverables.

**One skill, one altitude-hop per invocation.** It is invoked repeatedly, walking the tree down:

- **initiative → epics** — survey-depth, cross-repo shape. Create the initiative (milestone) and its epics, then **stop**.
- **epic → tickets** — deep, executable-grade analysis. Create tickets a "dumber" model (Sonnet/Haiku) can build, and wire their dependencies.
- **ticket** — no decomposition; run the deep pass directly and emit one executable ticket.

The epic→ticket hop **is** the deep pass — there is no separate "ticket → plan" altitude. See the Calling Model below.

## Terminal state

The output is **nodes in the task tracker** (GitHub/Jira), linked natively, not a document. Every emitted node is a [layered-body artifact](../../docs/layered-body-format.md).

## Input — an RFC file or a node id

Two entry modes:

- **RFC file path** (the first hop): a human-authored `rfcs/RFC-NNN.md`. Read its frontmatter `size` and its sections.
- **Tracker node id** (every subsequent hop): an id like `31`. Resolve it through the CLI — never call GitHub/Jira directly:

  ```bash
  flight-rules epic get <id>
  ```

  The CLI's tracker abstraction handles which system it is. Read `size` from the returned top-level `size` field (derived from the entity's kind) and the sections from the body. **An emitted node's layered body is the RFC for the next hop** — that is what makes the recursion clean.

If the input is ambiguous, resolve a real file path as an RFC file; otherwise treat it as a node id.

## Calling Model (read this before you count invocations)

Each invocation moves the work **exactly one altitude down**. Tickets come out of the epic hop already executable — depth comes from the **fan-out going deep**, not a second per-ticket pass. Starting from an initiative RFC that yields 5 epics × 5 tickets: `1` (initiative→epics) + `5` (each epic→tickets) = **6 calls**, not 31. If per-ticket quality falls short, turn up **fan-out depth/breadth** — never add a fourth altitude.

## Working with the human

You are a staff engineer working **with** a PM — not a batch job. Decompose confidently when the picture is clear, but **check in rather than guess** when it isn't.

**Stop and ask the human — using the `AskUserQuestion` tool — whenever you hit any of these.** Do not paper over it, and do not pick for them:
- **Ambiguous input** — the Problem / Solution / Acceptance Criteria are too vague to decompose with confidence.
- **Research contradicts the RFC** — a sketched seam doesn't exist in the code, a major seam is missing, or the fan-out surfaces a significant risk/unknown that changes the shape.
- **A real decomposition fork** — there are materially different, reasonable ways to slice or order the work. Present the options and your recommendation; let the human choose.
- **Size mismatch** — the declared `size` looks wrong (e.g. an "epic" that is really an initiative). Flag it before proceeding.

When you ask, be specific: state what's unclear, show what you found, and offer your recommendation. `AskUserQuestion` is for getting direction — never guess your way past a genuine unknown.

**Always preview before creating anything** (step 6). Creating tracker nodes is irreversible, so never create until the human has seen the proposed breakdown and given the go-ahead.

## Preconditions

- Run everything from the **repo root** so `flight-rules` resolves the project's configured tracker.
- Confirm the tracker is wired up before starting: `flight-rules check` (verifies config, credentials, and reachability; exits non-zero with an actionable report if not). This skill is **tracker-agnostic** — it never talks to GitHub/Jira directly, only through `flight-rules`, which resolves the configured system.

## Process

Track your progress with your own to-do mechanism (e.g. the `TodoWrite` tool) — one to-do per step, completed in order. This is *internal* progress-tracking, separate from the tracker nodes you **emit** in step 8.

### 1. Read the work item and settle the input altitude

Read the RFC file or `flight-rules <type> get <id>`. Extract:
- **`size`** (RFC frontmatter, or the tracker node's top-level `size`) — the input altitude.
- **Problem / Solution / Acceptance Criteria**, and the size-specific **sketch**: an `Epic Sketch` (on an initiative) or `Ticket Sketch` (on an epic). The sketch is the human's outline of the seams — you will ground each seam in real code.

### 2. Settle the target altitude and analysis depth

| Input `size` | Produce | Depth | Then |
|---|---|---|---|
| initiative | epics | survey | create milestone + epics, **stop** |
| epic | tickets | deep | create tickets + wire deps, **stop** |
| ticket | one ticket | deep | emit the executable ticket, **stop** |

### 3. Derive research briefs from the sketch

Turn each sketched item into a **research brief** for the #22 `research-agent`:
- **focus** — the seam's question ("how would we build / where does X live").
- **mode** — `internal` by default; `external` when the item leans on an outside library/API/pattern; `mixed` when both.
- **depth** — `deep` for epic→ticket, `survey` for initiative→epic.

Add one or two **cross-cutting briefs** for shared concerns the sketch implies (a data model, an auth boundary, an existing convention all children must follow).

### 4. Fan out the research — in parallel

Dispatch **all briefs at once** (concurrently, in a single batch) to the `research-agent`. Each is single-shot: one brief in, one mode-typed findings report out. Do not dispatch serially; do not fold them into one mega-brief. Keep the batch reasonable (≈ one per child plus the cross-cutting briefs).

**Take the agent's model as it comes** — it runs `opus` by default, deliberately. Research is the one stage in this pipeline with no gate downstream: an implementation is checked criterion-by-criterion by `code-verifier` before it can reach a PR, but a findings report goes straight into the Guided Walkthrough and from there into every ticket derived from it. An error here is amplified, not caught. It is also the cheapest stage — a handful of single-shot, read-only dispatches sitting in front of a per-ticket, multi-turn, up-to-three-attempt execution loop. Do not route by `depth` or `mode` to save money; the saving is a rounding error and the rule is one more thing to get wrong. Override downward only when a human explicitly asks for a cheap survey.

Collect every findings report before synthesizing.

### 5. Synthesize the breakdown

You hold the RFC context and every findings report. Now decide the children:

- **initiative → epics:** group the work into coherent, independently-shippable epics. Each epic's `High-level technical writeup` reflects the *survey* findings (cross-repo shape, integration points). No Guided Walkthrough (epics don't get one).
- **epic → tickets:** break the work into executable tickets, each roughly one PR. Use the *deep* findings to write each ticket's **Guided Walkthrough** so a Sonnet/Haiku-tier agent can build it — name the exact files, patterns to follow, integration points, and the test approach, drawn straight from the findings (`files`, `patterns`, `integrationPoints`, `risks`). Decide the dependency ordering between tickets.
- **ticket:** the single deep node.

Every child ties back to the parent's Problem Statement. If the findings **contradict the RFC** — a seam that isn't real, a missing one, or a risk that reshapes the work — do **not** silently restructure: this is a *stop-and-ask* trigger (see "Working with the human"). Surface what you found via `AskUserQuestion`, propose the adjusted breakdown, and get the human's call before continuing.

### 6. (epic → tickets only) Sharpen-the-Saw: label at most one leaf

Keep a trickle of foundational work in human hands. You have the whole epic's ticket graph in context, so this is the one place the cap can be enforced without cross-epic state.

Pull the configurable competency list:

```bash
flight-rules competencies   # → JSON array of competency slugs (12-item seed default)
```

Then, over the tickets you just planned:

1. **Find the leaves** — tickets with an **empty `blocking` set** (nothing else in the epic depends on them). Only leaves are eligible; an un-worked leaf is a harmless backlog item, never a stall.
2. **Apply the rubric** — a candidate must sit in the intersection of *interview-signal* (exercises a load-bearing fundamental) ∩ *real-work* (a ticket that needed doing anyway) ∩ *TDD-fenceable* (a clean input→output contract a failing suite can pin), and must match one of the competency slugs. A ~30–90-minute task for a senior engineer.
3. **Pick at most ONE** per epic. Hard cap of 1, regardless of epic size. If no leaf fits the rubric, label nothing — that is fine and common.
4. For the chosen ticket:
   - Add the label `sharpen-the-saw:<slug>` (the matched competency) via `ticket create --labels` at creation (step 9).
   - **Write the justification into the body** — which competency, why it's cleanly TDD-fenceable, why it's ~30–90 min. Never label silently; the pipeline-runner reads this to decide keep-or-strip in seconds.
   - **Reduce its Guided Walkthrough to hints only** — the tests will carry the spec (via the `sharpen-the-saw` companion skill) and the human does the implementation thinking. Don't hand them the solution.

Stripping the label makes the ticket flow through the pipeline like any other — the label degrades gracefully.

### 7. Preview the breakdown and get the go-ahead

**Before authoring or creating anything**, present the proposed breakdown to the human and wait for an explicit go-ahead. Creating tracker nodes is irreversible — never skip this. Show the **shape**, not full bodies (those come next), so a wrong call is caught before the authoring effort:

- The parent (milestone/epic) and each child's **title + one-line summary**.
- The **dependency ordering** between children (what blocks what).
- The **Sharpen-the-Saw pick**, if any — which ticket, which competency, and why (or "none").
- Any **assumptions or open judgment calls** you made during synthesis.

Ask plainly (via `AskUserQuestion`): *"Here's the proposed breakdown — good to create these, or adjust?"* Revise on feedback and re-preview. Only proceed once the human says go.

### 8. Author each child as a layered-body artifact

Follow [`docs/layered-body-format.md`](../../docs/layered-body-format.md) exactly. Write the prose **directly** (there is no serializer):

- `## Problem Statement`, `## Solution`, `## Acceptance Criteria` (as a `- [ ]` checklist), `## High-level technical writeup`.
- **Tickets only:** a `<details><summary>Guided Walkthrough</summary>` plain-markdown section (never inside the YAML — a nested fence would break it).
- The `size` of the **child** is implied by the create command you run (`epic create` → epic, `ticket create` → ticket); it is derived from the entity's kind on read, never stored in the LLM-Context block.

Write each body to a temp file and pass it with `--body-file <file>` — the deterministic way to hand large layered-body markdown (fenced YAML, nested code) to the CLI without shell-escaping it.

### 9. Create and link via the CLI

Use only `flight-rules` — never the tracker's native API directly.

**initiative → epics:**
```bash
# 1. materialize the initiative
flight-rules initiative create --title "<title>" --body-file initiative-body.md   # → { "id": <milestoneId> }
# 2. for each epic
flight-rules epic create --title "<title>" --body-file epic-N.md        # → { "id": <epicId> }
flight-rules epic link-initiative <epicId> --initiative <milestoneId>
```

**epic → tickets:**
```bash
# for each ticket (auto-links to the epic as a sub-issue)
flight-rules ticket create --title "<title>" --body-file ticket-N.md --epic-id <epicId>   # → { "id": <ticketId> }
# the one Sharpen-the-Saw leaf (if any) additionally carries the label:
flight-rules ticket create --title "<title>" --body-file ticket-saw.md --epic-id <epicId> --labels sharpen-the-saw:<slug>
# then wire dependencies discovered during synthesis
flight-rules ticket block <ticketId> --by <blockerTicketId>
```

**ticket:**
```bash
# a ticket-sized RFC has no parent epic — omit --epic-id and the ticket is created standalone
flight-rules ticket create --title "<title>" --body-file ticket.md   # → { "id": <ticketId> }
```

Only pass `--epic-id` when this hop really does sit under an existing epic. Do **not** invent a wrapper epic to satisfy the flag — a ticket-sized RFC maps to one parentless ticket, and a single-child epic is hierarchy noise.

### 10. Verify and stop

For an epic hop, sanity-check the dependency graph:
```bash
flight-rules epic plan <epicId>   # expect clean waves, no cycles
```
If `cycles` is non-empty, fix the offending `block` edges.

Report the created node ids and their links. **Stop — one altitude only.** Do not descend into the children you just created; each re-enters this skill as its own invocation.

## Guardrails

- **One altitude-hop per invocation.** Never recurse within a single run.
- **Never implement.** This skill produces deliverables, not code.
- **Never create nodes without the go-ahead.** Preview first (step 6); creating is irreversible.
- **Check in when unsure, don't guess.** Ambiguity, RFC/code contradiction, real forks, and size mismatches are all `AskUserQuestion` triggers (see "Working with the human").
- **Everything through `flight-rules`.** The skill stays tracker-agnostic; the CLI resolves GitHub/Jira.
- **At most one Sharpen-the-Saw leaf per epic** (step 6), only on a non-blocking leaf, always with a written justification. Never label silently; never exceed one.

## What Good Looks Like

- The human saw and approved the breakdown before any node was created; genuine uncertainty was raised via `AskUserQuestion`, not guessed through.
- Exactly one altitude was created; the invocation stopped there.
- Every child is a layered-body artifact grounded in real code (its writeup cites what the research actually found, not guesses).
- Tickets carry a Guided Walkthrough concrete enough for a Sonnet/Haiku agent to execute; epics don't.
- Children are natively linked (epics→milestone, tickets→epic sub-issues) with a clean, cycle-free dependency graph.
- An epic→ticket pass labels **at most one** leaf `sharpen-the-saw:<slug>`, with a justification and reduced walkthrough — or none, if nothing fits the rubric.
- Each emitted node could itself be handed straight back into this skill for the next hop down.
