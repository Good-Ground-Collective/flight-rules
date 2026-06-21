# Native Sub-Issues & Ticket Dependencies — Design Spec

**Date:** 2026-06-17
**Status:** Approved
**Builds on:** [`2026-05-27-flight-rules-plugin-design.md`](2026-05-27-flight-rules-plugin-design.md)

---

## Overview

Two coordinated changes to the GitHub backend, the `TaskTracker` interface, the
Zod schemas, and the CLI:

- **A. Hierarchy → native sub-issues.** Replace the `fr-tickets`/`fr-epic`
  body-comment-tag mechanism for epic↔ticket linking with GitHub's native
  sub-issue API.
- **B. Native dependencies.** Add `blocked_by`/`blocking` edges between tickets
  using GitHub's native issue-dependencies API, plus a pure planning service
  that topologically orders an epic's tickets so an agent can decide what to
  work next.

Both GitHub features are generally available with full REST support as of API
version `2026-03-10`.

**Out of scope / stays as-is:** the TDD↔epic link keeps its `fr-tdd`/`fr-epic`
body tags, because a TDD is a GitHub Discussion and cannot be a sub-issue of an
Issue. This lone surviving tag is a **known placeholder** — do not invest in
expanding or generalizing it. It is slated to be replaced wholesale by the
body-metadata convention (see Future Work), so keep it exactly as it is today.

---

## Background: the relevant GitHub APIs

### Sub-issues (REST, version `2026-03-10`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/repos/{owner}/{repo}/issues/{issue_number}/sub_issues` | list children |
| POST | `/repos/{owner}/{repo}/issues/{issue_number}/sub_issues` | add child (`sub_issue_id`) |
| DELETE | `/repos/{owner}/{repo}/issues/{issue_number}/sub_issue` | remove child (`sub_issue_id`) |
| GET | `/repos/{owner}/{repo}/issues/{issue_number}/parent` | get parent |

### Issue dependencies (REST, version `2026-03-10`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` | issues blocking this one |
| POST | `/repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` | add blocker (`issue_id`) |
| DELETE | `/repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by/{issue_id}` | remove blocker |
| GET | `/repos/{owner}/{repo}/issues/{n}/dependencies/blocking` | issues this one blocks |

### Cross-cutting gotchas

1. **Global id vs. issue number.** The path segment is the human-facing
   `issue_number`, but the *target* of a relationship is identified by the
   issue's global database `id` (`sub_issue_id` / `issue_id`). Our code tracks
   issues by number everywhere, so every "wire a relationship" operation must
   first resolve number → global id with a `GET` on the target issue.
2. **Same-owner constraint.** A sub-issue must belong to the same repository
   owner as its parent. Cross-repo / cross-owner links are out of scope and
   surface as API `422`s.
3. **API freshness.** These endpoints are newer than Octokit's typed REST
   helpers may cover. All new calls go through `octokit.request(method, url)`
   with explicit URLs rather than `octokit.rest.*` wrappers.
4. **Secondary rate limiting.** POST/DELETE on these endpoints can trigger
   secondary rate limiting when called in tight loops; relevant to the
   batch-wiring flow the planning agents use.

---

## Schema changes (`src/tasks/task-tracker/task-tracker.ts`)

`TicketSchema` gains two fields:

```typescript
export const TicketSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  assignee: z.string().nullable(),
  blockedBy: z.array(z.string()).default([]), // ticket IDs that must close first
  blocking: z.array(z.string()).default([]),  // ticket IDs this one blocks
  updatedAt: z.string(),
})
```

`CreateTicketInputSchema` is unchanged — dependencies are set after creation via
a dedicated command, never at create time (a blocker is often a sibling ticket
that does not exist yet when the dependent ticket is created).

---

## `TaskTracker` interface changes

```typescript
export interface TaskTracker {
  createEpic(input: CreateEpicInput): Promise<Epic>
  getEpic(id: string): Promise<Epic>
  createTicket(input: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void> // now native sub-issue
  blockTicket(ticketId: string, blockedById: string): Promise<void>   // NEW
  unblockTicket(ticketId: string, blockedById: string): Promise<void> // NEW
  createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>
  getTechnicalDesign(id: string): Promise<TechnicalDesign>
  addComment(entityId: string, body: string): Promise<Comment>
}
```

- `linkTicketToEpic` keeps its name and signature; only its implementation
  changes (native sub-issue instead of body tag).
- `blockTicket(ticketId, blockedById)` / `unblockTicket(...)` map 1:1 to the
  CLI `ticket block <id> --by <blockerId>` surface. Argument naming mirrors the
  CLI to avoid order confusion.
- `getTicket` now populates `blockedBy`/`blocking`.
- The topological planning logic is intentionally **not** on this interface —
  it is pure computation and lives in its own service (below). The tracker stays
  I/O-only.

---

## `GitHubTaskTracker` implementation

- **`resolveIssueId(issueNumber): Promise<number>`** (new private helper) — `GET`
  the issue and return its global `id`. Used before any sub-issue or dependency
  write.
- **`linkTicketToEpic`** — resolve the ticket's global id, then
  `POST /issues/{epicNumber}/sub_issues { sub_issue_id }`. Idempotent: an attempt
  to re-add an existing sub-issue returns a `422`, which is swallowed (matches
  today's idempotent behavior).
- **`getEpic`** — list children via `GET /issues/{epicNumber}/sub_issues` and map
  each returned issue to a `Ticket` (populating its dependency arrays via
  `getTicket`). Remove the `fr-tickets` parse. **Keep** the `fr-tdd` parse for
  the TDD link.
- **`createTicket`** — unchanged except it no longer needs to write the
  `fr-epic` body tag; the parent relationship is now expressed natively by
  `linkTicketToEpic`.
- **`blockTicket(ticketId, blockedById)`** — resolve the blocker's global id,
  then `POST /issues/{ticketNumber}/dependencies/blocked_by { issue_id }`.
  Idempotent on duplicate; self-block (`ticketId === blockedById`) is rejected
  before the call with a clear error.
- **`unblockTicket(ticketId, blockedById)`** — resolve blocker id, then
  `DELETE /issues/{ticketNumber}/dependencies/blocked_by/{issue_id}`.
- **`getTicket`** — in addition to the issue + comments fetch, `GET`
  `dependencies/blocked_by` and `dependencies/blocking`, mapping each returned
  issue to its number string for `blockedBy` / `blocking`.

All new endpoints are invoked via `octokit.request(...)`.

---

## `dependency-planner` service (new, pure)

**Location:** `src/tasks/dependency-planner/dependency-planner.ts`

A pure function with no I/O, unit-tested in isolation.

```typescript
interface PlannerTicket {
  id: string
  status: string        // "open" | "closed"
  blockedBy: string[]
}

interface DependencyPlan {
  waves: PlannerTicket[][] // wave[0] = ready now; wave[n] depends only on < n
  cycles: string[]         // open ticket IDs that cannot be scheduled
}

function planDependencies(tickets: PlannerTicket[]): DependencyPlan
```

Semantics:

- A blocker is **satisfied** if it is closed, or if it is not one of the epic's
  tickets (out-of-epic blockers are assumed handled elsewhere).
- **Wave 0** = all *open* tickets whose blockers are satisfied — the "ready to
  work now" set. Wave *N* contains open tickets whose remaining open blockers
  all live in earlier waves.
- **Closed** tickets are excluded from the waves (they're done) but still count
  as satisfied blockers for others.
- When wave assignment stalls, every remaining unscheduled *open* ticket is
  reported in `cycles` — these tickets are part of, or transitively blocked by,
  a dependency cycle. A non-empty `cycles` therefore means the graph has a
  cycle. This guarantees termination. (Flat list rather than per-cycle grouping
  is deliberate: it's an advisory error signal; resolve the cycle and re-run.)
- Ordering within a wave follows the input order (creation order from `getEpic`).

---

## CLI surface

```
flight-rules ticket block   <id> --by <blockerId>   # blockTicket
flight-rules ticket unblock <id> --by <blockerId>   # unblockTicket
flight-rules epic   plan    <id>                    # getEpic → planner → JSON
```

- `ticket get <id>` output automatically includes the new `blockedBy` /
  `blocking` arrays (from the schema change).
- `epic plan <id>` prints `{ waves, cycles }` as JSON to stdout. It exits
  **non-zero when `cycles` is non-empty**, so an agent or script notices a
  malformed dependency graph, while still printing the full payload for
  diagnosis.
- New command modules are colocated following the existing pattern
  (`src/tasks/commands/ticket/`, `src/tasks/commands/epic/`).

---

## Error handling

- **Cross-repo / different-owner** link or dependency → surface the API `422`
  with a clear, actionable message.
- **Duplicate** block or sub-issue link → idempotent no-op.
- **Self-block** (`ticketId === blockedById`) → rejected before the API call.
- **Cycles** → reported in `cycles`; the planner never hangs and `epic plan`
  exits non-zero.

---

## Testing

- **`dependency-planner`** — table-driven unit tests with no mocks: ready-set
  detection, multi-wave ordering, closed-blocker satisfaction, out-of-epic
  blocker satisfaction, and cycle detection.
- **`GitHubTaskTracker`** — mock `octokit.request` for the sub-issue and
  dependency endpoints; assert method, URL, and body, plus correct mapping of
  responses, following the existing `github-task-tracker.test.ts` patterns.
- **CLI** — new command tests for `block`, `unblock`, and `plan`, following the
  existing `command.test.ts` patterns.

---

## Future work: human-readable body-metadata convention (separate spec)

Replace the remaining HTML-comment tags (starting with the TDD↔epic pointer) with
a convention that keeps issue/discussion bodies human-grokkable while still
carrying the semi-structured data the system needs (links, hints, LLM context,
and any relationship not natively expressible by the platform).

Design constraints / direction (to be settled in its own brainstorm):

- **Not YAML frontmatter.** GitHub does not parse `---` frontmatter in
  issue/discussion bodies; it renders as a visible horizontal rule plus literal
  text. Frontmatter is the wrong mechanic for this platform.
- **Preferred shape:** product-focused, human-readable content at the top; a
  collapsible **`<details><summary>LLM Context</summary>`** section at the
  bottom wrapping a fenced ` ```yaml ` block. Human-auditable and editable,
  structured and parseable. (A fully hidden HTML-comment block holding the same
  YAML is the alternative if invisibility is preferred over auditability.)
- **Abstraction:** the `TaskTracker` interface should expose an *extended
  metadata* concept; each backend serializes it however fits (GitHub → the
  `<details>` YAML block; Jira → custom fields/panels later). The storage format
  must not leak into the interface.
- **Open questions:** exact field set, the LLM-Context section structure, and
  **round-trip safety when a human hand-edits the body** (parse + preserve
  without clobbering human edits).

Deferred as a fast-follow because it is a cross-cutting body convention spanning
epics, tickets, and TDDs plus the abstraction layer — distinct enough from the
linkage work to warrant its own spec, and cheap to defer because this spec
already removes the bulk of the comment tags.

## Future work: the Initiative level (separate spec)

A level *above* Epic — an **Initiative** (e.g. "Enable social-media sharing from
Mora") grouping multiple epics (e.g. "Share to Instagram", "Share to LinkedIn").

**Intended GitHub mapping: Milestones**, because an issue's `milestone` field is
the native "links upward" hook an epic-issue has, and an issue belongs to exactly
one milestone (clean many-to-one).

Deferred to its own brainstorm because it is additive and raises distinct design
questions rather than being a simple "Epic one level up":

- A Milestone is a thinner object than an Issue: a plain description, **no
  comments, no labels, no sub-issues, and no dependencies**. So `Initiative`
  will be a different, smaller schema shape.
- Epic↔epic dependencies within an initiative, if wanted, would use the same
  `blocked_by` API on the epic **issues** — independent of milestone grouping.
  The dependency machinery in this spec already covers that case.
- Open questions: does an initiative get a rollup/TDD doc, and where (milestones
  can't hold one)? Does `plan` operate at the initiative level by aggregating
  epic waves?
- **Naming reckoning:** the existing `initiative-planner` skill currently maps to
  *epic*. Introducing a real Initiative level means deciding what
  `initiative-planner` plans versus an epic-level planner. The skills/agents are
  not yet built, so this is the natural moment to settle it — in the Initiative
  spec, alongside building those skills.

This is purely additive (new schema, `createInitiative`/`getInitiative`/
`linkEpicToInitiative`, a new command group); it does not alter the Epic/Ticket
interface defined here, so deferring it carries near-zero rework risk.
