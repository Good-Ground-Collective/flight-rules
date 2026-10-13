---
name: break-down-work
description: "Decomposes a merged RFC (or a tracker node) one altitude down into code-grounded, right-sized deliverables, emitted as linked tracker issues. Reads the work's size to pick the target altitude and analysis depth, grounds the breakdown in real code via a parallel research fan-out, and writes each child as a layered-body artifact. Runs exactly one altitude-hop per invocation. Use after an RFC is merged, or to break an emitted epic into tickets."
---

# Break Down Work

The stage after the RFC. It takes a piece of work at one altitude and produces the next altitude **down** as linked, code-grounded tracker nodes an execution agent (or a human) can pick up. It is a **staff engineer working tightly with a PM**: it reads the "what and why," investigates the real codebase, and turns it into buildable deliverables.

**One skill, one altitude-hop per invocation.** It is invoked repeatedly, walking the tree down:

- **initiative → epics** — survey-depth, cross-repo shape. Create the initiative (milestone) and its epics, then **stop**.
- **epic → tickets** — deep, executable-grade analysis. Create tickets a standard-tier agent can build, and wire their dependencies.
- **ticket** — no decomposition; run the deep pass directly and emit one executable ticket.

The epic→ticket hop **is** the deep pass — there is no separate "ticket → plan" altitude. See the Calling Model below.

## Terminal state

The output is **nodes in the task tracker** (GitHub/Jira), linked natively, not a document. Every emitted node is a layered-body artifact. Run `flight-rules doc layered-body-format` and read the full output.

## The hard rule: tickets carry their own context

Another engineer must be able to pick up any ticket you emit and run `/execute-work` on their own machine with no other input. They have a fresh clone, the tracker, and the URLs the ticket links to. They do not have your working directory, your planning notes, or this conversation.

So every fact an implementer needs lives in one of three places, per [Portable context](../../docs/layered-body-format.md#portable-context):

1. **The ticket body.**
2. **The parent epic or initiative body.**
3. **A published technical artifact**, linked by URL. Publish it with `flight-rules tdd create`, which writes a Confluence page on Jira and a GitHub Discussion on GitHub.

Never point a body at a local path, an uncommitted or unmerged file, a `specs/` or planning draft, `.claude/` scratch, or an RFC that exists only in a local `rfcs/` folder. Never leave a decision in the conversation. If you wrote planning notes while you worked, move what matters into a body or the artifact, then forget the file.

The CLI rejects bodies with home paths, `~/` paths, and `file://` URLs. It cannot catch an unmerged repo-relative path or a decision you never wrote down. Step 11 catches those.

## The second hard rule: epics are self-contained

Every epic you emit must be finishable on its own. Keep every blocked-by edge inside one epic. Cross-epic dependencies are avoided at all cost: each one keeps two epics in flight, and a reviewer cannot hold five open epics in their head any better than the author can. Run `flight-rules doc epic-boundaries` and read the full output.

When a dependency would cross epics, restructure before you emit anything:

1. **Move the dependent ticket** into its blocker's epic.
2. **Merge the two tickets**, when one PR would carry both.
3. **Sequence the epics**, so the blocking epic finishes before the dependent one starts.

A cross-epic edge is allowed only when it is absolutely necessary, and only with a one-line justification recorded on the dependent ticket (`ticket block --cross-epic-reason`, step 9). Step 10 fails a breakdown that has a cross-epic edge without one.

## Input — an RFC file or a node id

Two entry modes:

- **RFC file path** (the first hop): a human-authored `rfcs/RFC-NNN.md`. Read its frontmatter `size` and its sections. The RFC file is an input, not a reference. Carry its Problem, Solution, and Acceptance Criteria into the bodies you emit. Link the RFC only when it is merged to a default branch, and then by its GitHub URL, never by its path.
- **Tracker node id** (every subsequent hop): an id like `31`. Resolve it through the CLI — never call GitHub/Jira directly:

  ```bash
  flight-rules epic get <id>
  ```

  The CLI's tracker abstraction handles which system it is. Read `size` from the returned top-level `size` field (derived from the entity's kind) and the sections from the body. **An emitted node's layered body is the RFC for the next hop** — that is what makes the recursion clean.

If the input is ambiguous, resolve a real file path as an RFC file; otherwise treat it as a node id.

## Calling Model (read this before you count invocations)

Each invocation moves the work **exactly one altitude down**. Tickets come out of the epic hop already executable — depth comes from the **fan-out going deep**, not a second per-ticket pass. Starting from an initiative RFC that yields 5 epics × 5 tickets: `1` (initiative→epics) + `5` (each epic→tickets) = **6 calls**, not 31. If per-ticket quality falls short, turn up **fan-out depth/breadth** — never add a fourth altitude.

## Orchestration context

Read `flight-rules doc orchestration-interface` and `flight-rules doc native-orchestration`. Establish one caller context for the input node/RFC, active checkout, fixed base and run ID; use attempt 1 for independent research briefs. Give each brief its own dispatch ID. Research `depth` means survey/deep analysis, not worker nesting depth. Invoke any sibling skill in this caller context, without consuming another worker level.

Human questions and the creation go-ahead require invocation-level `allowHumanQuestions: true` and supported `ask`. Without that opt-in, return `QUESTIONS_DISABLED` with the unresolved decision; unavailable host questions return `QUESTIONS_UNAVAILABLE`. Do not publish a question or mutate the tracker to bypass this boundary. When opted in, wait for an actual answer and honor already supplied answers/authorization.

## Working with the human

You are a staff engineer working **with** a PM — not a batch job. Decompose confidently when the picture is clear, but **check in rather than guess** when it isn't.

**Stop and ask the human, and wait for an answer, whenever you hit any of these.** Do not paper over it, and do not pick for them:
- **Ambiguous input** — the Problem / Solution / Acceptance Criteria are too vague to decompose with confidence.
- **Research contradicts the RFC** — a sketched seam doesn't exist in the code, a major seam is missing, or the fan-out surfaces a significant risk/unknown that changes the shape.
- **A real decomposition fork** — there are materially different, reasonable ways to slice or order the work. Present the options and your recommendation; let the human choose.
- **Size mismatch** — the declared `size` looks wrong (e.g. an "epic" that is really an initiative). Flag it before proceeding.

When you ask, be specific: state what's unclear, show what you found, and offer your recommendation. Wait for the human's direction before continuing; never guess your way past a genuine unknown.

**Always preview before creating anything** (step 6). Creating tracker nodes is irreversible, so never create until the human has seen the proposed breakdown and given the go-ahead.

## Preconditions

- Run everything from the **repo root** so `flight-rules` resolves the project's configured tracker.
- Confirm the tracker is wired up before starting: `flight-rules check` (verifies config, credentials, and reachability; exits non-zero with an actionable report if not). This skill is **tracker-agnostic** — it never talks to GitHub/Jira directly, only through `flight-rules`, which resolves the configured system.

## Process

Track your progress with your own to-do mechanism — one to-do per step, completed in order. This is *internal* progress-tracking, separate from the tracker nodes you **emit** in step 8.

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

### 4. Fan out the research — in bounded batches

Use `dispatchMany` for the separate briefs addressed to `research-agent`. Admit at most the smaller of the explicit batch bound and the host's observed available slots. Refresh current usage before each launch and reserve its slot immediately, including launches the host has not yet counted. Wait for every worker in a batch and reconcile/release its occupied host capacity before launching the next batch. The shared `BoundedDispatchQueue` implements this admission and report-ordering policy for programmatic consumers; native parents follow the same decisions through their host tools.

One available slot means one brief at a time, preserving every separate input. Zero capacity with no running batch returns `CAPACITY_EXHAUSTED`; unknown bounds return `LIMITS_UNKNOWN`; insufficient nesting returns `DEPTH_EXCEEDED`. Return the named remedy, never change global/project caps, assume unlimited workers, merge briefs or do research inline to conceal unavailable dispatch. Missing required capabilities also stop before dispatch.

**Dispatch `research-agent` at its declared escalated tier**, deliberately. Research is the one stage in this pipeline with no gate downstream: an implementation is checked criterion-by-criterion by `code-verifier` before it can reach a PR, but a findings report goes straight into the Guided Walkthrough and from there into every ticket derived from it. An error here is amplified, not caught. It is also the cheapest stage — a handful of single-shot, read-only dispatches sitting in front of a per-ticket, multi-turn, up-to-three-attempt execution loop. Do not route by `depth` or `mode` to save money; the saving is a rounding error and the rule is one more thing to get wrong. If a human explicitly requests a cheaper survey, select a named standard-tier registration supplied by the adapter; if none exists, report that limitation rather than overriding the model at dispatch.

Collect and validate every mode-specific findings report against its original dispatch ID and caller context before synthesizing. Preserve input order even when workers finish out of order. A failure, cancellation or malformed report remains attached to its brief and stops synthesis with the named reason; do not invent findings for it.

### 5. Synthesize the breakdown

You hold the RFC context and every findings report. Now decide the children:

- **initiative → epics:** group the work into coherent, independently-shippable epics, each finishable on its own. Draw the epic lines so that no ticket you can foresee would need a blocker in another epic; where one would, move the work or sequence the epics instead. Each epic's `High-level technical writeup` reflects the *survey* findings (cross-repo shape, integration points). No Guided Walkthrough (epics don't get one). **Propose an epic order** that keeps as few epics in flight as possible, ideally one: the next epic starts only when the one before it is done. Write the order and its reason into the initiative body's `### Decisions`.
- **epic → tickets:** break the work into executable tickets, each roughly one PR. Use the *deep* findings to write each ticket's **Guided Walkthrough** so a standard-tier agent can build it — name the exact files, patterns to follow, integration points, and the test approach, drawn straight from the findings (`files`, `patterns`, `integrationPoints`, `risks`). Decide the dependency ordering between tickets. Every blocker must be a ticket in this epic. If a ticket needs work owned by another epic, restructure (see "The second hard rule") rather than wire the edge; keep it only when it is absolutely necessary, with a one-line justification.
- **ticket:** the single deep node.

**Collect the decisions.** List every choice you or the human made that shapes the work: a slicing call, a rejected approach, a naming rule, an answer to a human question. Each one belongs in the parent body or the technical artifact before any ticket references it (step 9). Decide now whether the context fits in the bodies or needs a technical artifact. Reach for the artifact when the shared context runs past a screen, or when several tickets need the same long explanation.

Every child ties back to the parent's Problem Statement. If the findings **contradict the RFC** — a seam that isn't real, a missing one, or a risk that reshapes the work — do **not** silently restructure: this is a *stop-and-ask* trigger (see "Working with the human"). Surface what you found, propose the adjusted breakdown, and wait for the human's call before continuing.

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
- The **dependency ordering** between children (what blocks what). On an initiative hop, the **proposed epic order**. Call out any **cross-epic edge** with its one-line justification, or say there are none.
- The **Sharpen-the-Saw pick**, if any — which ticket, which competency, and why (or "none").
- Any **assumptions or open judgment calls** you made during synthesis.
- **Where the context will live** — the decisions list, and whether a technical artifact will be published, with its title.

Ask plainly and wait for an answer: *"Here's the proposed breakdown — good to create these, or adjust?"* Revise on feedback and re-preview. Only proceed once the human says go.

### 8. Author each child as a layered-body artifact

Run `flight-rules doc layered-body-format`, read the full output, and follow it exactly. Write the prose **directly** (there is no serializer):

- `## Problem Statement`, `## Solution`, `## Acceptance Criteria` (as a `- [ ]` checklist), `## High-level technical writeup`.
- **Open the writeup with a `**Context:**` line** linking the parent initiative, the parent epic, and the technical artifact by key or URL. Leave out any that don't exist. `execute-work` follows this line to the initiative, which an epic payload does not name.
- **Parents carry the decisions.** An epic or initiative body records the breakdown's decisions under `### Decisions` in its writeup, one bullet per choice with its reason. An initiative's decisions include the epic order. A ticket repeats any decision that shapes its own code. It doesn't send the implementer elsewhere for it.
- **Repo-relative paths only for code on the default branch**, or for files the ticket itself creates. Research ran against your checkout, so confirm a cited path exists on the default branch with `git ls-tree -r --name-only origin/HEAD -- <path>` before you write it in.
- **Tickets only:** a `<details><summary>Guided Walkthrough</summary>` plain-markdown section (never inside the YAML — a nested fence would break it).
- The `size` of the **child** is implied by the create command you run (`epic create` → epic, `ticket create` → ticket); it is derived from the entity's kind on read, never stored in the LLM-Context block.

Write each body to a temp file and pass it with `--body-file <file>` — the deterministic way to hand large layered-body markdown (fenced YAML, nested code) to the CLI without shell-escaping it. The temp file is a transport, not a reference: never name it in any body.

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

**Publish the technical artifact first, when step 5 called for one.** It needs the epic's id, and tickets need its URL for their `Context:` line:

```bash
flight-rules tdd create --title "<title>" --body-file tdd.md --epic-id <epicId>   # → { "id": …, "url": … }
```

On an initiative hop, run it after each `epic create` that needs one. On an epic hop, run it before the first `ticket create`. If the epic's body is missing decisions from this hop, add them with `flight-rules epic edit <epicId> --body-file epic.md` before creating tickets. The artifact is a full document: put the decisions, the cross-ticket explanation, and any diagrams in it, not a pointer to somewhere else.

**epic → tickets:**
```bash
# for each ticket (auto-links to the epic as a sub-issue)
flight-rules ticket create --title "<title>" --body-file ticket-N.md --epic-id <epicId>   # → { "id": <ticketId> }
# the one Sharpen-the-Saw leaf (if any) additionally carries the label:
flight-rules ticket create --title "<title>" --body-file ticket-saw.md --epic-id <epicId> --labels sharpen-the-saw:<slug>
# then wire dependencies discovered during synthesis (blocker in the same epic)
flight-rules ticket block <ticketId> --by <blockerTicketId>
# only an edge that is absolutely necessary may leave the epic; the CLI refuses it without a reason
flight-rules ticket block <ticketId> --by <blockerInAnotherEpic> --cross-epic-reason "<one-line justification>"
```

`ticket block` refuses an edge between two epics unless `--cross-epic-reason` is passed, and records the reason on the dependent ticket. Never reach for the flag to get a refused edge through: a refusal means the breakdown needs restructuring first.

**ticket:**
```bash
# a ticket-sized RFC has no parent epic — omit --epic-id and the ticket is created standalone
flight-rules ticket create --title "<title>" --body-file ticket.md   # → { "id": <ticketId> }
```

Only pass `--epic-id` when this hop really does sit under an existing epic. Do **not** invent a wrapper epic to satisfy the flag — a ticket-sized RFC maps to one parentless ticket, and a single-child epic is hierarchy noise.

### 10. Verify and stop

For an epic hop, sanity-check the dependency graph:
```bash
flight-rules epic plan <epicId>   # expect clean waves, no cycles, no unjustified crossEpicEdges
```
If `cycles` is non-empty, fix the offending `block` edges.

Then check `crossEpicEdges`. **The breakdown fails this check if any entry has `"justification": null`.** Fix it by restructuring (move the ticket, merge the tickets, or sequence the epics) and removing the edge with `flight-rules ticket unblock <ticketId> --by <blockerTicketId>`. Only if the edge is absolutely necessary, record the reason by re-running `ticket block` with `--cross-epic-reason`. A justified edge still goes in your report, so the human sees every edge that leaves the epic.

For an initiative hop, there are no tickets yet. Check instead that the initiative body states the epic order and that no epic's writeup assumes work another epic owns.

### 11. Read each node as a stranger

Fetch every node you created back from the tracker and read it as an engineer on a fresh machine who has never seen this conversation:

```bash
flight-rules ticket get <ticketId>
```

For each one, check:

- Every reference resolves from a fresh clone or a URL: tracker keys, artifact URLs, and repo-relative paths that exist on the default branch or that the ticket creates.
- No sentence leans on something unwritten: "as discussed", "per the plan", "see my notes", or a decision ID such as `D14` that no body or artifact defines.
- The Acceptance Criteria and Guided Walkthrough make sense with only the ticket, its parents, and the linked artifact open.

Any failure is a defect in what you emitted. Fix it now with `ticket edit`, `epic edit`, or a new artifact, then re-read. Don't finish with a node that fails.

Report the created node ids and their links. **Stop — one altitude only.** Do not descend into the children you just created; each re-enters this skill as its own invocation.

## Guardrails

- **One altitude-hop per invocation.** Never recurse within a single run.
- **Never implement.** This skill produces deliverables, not code.
- **Never create nodes without the go-ahead.** Preview first (step 6); creating is irreversible.
- **Check in when unsure, don't guess.** Ambiguity, RFC/code contradiction, real forks, and size mismatches are all stop-and-wait triggers (see "Working with the human").
- **Everything through `flight-rules`.** The skill stays tracker-agnostic; the CLI resolves GitHub/Jira.
- **Epics are self-contained.** Every blocked-by edge stays inside one epic. A cross-epic edge needs to be absolutely necessary and carry a one-line justification; an unjustified one fails step 10.
- **At most one Sharpen-the-Saw leaf per epic** (step 6), only on a non-blocking leaf, always with a written justification. Never label silently; never exceed one.
- **Portable context only.** No body references a local path, an unmerged file, or an unwritten decision. Never pass `--allow-local-paths` to get a context pointer past the CLI; publish the context instead.

## What Good Looks Like

- The human saw and approved the breakdown before any node was created; genuine uncertainty was raised with the human and answered before continuing.
- Exactly one altitude was created; the invocation stopped there.
- Every child is a layered-body artifact grounded in real code (its writeup cites what the research actually found, not guesses).
- Tickets carry a Guided Walkthrough concrete enough for a standard-tier agent to execute; epics don't.
- Children are natively linked (epics→milestone, tickets→epic sub-issues) with a clean, cycle-free dependency graph whose edges stay inside one epic, apart from any absolutely necessary edge that carries a recorded justification.
- An initiative breakdown names an epic order that keeps one epic in flight at a time wherever it can.
- An epic→ticket pass labels **at most one** leaf `sharpen-the-saw:<slug>`, with a justification and reduced walkthrough — or none, if nothing fits the rubric.
- Each emitted node could itself be handed straight back into this skill for the next hop down.
- An engineer on another machine could run `/execute-work` on any emitted ticket with no input beyond the ticket id. Every decision lives in a body or a published artifact, and every reference resolves from a fresh clone or a URL.
