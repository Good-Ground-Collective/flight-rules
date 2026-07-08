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

  The CLI's tracker abstraction handles which system it is. Read `size` from the returned `metadata.size` and the sections from the body. **An emitted node's layered body is the RFC for the next hop** — that is what makes the recursion clean.

If the input is ambiguous, resolve a real file path as an RFC file; otherwise treat it as a node id.

## Calling Model (read this before you count invocations)

Each invocation moves the work **exactly one altitude down**. Tickets come out of the epic hop already executable — depth comes from the **fan-out going deep**, not a second per-ticket pass. Starting from an initiative RFC that yields 5 epics × 5 tickets: `1` (initiative→epics) + `5` (each epic→tickets) = **6 calls**, not 31. If per-ticket quality falls short, turn up **fan-out depth/breadth** — never add a fourth altitude.

## Preconditions

- Run everything from the **repo root** (the `flight-rules` CLI resolves config relative to CWD).
- `GITHUB_TOKEN` is set (for the GitHub tracker).

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the work item and settle the input altitude

Read the RFC file or `flight-rules <type> get <id>`. Extract:
- **`size`** (frontmatter or `metadata.size`) — the input altitude.
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

Collect every findings report before synthesizing.

### 5. Synthesize the breakdown

You hold the RFC context and every findings report. Now decide the children:

- **initiative → epics:** group the work into coherent, independently-shippable epics. Each epic's `High-level technical writeup` reflects the *survey* findings (cross-repo shape, integration points). No Guided Walkthrough (epics don't get one).
- **epic → tickets:** break the work into executable tickets, each roughly one PR. Use the *deep* findings to write each ticket's **Guided Walkthrough** so a Sonnet/Haiku-tier agent can build it — name the exact files, patterns to follow, integration points, and the test approach, drawn straight from the findings (`files`, `patterns`, `integrationPoints`, `risks`). Decide the dependency ordering between tickets.
- **ticket:** the single deep node.

Every child ties back to the parent's Problem Statement. If the findings reveal the sketch was wrong (a seam that isn't real, or a missing one), trust the code — adjust the breakdown and note why.

### 6. Author each child as a layered-body artifact

Follow [`docs/layered-body-format.md`](../../docs/layered-body-format.md) exactly. Write the prose **directly** (there is no serializer):

- `## Problem Statement`, `## Solution`, `## Acceptance Criteria` (as a `- [ ]` checklist), `## High-level technical writeup`.
- **Tickets only:** a `<details><summary>Guided Walkthrough</summary>` plain-markdown section (never inside the YAML — a nested fence would break it).
- The `size` of the **child** (one altitude below the input) is stamped via the CLI `--size` flag in the next step; do not hand-write the LLM-Context YAML block.

Write each body to a temp file and pass it with `--body "$(cat <file>)"` to avoid shell-escaping the markdown.

### 7. Create and link via the CLI

Use only `flight-rules` — never the tracker's native API directly.

**initiative → epics:**
```bash
# 1. materialize the initiative
flight-rules initiative create --title "<title>" --body "$(cat initiative-body.md)"   # → { "id": <milestoneId> }
# 2. for each epic
flight-rules epic create --title "<title>" --body "$(cat epic-N.md)" --size epic       # → { "id": <epicId> }
flight-rules epic link-initiative <epicId> --initiative <milestoneId>
```

**epic → tickets:**
```bash
# for each ticket (auto-links to the epic as a sub-issue)
flight-rules ticket create --title "<title>" --body "$(cat ticket-N.md)" --epic-id <epicId> --size ticket   # → { "id": <ticketId> }
# then wire dependencies discovered during synthesis
flight-rules ticket block <ticketId> --by <blockerTicketId>
```

**ticket:** create the single ticket (`--size ticket`) under its epic.

### 8. Verify and stop

For an epic hop, sanity-check the dependency graph:
```bash
flight-rules epic plan <epicId>   # expect clean waves, no cycles
```
If `cycles` is non-empty, fix the offending `block` edges.

Report the created node ids and their links. **Stop — one altitude only.** Do not descend into the children you just created; each re-enters this skill as its own invocation.

## Guardrails

- **One altitude-hop per invocation.** Never recurse within a single run.
- **Never implement.** This skill produces deliverables, not code.
- **Everything through `flight-rules`.** The skill stays tracker-agnostic; the CLI resolves GitHub/Jira.
- **Sharpen-the-Saw labeling** is folded into the epic→ticket pass by #24 — until that lands, do not saw-label here.

## What Good Looks Like

- Exactly one altitude was created; the invocation stopped there.
- Every child is a layered-body artifact grounded in real code (its writeup cites what the research actually found, not guesses).
- Tickets carry a Guided Walkthrough concrete enough for a Sonnet/Haiku agent to execute; epics don't.
- Children are natively linked (epics→milestone, tickets→epic sub-issues) with a clean, cycle-free dependency graph.
- Each emitted node could itself be handed straight back into this skill for the next hop down.
