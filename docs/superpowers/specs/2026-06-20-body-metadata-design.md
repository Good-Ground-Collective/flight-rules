# Body Metadata Convention — Design Spec

**Date:** 2026-06-20
**Status:** Approved
**Depends on:** [`2026-06-17-native-deps-subissues-design.md`](2026-06-17-native-deps-subissues-design.md) (PR #4 must be merged first)
**Builds on:** [`2026-05-27-flight-rules-plugin-design.md`](2026-05-27-flight-rules-plugin-design.md)

---

## Overview

Replaces the remaining HTML-comment body tags (`fr-tdd` on epics, `fr-epic` on
TDDs) with a structured, human-readable `<details>` section at the bottom of
every issue and discussion body. The section is collapsed by default on GitHub,
keeping the human-facing content clean while providing a machine-parseable,
agent-writable workspace for structured links and free-form notes.

After PR #4 (native sub-issues + dependencies) merges, the only surviving
comment tags are:
- `<!-- fr-tdd: N -->` on epic issue bodies (points to the TDD discussion)
- `<!-- fr-epic: N -->` on TDD discussion bodies (points back to the parent epic)

This spec replaces both with the metadata convention and leaves zero comment
tags in any body.

---

## Rendered format

Every Epic, Ticket, and TechnicalDesign body on GitHub ends with this block:

```
<details>
<summary>LLM Context</summary>
<!-- flight-rules:metadata -->

```yaml
tddId: 42        # epic only — linked TDD discussion number
epicId: 10       # ticket and TDD only — parent epic number
notes: |
  The auth flow uses short-lived JWTs. Prefer refresh-token rotation
  over long-lived tokens. Existing middleware lives in src/auth/.
```

</details>
```

**Key decisions:**

- `<!-- flight-rules:metadata -->` is the **sentinel**. The parser identifies
  a managed `<details>` block by the presence of this comment immediately after
  the `<summary>` tag. Any other `<details>` block — even one also titled "LLM
  Context" — is ignored. Users can freely use native `<details>` blocks in their
  issue content without interference.
- The `<summary>` label is `LLM Context` — visible when collapsed, descriptive
  to a human reader, not alarming.
- The YAML block is fenced (` ```yaml `) so GitHub renders it with syntax
  highlighting when expanded.
- The block is collapsed by default on GitHub — the human-readable product
  content above it is the default view.

---

## Section 1: `body-metadata` module

**Location:** `src/tasks/body-metadata/body-metadata.ts`

### Schema

Lives in `src/tasks/task-tracker/task-tracker.ts` alongside the existing
schemas:

```typescript
export const EntityMetadataSchema = z.object({
  tddId: z.number().optional(),   // epic only
  epicId: z.number().optional(),  // ticket and TDD only
  notes: z.string().optional(),   // any entity, agent-authored
}).passthrough()                  // unknown keys are preserved as-is

export type EntityMetadata = z.infer<typeof EntityMetadataSchema>
```

`passthrough()` ensures that any keys an agent wrote that the current schema
doesn't know about are preserved on every read-modify-write cycle.

### `BodyMetadataService` class

```typescript
export class BodyMetadataService {
  parse(body: string): EntityMetadata
  splice(body: string, patch: Partial<EntityMetadata>): string
}
```

**`parse(body)`**

1. Searches the body for `<!-- flight-rules:metadata -->` using a regex.
2. If not found, returns `{}`.
3. Finds the enclosing fenced YAML block (` ```yaml … ``` `).
4. Parses with the `yaml` npm package.
5. Validates through `EntityMetadataSchema` (typed fields validated strictly;
   unknown keys passed through unchanged via `.passthrough()`).
6. If the sentinel is present but the YAML is malformed, throws:
   `'malformed flight-rules metadata block'`.

**`splice(body, patch)`**

1. Calls `parse(body)` to read existing metadata (or `{}` if none).
2. Shallow-merges `patch` into the existing metadata (preserves all existing
   keys, including unknown ones; only specified keys are updated).
3. Serializes the merged result back to YAML using the `yaml` package (uses
   block scalar `|` for multiline strings automatically).
4. If a sentinel block already exists in the body: regex-replaces only the
   YAML content inside it, leaving all surrounding body content — including
   the human-readable top section — untouched.
5. If no sentinel block exists: appends the full `<details>` block to the
   body.
6. If YAML is malformed during merge, throws before writing — never produces
   a partial or corrupt body.

**YAML library:** `yaml` (npm). Chosen over `js-yaml` for first-class YAML 1.2
support and clean handling of multiline strings via the `|` block scalar, which
is important for agent-authored `notes` content.

**The class is stateless.** No constructor arguments are needed today.
`GitHubTaskTracker` holds it as a private field:

```typescript
private readonly bodyMetadata = new BodyMetadataService()
```

The constructor exists so config (e.g. a custom sentinel) can be injected later
without changing call sites.

---

## Section 2: `TaskTracker` interface changes

### Schema additions (in `task-tracker.ts`)

`EntityMetadataSchema` and `EntityMetadata` type added (see Section 1).

`Epic`, `Ticket`, and `TechnicalDesign` each gain:
```typescript
metadata: EntityMetadata
```

`CreateEpicInputSchema`, `CreateTicketInputSchema`, and
`CreateTechnicalDesignInputSchema` each gain:
```typescript
metadata: EntityMetadataSchema.partial().optional()
```
This lets the initiative-planner set initial notes in the same call that creates
the entity, avoiding a second round-trip.

### New interface methods

Added after `linkTicketToEpic` in `TaskTracker`, one per entity type (matching
the existing per-entity pattern and avoiding type-ambiguity between issues and
discussions at the backend level):

```typescript
updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void>
updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void>
updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void>
```

---

## Section 3: `GitHubTaskTracker` changes

### On read

`getEpic`, `getTicket`, `getTechnicalDesign` each call
`this.bodyMetadata.parse(body)` on the fetched body and include the result as
the `metadata` field on the returned object. No extra API calls — it is a pure
parse of the body already in hand.

### On create

`createEpic`, `createTicket`, `createTechnicalDesign` splice metadata into the
initial body before the API call:

```typescript
const body = this.bodyMetadata.splice(input.body, input.metadata ?? {})
```

For `createTechnicalDesign` specifically, `epicId` is always written into
metadata (replacing the current `fr-epic` body tag):

```typescript
const body = this.bodyMetadata.splice(input.body, {
  epicId: parseInt(input.epicId, 10),
  ...input.metadata,
})
```

For `createEpic`, nothing structural is in metadata at creation time — `tddId`
is written later by `updateEpicMetadata` when the TDD is linked.

### New update methods

**`updateEpicMetadata(epicId, patch)` and `updateTicketMetadata(ticketId, patch)`:**

1. GET the issue body via `octokit.rest.issues.get`.
2. `this.bodyMetadata.splice(body, patch)`.
3. PATCH via `octokit.rest.issues.update`.

**`updateTddMetadata(tddId, patch)`:**

1. GET the discussion body via the existing GraphQL `GetDiscussion` query.
2. `this.bodyMetadata.splice(body, patch)`.
3. Write back via a new `updateDiscussion` GraphQL mutation:
   ```graphql
   mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
     updateDiscussion(input: { discussionId: $discussionId, body: $body }) {
       discussion { number body updatedAt }
     }
   }
   ```
   The `discussionId` is the GraphQL global node ID, fetched from the same
   `GetDiscussion` query (`discussion.id`).

### Deleted

- `frTddRegex`, `frEpicRegex`, `parseTddId`, `upsertFrTdd` and all call sites.
- The `createTechnicalDesign` call to `upsertFrTdd` on the epic body becomes
  `this.updateEpicMetadata(input.epicId, { tddId: discussion.number })`.

---

## Section 4: Error handling

| Scenario | Behaviour |
|---|---|
| No sentinel block in body | `parse` returns `{}`; `splice` appends a new block |
| Sentinel present, YAML malformed | Both `parse` and `splice` throw with message `'malformed flight-rules metadata block'` |
| `splice` would produce malformed YAML | Throws before writing — body is never partially updated |
| Multiple `<details>` blocks, none with sentinel | `parse` returns `{}`; `splice` appends a new block |
| Multiple `<details>` blocks, one with sentinel | Only the sentinel block is touched |

---

## Section 5: Testing

### `BodyMetadataService` (pure unit tests, no mocks)

- `parse` with no sentinel block → `{}`
- `parse` with valid block, typed fields → correct values
- `parse` with unknown keys → passes through unchanged
- `parse` with malformed YAML → throws
- `splice` into body with no existing block → appends block, preserves all preceding content
- `splice` into body with existing block → replaces only YAML, human content above is byte-identical
- `splice` preserves unknown keys from existing metadata
- `splice` with multiple `<details>` blocks (none with sentinel) → appends; existing blocks untouched
- `splice` with multiple `<details>` blocks (one with sentinel) → only sentinel block updated

### `GitHubTaskTracker` (existing mock pattern)

- `updateEpicMetadata` / `updateTicketMetadata`: mock `issues.get` returning a
  body with an existing metadata block; assert `issues.update` called with the
  correctly spliced body.
- `updateTddMetadata`: mock GraphQL query returning body + node id; assert
  `updateDiscussion` mutation called with correctly spliced body.
- `createTechnicalDesign`: assert `epicId` lands in the TDD body's metadata
  block, and `issues.update` is called on the epic with a body containing
  `tddId: N` in the metadata block (the write-back to the epic).
- `getEpic` / `getTicket` / `getTechnicalDesign`: assert `metadata` field is
  populated from the fetched body.

---

## File structure

**Create:**
- `src/tasks/body-metadata/body-metadata.ts`
- `src/tasks/body-metadata/body-metadata.test.ts`

**Modify:**
- `src/tasks/task-tracker/task-tracker.ts` — `EntityMetadataSchema`, `EntityMetadata`, add `metadata` to all entity schemas and create-input schemas, add three interface methods.
- `src/tasks/task-tracker/task-tracker.test.ts` — schema tests for new fields.
- `src/tasks/github-task-tracker/github-task-tracker.ts` — delete tag helpers, add `BodyMetadataService` field, update all read/create methods, add three update methods.
- `src/tasks/github-task-tracker/github-task-tracker.test.ts` — new tests.
- All three command test files — add `updateEpicMetadata`, `updateTicketMetadata`, `updateTddMetadata` to `makeTracker()` mock literals.

**New dependency:**
- `yaml` npm package (runtime).

---

## Out of scope

- Jira backend — interface methods exist; Jira implementation is deferred per the
  original design spec.
- CLI commands for reading/writing metadata directly — agents call the interface;
  no human-facing CLI surface is needed yet.
- Migration of existing live issue bodies — the spec targets new entities and
  entities touched by future agent writes. Pre-existing bodies without the
  sentinel block simply return `{}` from `parse`, which is safe.
