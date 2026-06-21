# Native Sub-Issues & Ticket Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the HTML-comment-tag epic↔ticket linking with GitHub's native sub-issues, add native ticket dependencies (`blocked_by`/`blocking`), and add a pure planner that topologically orders an epic's tickets so an agent can decide what to work next.

**Architecture:** The `TaskTracker` interface gains `blockTicket`/`unblockTicket`; `Ticket` gains `blockedBy`/`blocking`. `GitHubTaskTracker` calls the native sub-issue and dependency REST endpoints (via `octokit.request` with explicit routes, since these endpoints are newer than the typed `octokit.rest.*` helpers). A standalone pure `dependency-planner` module computes dependency "waves". New CLI subcommands `ticket block`, `ticket unblock`, and `epic plan` wire it together.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod, `@octokit/rest`, `commander`, Vitest. Lint forbids `any`, non-null assertions (`!`), and `as` assertions in non-test source (test files are exempt).

---

## Spec

`docs/superpowers/specs/2026-06-17-native-deps-subissues-design.md`

## GitHub REST routes used (API version `2026-03-10`)

All target an issue by `issue_number` in the path; relationship *targets* are passed as the global database `id` (`sub_issue_id` / `issue_id`), which is `data.id` from `issues.get`.

- `GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues` — list children
- `POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues` — add child (`sub_issue_id`)
- `GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` — blockers
- `GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking` — blocked
- `POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` — add blocker (`issue_id`)
- `DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}` — remove blocker

---

## File Structure

**Modify:**
- `src/tasks/task-tracker/task-tracker.ts` — add `blockedBy`/`blocking` to `TicketSchema`; add `blockTicket`/`unblockTicket` to `TaskTracker`.
- `src/tasks/task-tracker/task-tracker.test.ts` — schema test for the new fields.
- `src/tasks/github-task-tracker/github-task-tracker.ts` — native sub-issues + dependency methods; drop `fr-tickets` helpers.
- `src/tasks/github-task-tracker/github-task-tracker.test.ts` — add `request` to the Octokit mock; rewrite/extend tests.
- `src/tasks/commands/ticket/command.ts` — add `block`/`unblock` subcommands.
- `src/tasks/commands/ticket/command.test.ts` — update mock + `mockTicket`; add tests.
- `src/tasks/commands/epic/command.ts` — add `plan` subcommand.
- `src/tasks/commands/epic/command.test.ts` — update mock; add `plan` tests.
- `src/tasks/commands/tdd/command.test.ts` — update mock to satisfy the widened interface.
- `bin/flight-rules` — rebuilt bundle (final task).

**Create:**
- `src/tasks/dependency-planner/dependency-planner.ts`
- `src/tasks/dependency-planner/dependency-planner.test.ts`

---

## Task 1: Add `blockedBy`/`blocking` to the Ticket schema

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts`
- Modify: `src/tasks/task-tracker/task-tracker.test.ts`
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts` (`mapTicket`)
- Modify: `src/tasks/commands/ticket/command.test.ts` (`mockTicket` literal)

- [ ] **Step 1: Write the failing schema test**

In `src/tasks/task-tracker/task-tracker.test.ts`, add inside `describe('TicketSchema', ...)`:

```typescript
  it('defaults blockedBy and blocking to empty arrays', () => {
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
    expect(result.blockedBy).toEqual([])
    expect(result.blocking).toEqual([])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tasks/task-tracker/task-tracker.test.ts`
Expected: FAIL — `result.blockedBy` is `undefined`.

- [ ] **Step 3: Add the fields to `TicketSchema`**

In `src/tasks/task-tracker/task-tracker.ts`, change `TicketSchema` to:

```typescript
export const TicketSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  assignee: z.string().nullable(),
  blockedBy: z.array(z.string()).default([]),
  blocking: z.array(z.string()).default([]),
  updatedAt: z.string(),
})
```

- [ ] **Step 4: Keep `mapTicket` and typed literals compiling**

The `Ticket` type now requires `blockedBy`/`blocking`. Update `mapTicket` in `src/tasks/github-task-tracker/github-task-tracker.ts` to accept and emit them (default empty so existing callers are unaffected):

```typescript
function mapTicket(
  issue: OctokitIssueData,
  comments: OctokitCommentData[],
  blockedBy: string[] = [],
  blocking: string[] = [],
): Ticket {
  return {
    id: String(issue.number),
    status: issue.state,
    labels: issue.labels.map(labelName).filter(Boolean),
    title: issue.title,
    body: issue.body ?? '',
    comments: comments.map(mapComment),
    assignee: issue.assignee?.login ?? null,
    blockedBy,
    blocking,
    updatedAt: issue.updated_at,
  }
}
```

Then update the typed literal in `src/tasks/commands/ticket/command.test.ts`:

```typescript
const mockTicket: Ticket = {
  id: '7',
  status: 'open',
  labels: ['ticket'],
  title: 'Fix login',
  body: 'Details',
  comments: [],
  assignee: null,
  blockedBy: [],
  blocking: [],
  updatedAt: '2026-01-01T00:00:00Z',
}
```

- [ ] **Step 5: Run typecheck and the full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/task-tracker/task-tracker.ts src/tasks/task-tracker/task-tracker.test.ts src/tasks/github-task-tracker/github-task-tracker.ts src/tasks/commands/ticket/command.test.ts
git commit -m "feat: add blockedBy/blocking fields to Ticket schema"
```

---

## Task 2: Pure `dependency-planner` module

**Files:**
- Create: `src/tasks/dependency-planner/dependency-planner.ts`
- Create: `src/tasks/dependency-planner/dependency-planner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tasks/dependency-planner/dependency-planner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { planDependencies } from './dependency-planner.js'
import type { PlannerTicket } from './dependency-planner.js'

const t = (id: string, blockedBy: string[] = [], status = 'open'): PlannerTicket => ({
  id,
  status,
  blockedBy,
})

const ids = (wave: PlannerTicket[]): string[] => wave.map((x) => x.id)

describe('planDependencies', () => {
  it('puts all unblocked open tickets in wave 0', () => {
    const plan = planDependencies([t('1'), t('2'), t('3')])
    expect(plan.waves.map(ids)).toEqual([['1', '2', '3']])
    expect(plan.cycles).toEqual([])
  })

  it('orders a linear chain into successive waves', () => {
    // 3 blocked by 2, 2 blocked by 1
    const plan = planDependencies([t('1'), t('2', ['1']), t('3', ['2'])])
    expect(plan.waves.map(ids)).toEqual([['1'], ['2'], ['3']])
  })

  it('treats a closed blocker as satisfied', () => {
    const plan = planDependencies([t('1', [], 'closed'), t('2', ['1'])])
    expect(plan.waves.map(ids)).toEqual([['2']])
    expect(plan.cycles).toEqual([])
  })

  it('treats an out-of-epic blocker as satisfied', () => {
    const plan = planDependencies([t('2', ['999'])])
    expect(plan.waves.map(ids)).toEqual([['2']])
  })

  it('excludes closed tickets from waves', () => {
    const plan = planDependencies([t('1', [], 'closed'), t('2')])
    expect(plan.waves.map(ids)).toEqual([['2']])
  })

  it('reports unschedulable tickets when a cycle exists', () => {
    // 1 blocked by 2, 2 blocked by 1
    const plan = planDependencies([t('1', ['2']), t('2', ['1'])])
    expect(plan.waves).toEqual([])
    expect(plan.cycles).toEqual(['1', '2'])
  })

  it('schedules acyclic tickets and reports only the stuck ones', () => {
    // 1 ok; 2<->3 cycle
    const plan = planDependencies([t('1'), t('2', ['3']), t('3', ['2'])])
    expect(plan.waves.map(ids)).toEqual([['1']])
    expect(plan.cycles).toEqual(['2', '3'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tasks/dependency-planner/dependency-planner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the planner**

Create `src/tasks/dependency-planner/dependency-planner.ts`:

```typescript
export interface PlannerTicket {
  id: string
  status: string
  blockedBy: string[]
}

export interface DependencyPlan {
  waves: PlannerTicket[][]
  cycles: string[]
}

export function planDependencies(tickets: PlannerTicket[]): DependencyPlan {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const isOpen = (ticket: PlannerTicket): boolean => ticket.status !== 'closed'

  // A blocker is satisfied if it is not one of our tickets, or it is closed.
  const isSatisfied = (blockerId: string): boolean => {
    const blocker = byId.get(blockerId)
    return blocker === undefined || !isOpen(blocker)
  }

  const openTickets = tickets.filter(isOpen)
  const placed = new Set<string>()
  const waves: PlannerTicket[][] = []

  for (;;) {
    const wave = openTickets.filter(
      (ticket) =>
        !placed.has(ticket.id) &&
        ticket.blockedBy.every((blocker) => isSatisfied(blocker) || placed.has(blocker)),
    )
    if (wave.length === 0) break
    for (const ticket of wave) placed.add(ticket.id)
    waves.push(wave)
  }

  const cycles = openTickets.filter((ticket) => !placed.has(ticket.id)).map((ticket) => ticket.id)

  return { waves, cycles }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tasks/dependency-planner/dependency-planner.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/dependency-planner/
git commit -m "feat: add dependency-planner for topological ticket ordering"
```

---

## Task 3: Migrate epic↔ticket linking to native sub-issues

**Files:**
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Modify: `src/tasks/github-task-tracker/github-task-tracker.test.ts`

- [ ] **Step 1: Add `request` to the Octokit test mock**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, extend the `@octokit/rest` mock so the returned object includes a `request` mock:

```typescript
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      request: vi.fn(),
      rest: {
        issues: {
          create: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          createComment: vi.fn(),
          listComments: vi.fn(),
        },
      },
    }
  }),
}))
```

- [ ] **Step 2: Replace the `linkTicketToEpic` tests with native sub-issue tests**

Replace the entire `describe('GitHubTracker.linkTicketToEpic', ...)` block with:

```typescript
describe('GitHubTracker.linkTicketToEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds the ticket as a native sub-issue of the epic', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)

    mockRequest.mockImplementation((route: string) => {
      if (route.startsWith('GET')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })
    // resolveIssueId(7) → global id 999
    mockGet.mockResolvedValueOnce({ data: { id: 999, number: 7 } } as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: 'acme', repo: 'proj', issue_number: 10, sub_issue_id: 999 },
    )
  })

  it('does not re-add a ticket already a sub-issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockRequest.mockResolvedValueOnce({ data: [{ number: 7 }] } as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: 'acme', repo: 'proj', issue_number: 10 },
    )
  })
})
```

- [ ] **Step 3: Update the `getEpic` test to mock the sub-issues list**

In the existing `describe('GitHubTracker.getEpic', ...)` test, after the `mockListComments.mockResolvedValueOnce(...)` line, add a `request` mock returning no sub-issues:

```typescript
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    mockRequest.mockResolvedValue({ data: [] } as never)
```

Also update the comment/assertion text: the epic now has no child issues because the sub-issues list is empty (not because of a missing `fr-tickets` comment). Change the `it(...)` title to `'returns an epic with no child issues when it has no sub-issues'`.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: FAIL — `linkTicketToEpic` still writes `fr-tickets`; `getEpic` still reads tags.

- [ ] **Step 5: Reimplement `linkTicketToEpic`, `getEpic`, `createTicket`, and add `resolveIssueId`**

In `src/tasks/github-task-tracker/github-task-tracker.ts`:

Add a `zod` import at the top of the file (the responses from `octokit.request` for these newer routes are typed `unknown`, so we parse them):

```typescript
import { z } from 'zod'
```

Add this module-level schema near the existing `fr*Regex` declarations. We only ever need each related issue's `number`:

```typescript
const IssueRefListSchema = z.array(z.object({ number: z.number() }))
```

Delete the now-unused tag helpers and regex: `frTicketsRegex`, `parseTicketIds`, and `upsertFrTickets`. **Keep** `frTddRegex`, `frEpicRegex`, `parseTddId`, and `upsertFrTdd` (still used for the TDD link).

Replace `getEpic` with:

```typescript
  async getEpic(id: string): Promise<Epic> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse, subIssuesResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
    ])
    const issue = issueResponse.data
    const body = issue.body ?? ''

    const childNumbers = IssueRefListSchema.parse(subIssuesResponse.data).map((ref) => String(ref.number))
    const childIssues = await Promise.all(childNumbers.map((n) => this.getTicket(n)))

    let tdd: TechnicalDesign | undefined
    const tddId = parseTddId(body)
    if (tddId !== null) {
      tdd = await this.getTechnicalDesign(String(tddId))
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
      updatedAt: issue.updated_at,
    }
  }
```

Replace `createTicket` (drop the `fr-epic` body tag — the parent link is now native):

```typescript
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      labels: ['ticket', ...input.labels],
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    })
    await this.linkTicketToEpic(String(data.number), input.epicId)
    return mapTicket(data, [])
  }
```

Replace `linkTicketToEpic` with the native sub-issue version:

```typescript
  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const epicNumber = parseInt(epicId, 10)
    const ticketNumber = parseInt(ticketId, 10)
    const existing = await this.octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: this.owner, repo: this.repo, issue_number: epicNumber },
    )
    const childNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number)
    if (childNumbers.includes(ticketNumber)) return
    const subIssueId = await this.resolveIssueId(ticketNumber)
    await this.octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
      sub_issue_id: subIssueId,
    })
  }
```

Add this private method **at the very end of the class** (after `addComment`), to satisfy `member-ordering` (private methods come after public methods):

```typescript
  private async resolveIssueId(issueNumber: number): Promise<number> {
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    })
    return data.id
  }
```

- [ ] **Step 6: Run the tracker tests and typecheck**

Run: `npm run typecheck && npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tasks/github-task-tracker/
git commit -m "refactor: link tickets to epics via native sub-issues"
```

---

## Task 4: Populate `blockedBy`/`blocking` in `getTicket`

**Files:**
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts` (`getTicket`)
- Modify: `src/tasks/github-task-tracker/github-task-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, add a new block:

```typescript
describe('GitHubTracker.getTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates blockedBy and blocking from the dependency endpoints', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockGet.mockResolvedValueOnce({
      data: {
        number: 7,
        state: 'open',
        labels: [{ name: 'ticket' }],
        title: 'Fix login',
        body: 'Details',
        updated_at: '2026-01-01T00:00:00Z',
        assignee: null,
      },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)
    mockRequest.mockImplementation((route: string) => {
      if (route.includes('/dependencies/blocked_by')) return Promise.resolve({ data: [{ number: 3 }] })
      if (route.includes('/dependencies/blocking')) return Promise.resolve({ data: [{ number: 9 }] })
      return Promise.resolve({ data: [] })
    })

    const ticket = await tracker.getTicket('7')

    expect(ticket.blockedBy).toEqual(['3'])
    expect(ticket.blocking).toEqual(['9'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts -t "populates blockedBy"`
Expected: FAIL — both arrays are `[]`.

- [ ] **Step 3: Update `getTicket` to fetch dependencies**

Replace `getTicket` in `src/tasks/github-task-tracker/github-task-tracker.ts` with:

```typescript
  async getTicket(id: string): Promise<Ticket> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse, blockedByResponse, blockingResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by', {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
      this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking', {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
    ])
    const blockedBy = IssueRefListSchema.parse(blockedByResponse.data).map((ref) => String(ref.number))
    const blocking = IssueRefListSchema.parse(blockingResponse.data).map((ref) => String(ref.number))
    return mapTicket(issueResponse.data, commentsResponse.data, blockedBy, blocking)
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run typecheck && npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/github-task-tracker/
git commit -m "feat: populate ticket blockedBy/blocking from native dependencies"
```

---

## Task 5: Add `blockTicket`/`unblockTicket` to the interface and GitHub backend

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts` (interface)
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Modify: `src/tasks/github-task-tracker/github-task-tracker.test.ts`
- Modify: `src/tasks/commands/ticket/command.test.ts`, `src/tasks/commands/epic/command.test.ts`, `src/tasks/commands/tdd/command.test.ts` (mock literals)

- [ ] **Step 1: Write the failing tracker tests**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, add:

```typescript
describe('GitHubTracker.blockTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds a native blocked_by dependency using the blocker global id', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockRequest.mockImplementation((route: string) => {
      if (route.startsWith('GET')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })
    // resolveIssueId(3) → global id 555
    mockGet.mockResolvedValueOnce({ data: { id: 555, number: 3 } } as never)

    await tracker.blockTicket('7', '3')

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
      { owner: 'acme', repo: 'proj', issue_number: 7, issue_id: 555 },
    )
  })

  it('does not re-add an existing blocker', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    mockRequest.mockResolvedValueOnce({ data: [{ number: 3 }] } as never)

    await tracker.blockTicket('7', '3')

    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects a self-block', async () => {
    const tracker = makeTracker()
    await expect(tracker.blockTicket('7', '7')).rejects.toThrow('cannot block itself')
  })
})

describe('GitHubTracker.unblockTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the blocked_by dependency using the blocker global id', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockGet.mockResolvedValueOnce({ data: { id: 555, number: 3 } } as never)
    mockRequest.mockResolvedValue({ data: {} } as never)

    await tracker.unblockTicket('7', '3')

    expect(mockRequest).toHaveBeenCalledWith(
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}',
      { owner: 'acme', repo: 'proj', issue_number: 7, issue_id: 555 },
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: FAIL — `blockTicket`/`unblockTicket` do not exist (also a typecheck error).

- [ ] **Step 3: Add the interface methods**

In `src/tasks/task-tracker/task-tracker.ts`, add to the `TaskTracker` interface, right after `linkTicketToEpic`:

```typescript
  blockTicket(ticketId: string, blockedById: string): Promise<void>
  unblockTicket(ticketId: string, blockedById: string): Promise<void>
```

- [ ] **Step 4: Implement them on `GitHubTaskTracker`**

In `src/tasks/github-task-tracker/github-task-tracker.ts`, add these public methods immediately after `linkTicketToEpic` (keep all public methods before the private `resolveIssueId`):

```typescript
  async blockTicket(ticketId: string, blockedById: string): Promise<void> {
    if (ticketId === blockedById) throw new Error('a ticket cannot block itself')
    const ticketNumber = parseInt(ticketId, 10)
    const blockerNumber = parseInt(blockedById, 10)
    const existing = await this.octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber },
    )
    const blockerNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number)
    if (blockerNumbers.includes(blockerNumber)) return
    const issueId = await this.resolveIssueId(blockerNumber)
    await this.octokit.request(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId },
    )
  }

  async unblockTicket(ticketId: string, blockedById: string): Promise<void> {
    const ticketNumber = parseInt(ticketId, 10)
    const issueId = await this.resolveIssueId(parseInt(blockedById, 10))
    await this.octokit.request(
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}',
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId },
    )
  }
```

- [ ] **Step 5: Add the new methods to every `TaskTracker` mock literal**

The widened interface breaks the three command-test mocks. In each of `src/tasks/commands/ticket/command.test.ts`, `src/tasks/commands/epic/command.test.ts`, and `src/tasks/commands/tdd/command.test.ts`, add these two lines to the object returned by `makeTracker`, right after `linkTicketToEpic: vi.fn(),`:

```typescript
  blockTicket: vi.fn(),
  unblockTicket: vi.fn(),
```

- [ ] **Step 6: Run typecheck and the full suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tasks/task-tracker/task-tracker.ts src/tasks/github-task-tracker/ src/tasks/commands/
git commit -m "feat: add blockTicket/unblockTicket to TaskTracker and GitHub backend"
```

---

## Task 6: `ticket block` / `ticket unblock` CLI subcommands

**Files:**
- Modify: `src/tasks/commands/ticket/command.ts`
- Modify: `src/tasks/commands/ticket/command.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/tasks/commands/ticket/command.test.ts`, add inside `describe('ticket command', ...)`:

```typescript
  it('calls blockTicket for "block"', async () => {
    const tracker = makeTracker()
    await run(tracker, ['block', '7', '--by', '3'])
    expect(tracker.blockTicket).toHaveBeenCalledWith('7', '3')
  })

  it('calls unblockTicket for "unblock"', async () => {
    const tracker = makeTracker()
    await run(tracker, ['unblock', '7', '--by', '3'])
    expect(tracker.unblockTicket).toHaveBeenCalledWith('7', '3')
  })

  it('rejects "block" when --by is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['block', '7'])).rejects.toThrow(CommanderError)
    expect(tracker.blockTicket).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tasks/commands/ticket/command.test.ts`
Expected: FAIL — unknown commands `block`/`unblock`.

- [ ] **Step 3: Add the subcommands**

In `src/tasks/commands/ticket/command.ts`, add before `return ticket`:

```typescript
  ticket
    .command('block')
    .exitOverride()
    .argument('<id>', 'ticket id to block')
    .requiredOption('--by <blockerId>', 'id of the ticket that must close first')
    .action(async (id: string, opts: { by: string }) => {
      await getTracker().blockTicket(id, opts.by)
    })

  ticket
    .command('unblock')
    .exitOverride()
    .argument('<id>', 'ticket id to unblock')
    .requiredOption('--by <blockerId>', 'id of the blocking ticket to remove')
    .action(async (id: string, opts: { by: string }) => {
      await getTracker().unblockTicket(id, opts.by)
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run src/tasks/commands/ticket/command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/commands/ticket/
git commit -m "feat: add ticket block/unblock CLI subcommands"
```

---

## Task 7: `epic plan` CLI subcommand

**Files:**
- Modify: `src/tasks/commands/epic/command.ts`
- Modify: `src/tasks/commands/epic/command.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/tasks/commands/epic/command.test.ts`, add a typed `Ticket` import and helper, then tests. At the top, change the type import to include `Ticket`:

```typescript
import type { TaskTracker, Epic, Ticket } from '../../task-tracker/task-tracker.js'
```

Add a ticket factory and an epic-with-children builder near the top of the file (after `mockEpic`):

```typescript
const child = (id: string, blockedBy: string[] = [], status = 'open'): Ticket => ({
  id,
  status,
  labels: ['ticket'],
  title: `Ticket ${id}`,
  body: 'B',
  comments: [],
  assignee: null,
  blockedBy,
  blocking: [],
  updatedAt: '2026-01-01T00:00:00Z',
})
```

Then add tests inside `describe('epic command', ...)`:

```typescript
  it('prints dependency-ordered waves for "plan"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getEpic).mockResolvedValue({
      ...mockEpic,
      childIssues: [child('1'), child('2', ['1'])],
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['plan', '42'])

    expect(tracker.getEpic).toHaveBeenCalledWith('42')
    const written = vi.mocked(output).mock.calls[0]?.[0]
    expect(written).toContain('"waves"')
    const parsed: { waves: { id: string }[][]; cycles: string[] } = JSON.parse(String(written))
    expect(parsed.waves.map((w) => w.map((t) => t.id))).toEqual([['1'], ['2']])
    expect(parsed.cycles).toEqual([])
    output.mockRestore()
  })

  it('exits non-zero when a cycle is detected for "plan"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getEpic).mockResolvedValue({
      ...mockEpic,
      childIssues: [child('1', ['2']), child('2', ['1'])],
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(run(tracker, ['plan', '42'])).rejects.toThrow('dependency cycle')

    expect(output).toHaveBeenCalled() // JSON still printed before throwing
    output.mockRestore()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tasks/commands/epic/command.test.ts`
Expected: FAIL — unknown command `plan`.

- [ ] **Step 3: Add the subcommand**

In `src/tasks/commands/epic/command.ts`, add the import at the top:

```typescript
import { planDependencies } from '../../dependency-planner/dependency-planner.js'
```

Add before `return epic`:

```typescript
  epic
    .command('plan')
    .exitOverride()
    .argument('<id>', 'epic id')
    .action(async (id: string) => {
      const epicData = await getTracker().getEpic(id)
      const plan = planDependencies(
        epicData.childIssues.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          blockedBy: ticket.blockedBy,
        })),
      )
      process.stdout.write(JSON.stringify(plan) + '\n')
      if (plan.cycles.length > 0) {
        throw new Error(`dependency cycle detected among tickets: ${plan.cycles.join(', ')}`)
      }
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run src/tasks/commands/epic/command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/commands/epic/
git commit -m "feat: add epic plan CLI subcommand"
```

---

## Task 8: Rebuild the binary and verify everything

**Files:**
- Modify: `bin/flight-rules`

- [ ] **Step 1: Run the full verification suite**

Run: `npm run typecheck && npx eslint src/ && npx vitest run`
Expected: PASS, zero lint errors.

- [ ] **Step 2: Rebuild the committed bundle**

Run: `npm run build`
Expected: writes `bin/flight-rules`, exit 0.

- [ ] **Step 3: Confirm the binary is in sync (CI's freshness check)**

Run: `git diff --stat bin/`
Expected: shows `bin/flight-rules` changed (or no diff if already current).

- [ ] **Step 4: Smoke-test the new commands' help output**

Run: `node bin/flight-rules epic plan --help && node bin/flight-rules ticket block --help`
Expected: usage text for each, exit 0.

- [ ] **Step 5: Commit**

```bash
git add bin/flight-rules
git commit -m "build: rebuild binary with native deps and sub-issues"
```

---

## Self-Review Notes

- **Spec coverage:** schema fields (Task 1), planner (Task 2), native sub-issue hierarchy (Task 3), `getTicket` deps (Task 4), interface + backend `block`/`unblock` (Task 5), CLI `block`/`unblock` (Task 6), CLI `epic plan` + non-zero-exit-on-cycle (Task 7), build freshness (Task 8). The TDD↔epic tag is intentionally left untouched per the spec.
- **Type consistency:** `planDependencies`/`PlannerTicket`/`DependencyPlan` (`cycles: string[]`) are used identically in Tasks 2 and 7. `blockTicket(ticketId, blockedById)` / `unblockTicket(ticketId, blockedById)` signatures match across interface (Task 5), backend (Task 5), and CLI (Task 6). `mapTicket(issue, comments, blockedBy?, blocking?)` is consistent across Tasks 1, 3, 4.
- **Lint:** no `any`, no `!`, no `as` in `src/**` non-test files. `octokit.request()` on the newer routes returns `OctokitResponse<unknown>`, so its `.data` is parsed with `IssueRefListSchema` (Zod) rather than asserted — runtime-safe and assertion-free. `resolveIssueId` uses the typed `octokit.rest.issues.get`, so `data.id` needs no parsing. Test files use `as never` (permitted by the test-file override).
