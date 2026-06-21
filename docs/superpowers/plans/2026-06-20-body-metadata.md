# Body Metadata Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the surviving `fr-tdd`/`fr-epic` HTML-comment body tags with a structured, collapsible `<details>` block containing a sentinel-guarded fenced YAML section, and expose a `BodyMetadataService` class plus three `updateXxxMetadata` methods on `TaskTracker` so agents can read and write structured metadata on any entity.

**Architecture:** A new `BodyMetadataService` class owns all parse/splice logic — pure string manipulation, no I/O, fully unit-testable. `EntityMetadataSchema` lives alongside the existing schemas in `task-tracker.ts`. `GitHubTaskTracker` holds a private `bodyMetadata` field and calls `parse`/`splice` on every read/write path. All tag-based helpers (`frTddRegex`, `frEpicRegex`, `parseTddId`, `upsertFrTdd`) are deleted and replaced.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod, `yaml` npm package (new runtime dependency), `@octokit/rest`, `@octokit/graphql`, Vitest.

**Branch note:** This branch (`body-metadata`) was cut from `main`. It can be implemented directly on top of `main` — the `fr-tickets`/`fr-epic`-on-tickets tag logic untouched here belongs to the native-deps PR (#4) and the two change sets are independent.

## Global Constraints

- No `any`, no `!`, no `as` type assertions in `src/` non-test files. Test files (`.test.ts`) may use `as never`.
- Sentinel string is exactly `<!-- flight-rules:metadata -->` — must appear as the first line after `<summary>LLM Context</summary>` inside the managed `<details>` block.
- `EntityMetadataSchema` must use `.passthrough()` so unknown agent-written keys survive every read-modify-write cycle.
- `BodyMetadataService` must be a **class**, not loose exported functions. It is stateless; no constructor arguments needed today.
- `private readonly bodyMetadata = new BodyMetadataService()` is the field name and declaration form used on `GitHubTaskTracker`.
- `splice` must never touch content above the sentinel block; unknown keys in existing YAML must survive after `splice`.
- `splice` returns the body unchanged when `patch` resolves to an empty merge AND no block exists yet.
- YAML library: `yaml` npm package (not `js-yaml`).
- Naming: camelCase for all `const`/`let` variables; `PascalCaseSchema` suffix for Zod schemas; private methods after public methods in classes.
- Commit style: `feat: …` / `refactor: …` / `build: …` (imperative, lowercase).

---

## File Structure

**Create:**
- `src/tasks/body-metadata/body-metadata.ts` — `BodyMetadataService` class
- `src/tasks/body-metadata/body-metadata.test.ts` — 9 pure unit tests

**Modify:**
- `src/tasks/task-tracker/task-tracker.ts` — add `EntityMetadataSchema`, `EntityMetadata` type; add `metadata` field to `EpicSchema`, `TicketSchema`, `TechnicalDesignSchema`; add optional `metadata` to all three `CreateXxxInputSchema`s; add 3 interface methods
- `src/tasks/task-tracker/task-tracker.test.ts` — schema tests for new fields
- `src/tasks/github-task-tracker/github-task-tracker.ts` — add `BodyMetadataService` field; update `mapTicket`; update `getEpic`, `getTicket`, `getTechnicalDesign` (read side); update `createEpic`, `createTicket`, `createTechnicalDesign` (create side); add `updateEpicMetadata`, `updateTicketMetadata`, `updateTddMetadata`; delete `frTddRegex`, `frEpicRegex`, `parseTddId`, `upsertFrTdd`
- `src/tasks/github-task-tracker/github-task-tracker.test.ts` — new tests for all changed methods
- `src/tasks/commands/ticket/command.test.ts` — add 3 new interface mocks to `makeTracker()`
- `src/tasks/commands/epic/command.test.ts` — add 3 new interface mocks to `makeTracker()`
- `src/tasks/commands/tdd/command.test.ts` — add 3 new interface mocks to `makeTracker()`

**New runtime dependency:**
- `yaml` (npm)

---

## Task 1: `BodyMetadataService` and `EntityMetadataSchema`

**Files:**
- Create: `src/tasks/body-metadata/body-metadata.ts`
- Create: `src/tasks/body-metadata/body-metadata.test.ts`
- Modify: `src/tasks/task-tracker/task-tracker.ts`
- Shell: `package.json` (via `npm install yaml`)

**Interfaces:**
- Produces:
  - `EntityMetadataSchema` — exported from `task-tracker.ts`, used in Task 2+
  - `EntityMetadata` — exported type from `task-tracker.ts`
  - `BodyMetadataService` — exported class from `body-metadata.ts`, used by `GitHubTaskTracker` in Task 3+

---

- [ ] **Step 1: Install the `yaml` package**

```bash
npm install yaml
```

Expected: `package.json` and `package-lock.json` updated; `node_modules/yaml/` present.

---

- [ ] **Step 2: Add `EntityMetadataSchema` to `task-tracker.ts`**

Open `src/tasks/task-tracker/task-tracker.ts`. Insert after the `import { z } from 'zod'` line and before `CommentSchema`:

```typescript
export const EntityMetadataSchema = z
  .object({
    tddId: z.number().optional(),
    epicId: z.number().optional(),
    notes: z.string().optional(),
  })
  .passthrough()

export type EntityMetadata = z.infer<typeof EntityMetadataSchema>
```

---

- [ ] **Step 3: Write the failing tests**

Create `src/tasks/body-metadata/body-metadata.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { BodyMetadataService } from './body-metadata.js'

const sentinel = '<!-- flight-rules:metadata -->'

const makeBlock = (yaml: string): string =>
  `<details>\n<summary>LLM Context</summary>\n${sentinel}\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n</details>`

describe('BodyMetadataService.parse', () => {
  it('returns empty object when no sentinel block is present', () => {
    const svc = new BodyMetadataService()
    expect(svc.parse('Some body\n\n<details>\n<summary>Notes</summary>\nstuff\n</details>')).toEqual({})
  })

  it('parses typed fields from a valid block', () => {
    const svc = new BodyMetadataService()
    const result = svc.parse(`Body\n\n${makeBlock('tddId: 42\nepicId: 10')}`)
    expect(result.tddId).toBe(42)
    expect(result.epicId).toBe(10)
  })

  it('passes unknown keys through unchanged', () => {
    const svc = new BodyMetadataService()
    const result = svc.parse(`Body\n\n${makeBlock('tddId: 42\nfoo: bar')}`)
    expect(result.tddId).toBe(42)
    expect((result as Record<string, unknown>)['foo']).toBe('bar')
  })

  it('throws on YAML that parses to a non-object', () => {
    const svc = new BodyMetadataService()
    expect(() => svc.parse(`Body\n\n${makeBlock('- item1\n- item2')}`)).toThrow(
      'malformed flight-rules metadata block',
    )
  })
})

describe('BodyMetadataService.splice', () => {
  it('appends a new sentinel block when none exists', () => {
    const svc = new BodyMetadataService()
    const result = svc.splice('Some body', { tddId: 42 })
    expect(result).toContain(sentinel)
    expect(result).toContain('tddId: 42')
    expect(result.startsWith('Some body')).toBe(true)
  })

  it('leaves content above the existing block byte-identical', () => {
    const svc = new BodyMetadataService()
    const human = 'Human content above'
    const body = `${human}\n\n${makeBlock('tddId: 1')}`
    const result = svc.splice(body, { tddId: 99 })
    expect(result.startsWith(human)).toBe(true)
    expect(result).toContain('tddId: 99')
    expect(result).not.toContain('tddId: 1')
  })

  it('preserves unknown keys from existing metadata', () => {
    const svc = new BodyMetadataService()
    const body = `Body\n\n${makeBlock('tddId: 1\nfoo: bar')}`
    const result = svc.splice(body, { tddId: 2 })
    expect(result).toContain('foo: bar')
    expect(result).toContain('tddId: 2')
  })

  it('appends a new block when multiple details blocks exist but none has the sentinel', () => {
    const svc = new BodyMetadataService()
    const body =
      '<details>\n<summary>Notes</summary>\nContent\n</details>\n\n' +
      '<details>\n<summary>More</summary>\nContent\n</details>'
    const result = svc.splice(body, { tddId: 5 })
    expect(result).toContain(sentinel)
    expect(result.indexOf('<details>')).toBe(0)
  })

  it('updates only the sentinel block when multiple details blocks exist', () => {
    const svc = new BodyMetadataService()
    const other = '<details>\n<summary>Notes</summary>\nContent\n</details>'
    const managed = makeBlock('tddId: 1')
    const body = `${other}\n\n${managed}`
    const result = svc.splice(body, { tddId: 9 })
    expect(result).toContain('<summary>Notes</summary>')
    expect(result).toContain('tddId: 9')
    expect((result.match(/<details>/g) ?? []).length).toBe(2)
  })
})
```

---

- [ ] **Step 4: Run the tests to verify they fail**

```bash
npx vitest run src/tasks/body-metadata/body-metadata.test.ts
```

Expected: FAIL — module not found.

---

- [ ] **Step 5: Implement `BodyMetadataService`**

Create `src/tasks/body-metadata/body-metadata.ts`:

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { EntityMetadataSchema, type EntityMetadata } from '../task-tracker/task-tracker.js'

const sentinelComment = '<!-- flight-rules:metadata -->'

const yamlBlockRe =
  /<!-- flight-rules:metadata -->\n\n```yaml\n([\s\S]*?)\n```/

const detailsBlockRe =
  /<details>\n<summary>LLM Context<\/summary>\n<!-- flight-rules:metadata -->\n\n```yaml\n[\s\S]*?\n```\n\n<\/details>/

export class BodyMetadataService {
  parse(body: string): EntityMetadata {
    const match = yamlBlockRe.exec(body)
    if (match === null || match[1] === undefined) return {}
    const content = match[1].trim()
    if (content === '') return {}
    const raw: unknown = parseYaml(content)
    if (raw === null || raw === undefined) return {}
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('malformed flight-rules metadata block')
    }
    return EntityMetadataSchema.parse(raw)
  }

  splice(body: string, patch: Partial<EntityMetadata>): string {
    const existing = this.parse(body)
    const hasBlock = detailsBlockRe.test(body)

    const merged: Record<string, unknown> = { ...existing }
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) merged[k] = v
    }

    if (Object.keys(merged).length === 0 && !hasBlock) return body

    const yaml = stringifyYaml(merged).trimEnd()
    const block = [
      '<details>',
      '<summary>LLM Context</summary>',
      sentinelComment,
      '',
      '```yaml',
      yaml,
      '```',
      '',
      '</details>',
    ].join('\n')

    if (hasBlock) return body.replace(detailsBlockRe, block)
    return `${body}\n\n${block}`
  }
}
```

---

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/tasks/body-metadata/body-metadata.test.ts
```

Expected: PASS (9/9).

---

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/tasks/task-tracker/task-tracker.ts src/tasks/body-metadata/
git commit -m "feat: add BodyMetadataService and EntityMetadataSchema"
```

---

## Task 2: Schema widening, interface methods, and mock updates

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts`
- Modify: `src/tasks/task-tracker/task-tracker.test.ts`
- Modify: `src/tasks/commands/ticket/command.test.ts`
- Modify: `src/tasks/commands/epic/command.test.ts`
- Modify: `src/tasks/commands/tdd/command.test.ts`

**Interfaces:**
- Consumes: `EntityMetadataSchema`, `EntityMetadata` from Task 1
- Produces:
  - `EpicSchema`, `TicketSchema`, `TechnicalDesignSchema` each with `metadata: EntityMetadataSchema.default({})`
  - `CreateEpicInputSchema`, `CreateTicketInputSchema`, `CreateTechnicalDesignInputSchema` each with `metadata: EntityMetadataSchema.partial().optional()`
  - `TaskTracker` interface with `updateEpicMetadata`, `updateTicketMetadata`, `updateTddMetadata`

---

- [ ] **Step 1: Write the failing schema tests**

In `src/tasks/task-tracker/task-tracker.test.ts`, add after the existing `describe` blocks:

```typescript
describe('EntityMetadataSchema', () => {
  it('parses known fields', () => {
    const result = EntityMetadataSchema.parse({ tddId: 1, epicId: 2, notes: 'hi' })
    expect(result.tddId).toBe(1)
    expect(result.epicId).toBe(2)
    expect(result.notes).toBe('hi')
  })

  it('passes unknown keys through', () => {
    const result = EntityMetadataSchema.parse({ tddId: 1, foo: 'bar' })
    expect((result as Record<string, unknown>)['foo']).toBe('bar')
  })
})

describe('EpicSchema metadata', () => {
  it('defaults metadata to empty object', () => {
    const result = EpicSchema.parse({
      id: '10',
      status: 'open',
      labels: [],
      title: 'T',
      body: 'B',
      childIssues: [],
      comments: [],
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.metadata).toEqual({})
  })
})

describe('TicketSchema metadata', () => {
  it('defaults metadata to empty object', () => {
    const result = TicketSchema.parse({
      id: '1',
      status: 'open',
      labels: [],
      title: 'T',
      body: 'B',
      comments: [],
      assignee: null,
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.metadata).toEqual({})
  })
})
```

Also add `EntityMetadataSchema` to the imports at the top of `task-tracker.test.ts`:

```typescript
import {
  CommentSchema,
  EntityMetadataSchema,
  TicketSchema,
  EpicSchema,
  CreateEpicInputSchema,
  CreateTicketInputSchema,
  CreateTechnicalDesignInputSchema,
} from './task-tracker.js'
```

---

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/tasks/task-tracker/task-tracker.test.ts
```

Expected: FAIL — `EntityMetadataSchema` not exported; `result.metadata` undefined.

---

- [ ] **Step 3: Add `metadata` to entity schemas and `Create` input schemas**

In `src/tasks/task-tracker/task-tracker.ts`, update the three entity schemas to include `metadata`:

```typescript
export const TechnicalDesignSchema = z.object({
  id: z.string(),
  epicId: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const TicketSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  assignee: z.string().nullable(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const EpicSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  childIssues: z.array(TicketSchema),
  comments: z.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})
```

Update the three create-input schemas to include optional `metadata`:

```typescript
export const CreateEpicInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([]),
  metadata: EntityMetadataSchema.partial().optional(),
})

export const CreateTicketInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
  metadata: EntityMetadataSchema.partial().optional(),
})

export const CreateTechnicalDesignInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
  metadata: EntityMetadataSchema.partial().optional(),
})
```

---

- [ ] **Step 4: Add the three interface methods**

In `src/tasks/task-tracker/task-tracker.ts`, update the `TaskTracker` interface, adding three methods after `linkTicketToEpic`:

```typescript
export interface TaskTracker {
  createEpic(input: CreateEpicInput): Promise<Epic>
  getEpic(id: string): Promise<Epic>
  createTicket(input: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void>
  createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>
  getTechnicalDesign(id: string): Promise<TechnicalDesign>
  addComment(entityId: string, body: string): Promise<Comment>
}
```

---

- [ ] **Step 5: Update all three command test mocks**

In each of `src/tasks/commands/ticket/command.test.ts`, `src/tasks/commands/epic/command.test.ts`, and `src/tasks/commands/tdd/command.test.ts`, add the three new methods to the object returned by `makeTracker()`, immediately after `linkTicketToEpic: vi.fn()`:

```typescript
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
```

---

- [ ] **Step 6: Run typecheck and the full test suite**

```bash
npm run typecheck && npx vitest run
```

Expected: PASS — all existing tests pass; new schema tests pass; no type errors.

---

- [ ] **Step 7: Commit**

```bash
git add src/tasks/task-tracker/ src/tasks/commands/
git commit -m "feat: add metadata to schemas, interface, and command test mocks"
```

---

## Task 3: Tracker read + create sides; delete tag helpers

**Files:**
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Modify: `src/tasks/github-task-tracker/github-task-tracker.test.ts`

**Interfaces:**
- Consumes: `BodyMetadataService` from Task 1; `EntityMetadata` and widened schemas from Task 2
- Produces: `getEpic`, `getTicket`, `getTechnicalDesign` each return `metadata` field; `createEpic`, `createTicket`, `createTechnicalDesign` splice metadata into bodies; `frTddRegex`, `frEpicRegex`, `parseTddId`, `upsertFrTdd` deleted

---

- [ ] **Step 1: Write failing tests**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, add these blocks. They reference `metadata` on the returned objects — which currently don't have that field:

```typescript
describe('GitHubTracker.getEpic metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates metadata from the body sentinel block', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)

    const body =
      'Epic body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\ntddId: 3\n```\n\n</details>'
    mockGet.mockResolvedValueOnce({
      data: { number: 42, state: 'open', labels: [], title: 'My Epic', body, updated_at: '2026-01-01T00:00:00Z', assignee: null },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)

    const epic = await tracker.getEpic('42')
    expect(epic.metadata.tddId).toBe(3)
  })
})

describe('GitHubTracker.getTicket metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates metadata from the body sentinel block', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)

    const body =
      'Ticket body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>'
    mockGet.mockResolvedValueOnce({
      data: { number: 7, state: 'open', labels: [], title: 'Fix login', body, updated_at: '2026-01-01T00:00:00Z', assignee: null },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)

    const ticket = await tracker.getTicket('7')
    expect(ticket.metadata.epicId).toBe(10)
  })
})

describe('GitHubTracker.createTechnicalDesign metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes epicId into TDD body and tddId back to epic body', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql)
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGql
      .mockResolvedValueOnce({
        repository: { id: 'R_abc', discussionCategory: { id: 'DC_abc' } },
      } as never)
      .mockResolvedValueOnce({
        createDiscussion: {
          discussion: { number: 5, body: 'TDD body', updatedAt: '2026-01-01T00:00:00Z' },
        },
      } as never)

    mockGet.mockResolvedValueOnce({ data: { body: 'Epic body' } } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.createTechnicalDesign({ title: 'Auth TDD', body: 'TDD body', epicId: '10' })

    // The mutation body should contain epicId: 10 in the metadata block
    const createArgs = mockGql.mock.calls[1] as [string, Record<string, unknown>] | undefined
    expect(createArgs?.[1]?.['body']).toContain('epicId: 10')

    // The issues.update call should write tddId: 5 to the epic body
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('tddId: 5') as string,
      }),
    )
  })
})
```

---

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts
```

Expected: FAIL — `metadata` fields missing; `createTechnicalDesign` still writes `fr-epic` tag.

---

- [ ] **Step 3: Add imports and `bodyMetadata` field to `GitHubTaskTracker`**

In `src/tasks/github-task-tracker/github-task-tracker.ts`:

Add the `BodyMetadataService` import after the `@octokit/graphql` import:

```typescript
import { BodyMetadataService } from '../body-metadata/body-metadata.js'
```

Add `EntityMetadata` to the type import from `task-tracker.js`:

```typescript
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
  CreateTechnicalDesignInput,
  EntityMetadata,
  Epic,
  TaskTracker,
  TechnicalDesign,
  Ticket,
} from '../task-tracker/task-tracker.js'
```

Add `private readonly bodyMetadata = new BodyMetadataService()` as the last private field declaration, before the constructor:

```typescript
export class GitHubTaskTracker implements TaskTracker {
  private octokit: Octokit
  private gql: ReturnType<typeof graphql.defaults>
  private owner: string
  private repo: string
  private readonly bodyMetadata = new BodyMetadataService()

  constructor(config: GitHubTrackerConfig) { ... }
```

---

- [ ] **Step 4: Update `mapTicket` to accept and emit `metadata`**

Replace the `mapTicket` function with:

```typescript
function mapTicket(
  issue: OctokitIssueData,
  comments: OctokitCommentData[],
  metadata: EntityMetadata = {},
): Ticket {
  return {
    id: String(issue.number),
    status: issue.state,
    labels: issue.labels.map(labelName).filter(Boolean),
    title: issue.title,
    body: issue.body ?? '',
    comments: comments.map(mapComment),
    assignee: issue.assignee?.login ?? null,
    metadata,
    updatedAt: issue.updated_at,
  }
}
```

---

- [ ] **Step 5: Delete the tag helpers**

Delete these four items entirely from `github-task-tracker.ts`:
- `const frTddRegex = /<!-- fr-tdd: (\d+) -->/`
- `const frEpicRegex = /<!-- fr-epic: (\d+) -->/`
- `function parseTddId(body: string): number | null { ... }`
- `function upsertFrTdd(body: string, tddId: number): string { ... }`

Leave `frTicketsRegex`, `parseTicketIds`, `upsertFrTickets` untouched (those belong to PR #4).

---

- [ ] **Step 6: Update `getEpic` to parse metadata and use `metadata.tddId`**

Replace the `getEpic` method with:

```typescript
async getEpic(id: string): Promise<Epic> {
  const issueNumber = parseInt(id, 10)
  const [issueResponse, commentsResponse] = await Promise.all([
    this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
  ])
  const issue = issueResponse.data
  const body = issue.body ?? ''
  const metadata = this.bodyMetadata.parse(body)

  const ticketIds = parseTicketIds(body)
  const childIssues = await Promise.all(ticketIds.map((n) => this.getTicket(String(n))))

  let tdd: TechnicalDesign | undefined
  if (metadata.tddId !== undefined) {
    tdd = await this.getTechnicalDesign(String(metadata.tddId))
  }

  return {
    id,
    status: issue.state,
    labels: issue.labels.map(labelName).filter(Boolean),
    title: issue.title,
    body,
    childIssues,
    comments: commentsResponse.data.map(mapComment),
    tdd,
    metadata,
    updatedAt: issue.updated_at,
  }
}
```

---

- [ ] **Step 7: Update `getTicket` to parse metadata**

Replace `getTicket` with:

```typescript
async getTicket(id: string): Promise<Ticket> {
  const issueNumber = parseInt(id, 10)
  const [issueResponse, commentsResponse] = await Promise.all([
    this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
  ])
  const body = issueResponse.data.body ?? ''
  const metadata = this.bodyMetadata.parse(body)
  return mapTicket(issueResponse.data, commentsResponse.data, metadata)
}
```

---

- [ ] **Step 8: Update `createEpic` to splice metadata**

Replace `createEpic` with:

```typescript
async createEpic(input: CreateEpicInput): Promise<Epic> {
  const body = this.bodyMetadata.splice(input.body, input.metadata ?? {})
  const { data } = await this.octokit.rest.issues.create({
    owner: this.owner,
    repo: this.repo,
    title: input.title,
    body,
    labels: ['epic', ...input.labels],
  })
  return {
    id: String(data.number),
    status: data.state,
    labels: data.labels.map(labelName).filter(Boolean),
    title: data.title,
    body: data.body ?? '',
    childIssues: [],
    comments: [],
    metadata: this.bodyMetadata.parse(data.body ?? ''),
    updatedAt: data.updated_at,
  }
}
```

---

- [ ] **Step 9: Update `createTicket` to splice metadata**

Replace the body-construction line in `createTicket`:

```typescript
// Before:
const body = `${input.body}\n<!-- fr-epic: ${input.epicId} -->`

// After:
const body = this.bodyMetadata.splice(input.body, input.metadata ?? {})
```

Also update the `return mapTicket(data, [])` line — it now needs an empty metadata default since `createTicket` does not write `epicId` to the ticket metadata (the native sub-issue link from PR #4 handles the parent relationship):

```typescript
return mapTicket(data, [], {})
```

---

- [ ] **Step 10: Update `createTechnicalDesign` to splice metadata and replace `upsertFrTdd`**

Replace the body-construction and the write-back block in `createTechnicalDesign`:

```typescript
// Old first line:
const body = `${input.body}\n<!-- fr-epic: ${input.epicId} -->`

// New (writes epicId into TDD body via metadata):
const body = this.bodyMetadata.splice(input.body, {
  epicId: parseInt(input.epicId, 10),
  ...input.metadata,
})
```

Replace the `upsertFrTdd` write-back block:

```typescript
// Old:
await this.octokit.rest.issues.update({
  owner: this.owner,
  repo: this.repo,
  issue_number: parseInt(input.epicId, 10),
  body: upsertFrTdd(epicResponse.data.body ?? '', discussion.number),
})

// New (writes tddId into epic body via metadata):
await this.octokit.rest.issues.update({
  owner: this.owner,
  repo: this.repo,
  issue_number: parseInt(input.epicId, 10),
  body: this.bodyMetadata.splice(epicResponse.data.body ?? '', { tddId: discussion.number }),
})
```

---

- [ ] **Step 11: Update `getTechnicalDesign` to read `epicId` from metadata**

Replace the `frEpicRegex` lines in `getTechnicalDesign`:

```typescript
// Old:
const epicMatch = frEpicRegex.exec(discussion.body)
const epicId = epicMatch !== null && epicMatch[1] !== undefined ? epicMatch[1] : ''

// New:
const metadata = this.bodyMetadata.parse(discussion.body)
const epicId = metadata.epicId !== undefined ? String(metadata.epicId) : ''
```

Also add `metadata` to the returned `TechnicalDesign` object:

```typescript
return {
  id,
  epicId,
  body: discussion.body,
  comments: discussion.comments.nodes.map((n) => ({
    id: n.id,
    body: n.body,
    author: n.author?.login ?? '',
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  })),
  metadata,
  updatedAt: discussion.updatedAt,
}
```

---

- [ ] **Step 12: Run typecheck and tracker tests**

```bash
npm run typecheck && npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts
```

Expected: PASS.

---

- [ ] **Step 13: Commit**

```bash
git add src/tasks/github-task-tracker/
git commit -m "refactor: replace fr-tdd/fr-epic tags with body metadata in tracker"
```

---

## Task 4: `updateEpicMetadata`, `updateTicketMetadata`, `updateTddMetadata`

**Files:**
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Modify: `src/tasks/github-task-tracker/github-task-tracker.test.ts`

**Interfaces:**
- Consumes: `BodyMetadataService.splice` from Task 1; `EntityMetadata` from Task 2; `bodyMetadata` field from Task 3
- Produces: three public methods that satisfy the `TaskTracker` interface methods added in Task 2

---

- [ ] **Step 1: Write the failing tests**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, add:

```typescript
describe('GitHubTracker.updateEpicMetadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the epic body, splices the patch, and updates the issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({ data: { body: 'Epic body' } } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.updateEpicMetadata('42', { tddId: 7 })

    expect(mockGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'proj', issue_number: 42 })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 42,
        body: expect.stringContaining('tddId: 7') as string,
      }),
    )
  })
})

describe('GitHubTracker.updateTicketMetadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the ticket body, splices the patch, and updates the issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({ data: { body: 'Ticket body' } } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.updateTicketMetadata('7', { notes: 'Use JWT rotation' })

    expect(mockGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'proj', issue_number: 7 })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 7,
        body: expect.stringContaining('Use JWT rotation') as string,
      }),
    )
  })
})

describe('GitHubTracker.updateTddMetadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the discussion by node id and calls the update mutation', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql)

    mockGql
      .mockResolvedValueOnce({
        repository: { discussion: { id: 'D_kwDOABC123', body: 'TDD body' } },
      } as never)
      .mockResolvedValueOnce({ updateDiscussion: { discussion: { number: 3 } } } as never)

    await tracker.updateTddMetadata('3', { epicId: 10 })

    expect(mockGql).toHaveBeenCalledTimes(2)
    const mutVars = mockGql.mock.calls[1]?.[1] as { discussionId: string; body: string } | undefined
    expect(mutVars?.discussionId).toBe('D_kwDOABC123')
    expect(mutVars?.body).toContain('epicId: 10')
  })
})
```

---

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts
```

Expected: FAIL — `updateEpicMetadata`, `updateTicketMetadata`, `updateTddMetadata` do not exist (also a typecheck error).

---

- [ ] **Step 3: Implement the three update methods**

In `src/tasks/github-task-tracker/github-task-tracker.ts`, add these three public methods immediately after `linkTicketToEpic` (keeping all public methods before any private methods):

```typescript
async updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void> {
  const issueNumber = parseInt(epicId, 10)
  const { data } = await this.octokit.rest.issues.get({
    owner: this.owner,
    repo: this.repo,
    issue_number: issueNumber,
  })
  await this.octokit.rest.issues.update({
    owner: this.owner,
    repo: this.repo,
    issue_number: issueNumber,
    body: this.bodyMetadata.splice(data.body ?? '', patch),
  })
}

async updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void> {
  const issueNumber = parseInt(ticketId, 10)
  const { data } = await this.octokit.rest.issues.get({
    owner: this.owner,
    repo: this.repo,
    issue_number: issueNumber,
  })
  await this.octokit.rest.issues.update({
    owner: this.owner,
    repo: this.repo,
    issue_number: issueNumber,
    body: this.bodyMetadata.splice(data.body ?? '', patch),
  })
}

async updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void> {
  const fetchData = await this.gql<{
    repository: { discussion: { id: string; body: string } | null }
  }>(
    `query GetDiscussionForUpdate($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) { id body }
      }
    }`,
    { owner: this.owner, repo: this.repo, number: parseInt(tddId, 10) },
  )
  const discussion = fetchData.repository.discussion
  if (discussion === null) throw new Error(`Discussion #${tddId} not found`)
  await this.gql(
    `mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
      updateDiscussion(input: { discussionId: $discussionId, body: $body }) {
        discussion { number }
      }
    }`,
    {
      discussionId: discussion.id,
      body: this.bodyMetadata.splice(discussion.body, patch),
    },
  )
}
```

---

- [ ] **Step 4: Run typecheck and the full test suite**

```bash
npm run typecheck && npx vitest run
```

Expected: PASS, no type errors.

---

- [ ] **Step 5: Commit**

```bash
git add src/tasks/github-task-tracker/
git commit -m "feat: add updateEpicMetadata, updateTicketMetadata, updateTddMetadata"
```

---

## Task 5: Rebuild binary and verify

**Files:**
- Modify: `bin/flight-rules`

---

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck && npx eslint src/ && npx vitest run
```

Expected: PASS, zero lint errors, all tests green.

---

- [ ] **Step 2: Rebuild the bundle**

```bash
npm run build
```

Expected: writes `bin/flight-rules`, exit 0.

---

- [ ] **Step 3: Confirm the binary changed**

```bash
git diff --stat bin/
```

Expected: `bin/flight-rules` listed as modified.

---

- [ ] **Step 4: Commit**

```bash
git add bin/flight-rules
git commit -m "build: rebuild binary with body metadata convention"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `BodyMetadataService` class with `parse`/`splice` | Task 1 |
| Sentinel `<!-- flight-rules:metadata -->` | Task 1 |
| `EntityMetadataSchema` with `.passthrough()` | Task 1 |
| `yaml` npm package | Task 1 |
| `metadata` field on `Epic`, `Ticket`, `TechnicalDesign` | Task 2 |
| Optional `metadata` on all Create inputs | Task 2 |
| `updateEpicMetadata` / `updateTicketMetadata` / `updateTddMetadata` on interface | Task 2 |
| Three command test mocks updated | Task 2 |
| `getEpic` / `getTicket` / `getTechnicalDesign` populate `metadata` | Task 3 |
| `createEpic` / `createTicket` splice metadata into body | Task 3 |
| `createTechnicalDesign` writes `epicId` to TDD body + `tddId` to epic body | Task 3 |
| `frTddRegex`, `frEpicRegex`, `parseTddId`, `upsertFrTdd` deleted | Task 3 |
| `getTechnicalDesign` reads `epicId` from `metadata.epicId` | Task 3 |
| `updateEpicMetadata` / `updateTicketMetadata` GET + splice + PATCH | Task 4 |
| `updateTddMetadata` GraphQL query + `updateDiscussion` mutation | Task 4 |
| Binary rebuilt | Task 5 |

**Type consistency check:**

- `EntityMetadata` is defined in Task 1, imported in Tasks 2, 3, 4 — consistent.
- `BodyMetadataService` class exported from `body-metadata.ts` — matches field declaration `private readonly bodyMetadata = new BodyMetadataService()`.
- `mapTicket(issue, comments, metadata = {})` — 3-arg signature used in Task 3 Steps 7 and 9.
- `metadata.tddId` is `number | undefined`; `String(metadata.tddId)` converts safely — used in `getEpic` Step 6 and `createTechnicalDesign` write-back Step 10.
- `updateDiscussion` mutation accepts `discussionId: ID!` — sourced from `discussion.id` (the GraphQL node ID string) in Task 4 Step 3.
