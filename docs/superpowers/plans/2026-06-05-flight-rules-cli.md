# flight-rules CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `bin/flight-rules` CLI binary that creates and retrieves epics, tickets, and TDDs against GitHub's API.

**Architecture:** A TypeScript CLI bundled by esbuild, routing three subcommands (`epic`, `ticket`, `tdd`) to a `TaskTracker` interface. The GitHub implementation uses `@octokit/rest` for Issues and `@octokit/graphql` for Discussions. Per-project config is read from `.claude/flight-rules.local.md` YAML frontmatter. All output is JSON; all input is flags; no interactive prompts.

**Tech Stack:** TypeScript 6, esbuild, Zod, @octokit/rest, @octokit/graphql, gray-matter, vitest

---

## File Map

| File | Responsibility |
|---|---|
| `src/task-tracker/types.ts` | Zod schemas, inferred types, TaskTracker interface |
| `src/config.ts` | Read + validate `.claude/flight-rules.local.md` |
| `src/task-tracker/github/github-tracker.ts` | GitHub implementation of TaskTracker |
| `src/commands/epic.ts` | Parse argv for `epic create` / `epic get`, call tracker |
| `src/commands/ticket.ts` | Parse argv for `ticket create` / `ticket get`, call tracker |
| `src/commands/tdd.ts` | Parse argv for `tdd create` / `tdd get`, call tracker |
| `src/index.ts` | CLI entrypoint: route to command handlers |
| `vitest.config.ts` | Vitest configuration |
| `.github/workflows/ci.yml` | Typecheck, lint, build freshness, test |

---

### Task 1: Dependencies, build script, test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install zod @octokit/rest @octokit/graphql gray-matter
npm install --save-dev vitest
```

- [ ] **Step 2: Update package.json scripts**

The current build script outputs `bin/index.js` — change it to `bin/flight-rules`. Replace the `scripts` block:

```json
"scripts": {
  "build": "esbuild src/index.ts --bundle --platform=node --outfile=bin/flight-rules && chmod +x bin/flight-rules",
  "fmt": "sort-package-json && oxfmt",
  "fmt:check": "sort-package-json --check && oxfmt --check",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Run typecheck to confirm setup is clean**

```bash
npm run typecheck
```

Expected: no errors (src/index.ts is empty — that's fine for now)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "feat: add runtime deps and configure vitest"
```

---

### Task 2: Zod schemas and TaskTracker interface

**Files:**
- Create: `src/task-tracker/types.ts`
- Create: `src/task-tracker/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/task-tracker/types.test.ts
import { describe, it, expect } from 'vitest'
import {
  CommentSchema,
  TicketSchema,
  EpicSchema,
  CreateEpicInputSchema,
  CreateTicketInputSchema,
  CreateTechnicalDesignInputSchema,
} from './types.js'

describe('CommentSchema', () => {
  it('parses a valid comment', () => {
    const result = CommentSchema.parse({
      id: 'c1',
      body: 'hello',
      author: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.id).toBe('c1')
  })
})

describe('TicketSchema', () => {
  it('parses a valid ticket', () => {
    const result = TicketSchema.parse({
      id: '1',
      status: 'open',
      labels: ['bug'],
      title: 'Fix login',
      body: 'Details',
      comments: [],
      assignee: null,
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.id).toBe('1')
    expect(result.assignee).toBeNull()
  })
})

describe('EpicSchema', () => {
  it('parses a valid epic with no TDD', () => {
    const result = EpicSchema.parse({
      id: '10',
      status: 'open',
      labels: [],
      title: 'Auth system',
      body: 'Big project',
      childIssues: [],
      comments: [],
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.tdd).toBeUndefined()
  })
})

describe('CreateEpicInputSchema', () => {
  it('defaults labels to empty array', () => {
    const result = CreateEpicInputSchema.parse({ title: 'T', body: 'B' })
    expect(result.labels).toEqual([])
  })
})

describe('CreateTicketInputSchema', () => {
  it('defaults labels to empty array', () => {
    const result = CreateTicketInputSchema.parse({ title: 'T', body: 'B', epicId: '1' })
    expect(result.labels).toEqual([])
  })
})

describe('CreateTechnicalDesignInputSchema', () => {
  it('parses all fields', () => {
    const result = CreateTechnicalDesignInputSchema.parse({ title: 'T', body: 'B', epicId: '1' })
    expect(result.epicId).toBe('1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/task-tracker/types.test.ts
```

Expected: FAIL — cannot find module `./types.js`

- [ ] **Step 3: Create `src/task-tracker/types.ts`**

```typescript
import { z } from 'zod'

export const CommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const TechnicalDesignSchema = z.object({
  id: z.string(),
  epicId: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
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
  updatedAt: z.string(),
})

export const CreateEpicInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([]),
})

export const CreateTicketInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
})

export const CreateTechnicalDesignInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
})

export type Comment = z.infer<typeof CommentSchema>
export type TechnicalDesign = z.infer<typeof TechnicalDesignSchema>
export type Ticket = z.infer<typeof TicketSchema>
export type Epic = z.infer<typeof EpicSchema>
export type CreateEpicInput = z.infer<typeof CreateEpicInputSchema>
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>
export type CreateTechnicalDesignInput = z.infer<typeof CreateTechnicalDesignInputSchema>

export interface TaskTracker {
  createEpic(input: CreateEpicInput): Promise<Epic>
  getEpic(id: string): Promise<Epic>
  createTicket(input: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>
  getTechnicalDesign(id: string): Promise<TechnicalDesign>
  addComment(entityId: string, body: string): Promise<Comment>
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/task-tracker/types.test.ts
```

Expected: PASS — all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/task-tracker/types.ts src/task-tracker/types.test.ts
git commit -m "feat: add Zod schemas and TaskTracker interface"
```

---

### Task 3: Config reader

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/config.test.ts
import { describe, it, expect } from 'vitest'
import { readConfig } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const setupFixture = (content: string): string => {
  const dir = join(tmpdir(), `flight-rules-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, 'flight-rules.local.md')
  writeFileSync(filePath, content)
  return filePath
}

describe('readConfig', () => {
  it('parses a valid github config', () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
defaultLabels:
  - engineering
---
`)
    const config = readConfig(filePath)
    expect(config.tracker).toBe('github')
    expect(config.repo).toBe('acme/my-project')
    expect(config.defaultLabels).toEqual(['engineering'])
  })

  it('defaults defaultLabels to empty array when omitted', () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
---
`)
    const config = readConfig(filePath)
    expect(config.defaultLabels).toEqual([])
  })

  it('throws ZodError for invalid tracker value', () => {
    const filePath = setupFixture(`---
tracker: notion
repo: acme/my-project
---
`)
    expect(() => readConfig(filePath)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/config.test.ts
```

Expected: FAIL — cannot find module `./config.js`

- [ ] **Step 3: Create `src/config.ts`**

```typescript
import { readFileSync } from 'node:fs'
import matter from 'gray-matter'
import { z } from 'zod'

const ConfigSchema = z.object({
  tracker: z.enum(['github', 'jira']),
  repo: z.string(),
  defaultLabels: z.array(z.string()).default([]),
})

export type Config = z.infer<typeof ConfigSchema>

export function readConfig(configPath: string): Config {
  const contents = readFileSync(configPath, 'utf-8')
  const { data } = matter(contents)
  return ConfigSchema.parse(data)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/config.test.ts
```

Expected: PASS — all 3 tests pass

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config reader"
```

---

### Task 4: GitHub tracker

**Context:** The tracker embeds metadata in GitHub Issue bodies using hidden HTML comments:
- `<!-- fr-tickets: [1,2,3] -->` on the epic — tracks child ticket numbers
- `<!-- fr-tdd: 5 -->` on the epic — tracks the TDD discussion number
- `<!-- fr-epic: 42 -->` on tickets and discussions — back-reference to the epic

Epics and Tickets are GitHub Issues. TDDs are GitHub Discussions (GraphQL only). The "TDDs" discussion category must exist in the repo before `createTechnicalDesign` is called.

**Files:**
- Create: `src/task-tracker/github/github-tracker.ts`
- Create: `src/task-tracker/github/github-tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/task-tracker/github/github-tracker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubTracker } from './github-tracker.js'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      issues: {
        create: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        createComment: vi.fn(),
        listComments: vi.fn(),
      },
    },
  })),
}))

vi.mock('@octokit/graphql', () => ({
  graphql: Object.assign(vi.fn(), {
    defaults: vi.fn().mockReturnValue(vi.fn()),
  }),
}))

const makeTracker = () => new GitHubTracker({ token: 'tok', owner: 'acme', repo: 'proj' })

describe('GitHubTracker.createEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a GitHub issue and returns an Epic', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create)
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        state: 'open',
        labels: [{ name: 'epic' }],
        title: 'My Epic',
        body: 'Epic body',
        updated_at: '2026-01-01T00:00:00Z',
      },
    } as never)

    const epic = await tracker.createEpic({ title: 'My Epic', body: 'Epic body', labels: [] })

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      title: 'My Epic',
      body: 'Epic body',
      labels: ['epic'],
    })
    expect(epic.id).toBe('42')
    expect(epic.title).toBe('My Epic')
    expect(epic.childIssues).toEqual([])
    expect(epic.tdd).toBeUndefined()
  })
})

describe('GitHubTracker.getEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an epic with no child issues when body has no fr-tickets comment', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)

    mockGet.mockResolvedValueOnce({
      data: {
        number: 42,
        state: 'open',
        labels: [{ name: 'epic' }],
        title: 'My Epic',
        body: 'Epic body',
        updated_at: '2026-01-01T00:00:00Z',
        assignee: null,
      },
    } as never)

    mockListComments.mockResolvedValueOnce({ data: [] } as never)

    const epic = await tracker.getEpic('42')
    expect(epic.id).toBe('42')
    expect(epic.childIssues).toEqual([])
    expect(epic.tdd).toBeUndefined()
  })
})

describe('GitHubTracker.linkTicketToEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends the ticket number to the epic body', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({
      data: { number: 10, body: 'Epic body' },
    } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 10,
        body: expect.stringContaining('<!-- fr-tickets: [7] -->') as string,
      }),
    )
  })

  it('does not duplicate a ticket already in the list', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({
      data: { number: 10, body: 'Epic body\n<!-- fr-tickets: [7] -->' },
    } as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/task-tracker/github/github-tracker.test.ts
```

Expected: FAIL — cannot find module `./github-tracker.js`

- [ ] **Step 3: Create `src/task-tracker/github/github-tracker.ts`**

```typescript
import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
  CreateTechnicalDesignInput,
  Epic,
  TaskTracker,
  TechnicalDesign,
  Ticket,
} from '../types.js'

interface GitHubTrackerConfig {
  token: string
  owner: string
  repo: string
}

type OctokitIssueData = Awaited<ReturnType<Octokit['rest']['issues']['get']>>['data']
type OctokitCommentData = Awaited<ReturnType<Octokit['rest']['issues']['listComments']>>['data'][number]
type OctokitLabelData = OctokitIssueData['labels'][number]

const frTicketsRegex = /<!-- fr-tickets: (\[.*?\]) -->/s
const frTddRegex = /<!-- fr-tdd: (\d+) -->/
const frEpicRegex = /<!-- fr-epic: (\d+) -->/

function parseTicketIds(body: string): number[] {
  const match = frTicketsRegex.exec(body)
  if (match === null || match[1] === undefined) return []
  try {
    const parsed: unknown = JSON.parse(match[1])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is number => typeof x === 'number')
  } catch {
    return []
  }
}

function parseTddId(body: string): number | null {
  const match = frTddRegex.exec(body)
  if (match === null || match[1] === undefined) return null
  return parseInt(match[1], 10)
}

function upsertFrTickets(body: string, ticketIds: number[]): string {
  const tag = `<!-- fr-tickets: ${JSON.stringify(ticketIds)} -->`
  if (frTicketsRegex.test(body)) return body.replace(frTicketsRegex, tag)
  return `${body}\n${tag}`
}

function upsertFrTdd(body: string, tddId: number): string {
  const tag = `<!-- fr-tdd: ${tddId} -->`
  if (frTddRegex.test(body)) return body.replace(frTddRegex, tag)
  return `${body}\n${tag}`
}

function labelName(label: OctokitLabelData): string {
  if (typeof label === 'string') return label
  return label.name ?? ''
}

function mapComment(c: OctokitCommentData): Comment {
  return {
    id: String(c.id),
    body: c.body ?? '',
    author: c.user?.login ?? '',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

function mapTicket(issue: OctokitIssueData, comments: OctokitCommentData[]): Ticket {
  return {
    id: String(issue.number),
    status: issue.state,
    labels: issue.labels.map(labelName).filter(Boolean),
    title: issue.title,
    body: issue.body ?? '',
    comments: comments.map(mapComment),
    assignee: issue.assignee?.login ?? null,
    updatedAt: issue.updated_at,
  }
}

export class GitHubTracker implements TaskTracker {
  private octokit: Octokit
  private gql: ReturnType<typeof graphql.defaults>
  private owner: string
  private repo: string

  constructor(config: GitHubTrackerConfig) {
    this.octokit = new Octokit({ auth: config.token })
    this.gql = graphql.defaults({ headers: { authorization: `token ${config.token}` } })
    this.owner = config.owner
    this.repo = config.repo
  }

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
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
      updatedAt: data.updated_at,
    }
  }

  async getEpic(id: string): Promise<Epic> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    ])
    const issue = issueResponse.data
    const body = issue.body ?? ''

    const ticketIds = parseTicketIds(body)
    const childIssues = await Promise.all(ticketIds.map((n) => this.getTicket(String(n))))

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

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const body = `${input.body}\n<!-- fr-epic: ${input.epicId} -->`
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ['ticket', ...input.labels],
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    })
    await this.linkTicketToEpic(String(data.number), input.epicId)
    return mapTicket(data, [])
  }

  async getTicket(id: string): Promise<Ticket> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    ])
    return mapTicket(issueResponse.data, commentsResponse.data)
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const epicNumber = parseInt(epicId, 10)
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
    })
    const currentBody = data.body ?? ''
    const existingIds = parseTicketIds(currentBody)
    const ticketNumber = parseInt(ticketId, 10)
    if (existingIds.includes(ticketNumber)) return
    const newBody = upsertFrTickets(currentBody, [...existingIds, ticketNumber])
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
      body: newBody,
    })
  }

  async createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign> {
    const repoData = await this.gql<{
      repository: { id: string; discussionCategory: { id: string } | null }
    }>(
      `query GetRepoAndCategory($owner: String!, $repo: String!, $slug: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategory(slug: $slug) { id }
        }
      }`,
      { owner: this.owner, repo: this.repo, slug: 'tdds' },
    )

    const categoryId = repoData.repository.discussionCategory?.id
    if (categoryId === undefined) {
      throw new Error('No "TDDs" discussion category found. Create it in the repo\'s GitHub Discussions settings.')
    }

    const body = `${input.body}\n<!-- fr-epic: ${input.epicId} -->`
    const createData = await this.gql<{
      createDiscussion: {
        discussion: { number: number; body: string; updatedAt: string }
      }
    }>(
      `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { number body updatedAt }
        }
      }`,
      { repositoryId: repoData.repository.id, categoryId, title: input.title, body },
    )

    const discussion = createData.createDiscussion.discussion

    const epicResponse = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(input.epicId, 10),
    })
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(input.epicId, 10),
      body: upsertFrTdd(epicResponse.data.body ?? '', discussion.number),
    })

    return {
      id: String(discussion.number),
      epicId: input.epicId,
      body: discussion.body,
      comments: [],
      updatedAt: discussion.updatedAt,
    }
  }

  async getTechnicalDesign(id: string): Promise<TechnicalDesign> {
    const data = await this.gql<{
      repository: {
        discussion: {
          number: number
          body: string
          updatedAt: string
          comments: {
            nodes: Array<{
              id: string
              body: string
              author: { login: string }
              createdAt: string
              updatedAt: string
            }>
          }
        }
      }
    }>(
      `query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            number body updatedAt
            comments(first: 100) {
              nodes { id body author { login } createdAt updatedAt }
            }
          }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(id, 10) },
    )

    const discussion = data.repository.discussion
    const epicMatch = frEpicRegex.exec(discussion.body)
    const epicId = epicMatch !== null && epicMatch[1] !== undefined ? epicMatch[1] : ''

    return {
      id,
      epicId,
      body: discussion.body,
      comments: discussion.comments.nodes.map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author.login,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      updatedAt: discussion.updatedAt,
    }
  }

  async addComment(entityId: string, body: string): Promise<Comment> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(entityId, 10),
      body,
    })
    return {
      id: String(data.id),
      body: data.body ?? '',
      author: data.user?.login ?? '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/task-tracker/github/github-tracker.test.ts
```

Expected: PASS — all 4 tests pass

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/task-tracker/github/github-tracker.ts src/task-tracker/github/github-tracker.test.ts
git commit -m "feat: add GitHub TaskTracker implementation"
```

---

### Task 5: Epic command

**Files:**
- Create: `src/commands/epic.ts`
- Create: `src/commands/epic.test.ts`

The command handler receives the `process.argv` slice after `epic`, parses flags, calls the tracker, and prints JSON to stdout. `parseFlags` is a small local helper — not shared — because each command file is self-contained.

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/epic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, Epic } from '../task-tracker/types.js'
import { runEpicCommand } from './epic.js'

const mockEpic: Epic = {
  id: '42',
  status: 'open',
  labels: ['epic'],
  title: 'My Epic',
  body: 'Epic body',
  childIssues: [],
  comments: [],
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn().mockResolvedValue(mockEpic),
  getEpic: vi.fn().mockResolvedValue(mockEpic),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  createTechnicalDesign: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
})

describe('runEpicCommand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createEpic and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runEpicCommand(['create', '--title', 'My Epic', '--body', 'Epic body'], tracker)

    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'My Epic', body: 'Epic body', labels: [] })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('splits --labels on comma', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runEpicCommand(['create', '--title', 'T', '--body', 'B', '--labels', 'bug,feature'], tracker)

    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'T', body: 'B', labels: ['bug', 'feature'] })
    output.mockRestore()
  })

  it('calls getEpic and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runEpicCommand(['get', '42'], tracker)

    expect(tracker.getEpic).toHaveBeenCalledWith('42')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('exits with code 1 for unknown subcommand', async () => {
    const tracker = makeTracker()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

    await expect(runEpicCommand(['unknown'], tracker)).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/commands/epic.test.ts
```

Expected: FAIL — cannot find module `./epic.js`

- [ ] **Step 3: Create `src/commands/epic.ts`**

```typescript
import type { TaskTracker } from '../task-tracker/types.js'

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg !== undefined && arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        flags[key] = value
        i++
      }
    }
  }
  return flags
}

export async function runEpicCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const epic = await tracker.createEpic({
      title: flags['title'] ?? '',
      body: flags['body'] ?? '',
      labels: flags['labels'] !== undefined ? flags['labels'].split(',') : [],
    })
    process.stdout.write(JSON.stringify(epic) + '\n')
    return
  }

  if (subcommand === 'get') {
    const epic = await tracker.getEpic(args[1] ?? '')
    process.stdout.write(JSON.stringify(epic) + '\n')
    return
  }

  process.stderr.write(`Unknown epic subcommand: ${subcommand ?? '(none)'}\n`)
  process.exit(1)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/commands/epic.test.ts
```

Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/epic.ts src/commands/epic.test.ts
git commit -m "feat: add epic command handler"
```

---

### Task 6: Ticket command

**Files:**
- Create: `src/commands/ticket.ts`
- Create: `src/commands/ticket.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/ticket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, Ticket } from '../task-tracker/types.js'
import { runTicketCommand } from './ticket.js'

const mockTicket: Ticket = {
  id: '7',
  status: 'open',
  labels: ['ticket'],
  title: 'Fix login',
  body: 'Details',
  comments: [],
  assignee: null,
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn().mockResolvedValue(mockTicket),
  getTicket: vi.fn().mockResolvedValue(mockTicket),
  linkTicketToEpic: vi.fn(),
  createTechnicalDesign: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
})

describe('runTicketCommand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTicket and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTicketCommand(
      ['create', '--title', 'Fix login', '--body', 'Details', '--epic-id', '42'],
      tracker,
    )

    expect(tracker.createTicket).toHaveBeenCalledWith({
      title: 'Fix login',
      body: 'Details',
      epicId: '42',
      labels: [],
    })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTicket) + '\n')
    output.mockRestore()
  })

  it('passes assignee when provided', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTicketCommand(
      ['create', '--title', 'T', '--body', 'B', '--epic-id', '1', '--assignee', 'alice'],
      tracker,
    )

    expect(tracker.createTicket).toHaveBeenCalledWith({
      title: 'T',
      body: 'B',
      epicId: '1',
      labels: [],
      assignee: 'alice',
    })
    output.mockRestore()
  })

  it('calls getTicket and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTicketCommand(['get', '7'], tracker)

    expect(tracker.getTicket).toHaveBeenCalledWith('7')
    output.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/commands/ticket.test.ts
```

Expected: FAIL — cannot find module `./ticket.js`

- [ ] **Step 3: Create `src/commands/ticket.ts`**

```typescript
import type { CreateTicketInput, TaskTracker } from '../task-tracker/types.js'

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg !== undefined && arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        flags[key] = value
        i++
      }
    }
  }
  return flags
}

export async function runTicketCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const input: CreateTicketInput = {
      title: flags['title'] ?? '',
      body: flags['body'] ?? '',
      epicId: flags['epic-id'] ?? '',
      labels: flags['labels'] !== undefined ? flags['labels'].split(',') : [],
      ...(flags['assignee'] !== undefined ? { assignee: flags['assignee'] } : {}),
    }
    const ticket = await tracker.createTicket(input)
    process.stdout.write(JSON.stringify(ticket) + '\n')
    return
  }

  if (subcommand === 'get') {
    const ticket = await tracker.getTicket(args[1] ?? '')
    process.stdout.write(JSON.stringify(ticket) + '\n')
    return
  }

  process.stderr.write(`Unknown ticket subcommand: ${subcommand ?? '(none)'}\n`)
  process.exit(1)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/commands/ticket.test.ts
```

Expected: PASS — all 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/ticket.ts src/commands/ticket.test.ts
git commit -m "feat: add ticket command handler"
```

---

### Task 7: TDD command

**Files:**
- Create: `src/commands/tdd.ts`
- Create: `src/commands/tdd.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/tdd.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, TechnicalDesign } from '../task-tracker/types.js'
import { runTddCommand } from './tdd.js'

const mockTdd: TechnicalDesign = {
  id: '3',
  epicId: '42',
  body: 'Design doc body',
  comments: [],
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  createTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  getTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  addComment: vi.fn(),
})

describe('runTddCommand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTechnicalDesign and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTddCommand(
      ['create', '--title', 'Auth TDD', '--body', 'Design doc body', '--epic-id', '42'],
      tracker,
    )

    expect(tracker.createTechnicalDesign).toHaveBeenCalledWith({
      title: 'Auth TDD',
      body: 'Design doc body',
      epicId: '42',
    })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTdd) + '\n')
    output.mockRestore()
  })

  it('calls getTechnicalDesign and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTddCommand(['get', '3'], tracker)

    expect(tracker.getTechnicalDesign).toHaveBeenCalledWith('3')
    output.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/commands/tdd.test.ts
```

Expected: FAIL — cannot find module `./tdd.js`

- [ ] **Step 3: Create `src/commands/tdd.ts`**

```typescript
import type { TaskTracker } from '../task-tracker/types.js'

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg !== undefined && arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        flags[key] = value
        i++
      }
    }
  }
  return flags
}

export async function runTddCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const tdd = await tracker.createTechnicalDesign({
      title: flags['title'] ?? '',
      body: flags['body'] ?? '',
      epicId: flags['epic-id'] ?? '',
    })
    process.stdout.write(JSON.stringify(tdd) + '\n')
    return
  }

  if (subcommand === 'get') {
    const tdd = await tracker.getTechnicalDesign(args[1] ?? '')
    process.stdout.write(JSON.stringify(tdd) + '\n')
    return
  }

  process.stderr.write(`Unknown tdd subcommand: ${subcommand ?? '(none)'}\n`)
  process.exit(1)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/commands/tdd.test.ts
```

Expected: PASS — all 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/tdd.ts src/commands/tdd.test.ts
git commit -m "feat: add tdd command handler"
```

---

### Task 8: CLI entrypoint

**Files:**
- Modify: `src/index.ts`
- Create: `src/index.test.ts`

Reads config from `.claude/flight-rules.local.md` (overridable via `FLIGHT_RULES_CONFIG` env var for testing), instantiates the tracker, routes to command handlers.

- [ ] **Step 1: Write the failing test**

```typescript
// src/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({
          data: {
            number: 1,
            state: 'open',
            labels: [],
            title: 'T',
            body: 'B',
            updated_at: '2026-01-01T00:00:00Z',
            assignee: null,
          },
        }),
      },
    },
  })),
}))

vi.mock('@octokit/graphql', () => ({
  graphql: Object.assign(vi.fn(), { defaults: vi.fn().mockReturnValue(vi.fn()) }),
}))

const writeConfig = (dir: string, content: string): string => {
  const claudeDir = join(dir, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  const filePath = join(claudeDir, 'flight-rules.local.md')
  writeFileSync(filePath, content)
  return filePath
}

describe('run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('routes "epic create" through the GitHubTracker and prints JSON', async () => {
    const dir = join(tmpdir(), `fr-index-test-${Date.now()}`)
    const configPath = writeConfig(dir, `---\ntracker: github\nrepo: acme/proj\n---\n`)
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    vi.stubEnv('FLIGHT_RULES_CONFIG', configPath)

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('./index.js')
    await run(['epic', 'create', '--title', 'T', '--body', 'B'])

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"id":"1"') as string)
    output.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/index.test.ts
```

Expected: FAIL — `run` is not exported

- [ ] **Step 3: Write `src/index.ts`**

```typescript
#!/usr/bin/env node
import { join } from 'node:path'
import { readConfig } from './config.js'
import { GitHubTracker } from './task-tracker/github/github-tracker.js'
import { runEpicCommand } from './commands/epic.js'
import { runTicketCommand } from './commands/ticket.js'
import { runTddCommand } from './commands/tdd.js'
import type { TaskTracker } from './task-tracker/types.js'

function buildTracker(): TaskTracker {
  const configPath =
    process.env['FLIGHT_RULES_CONFIG'] ??
    join(process.cwd(), '.claude', 'flight-rules.local.md')
  const config = readConfig(configPath)

  if (config.tracker === 'github') {
    const token = process.env['GITHUB_TOKEN']
    if (token === undefined) throw new Error('GITHUB_TOKEN environment variable is required')
    const parts = config.repo.split('/')
    const owner = parts[0]
    const repo = parts[1]
    if (owner === undefined || repo === undefined) {
      throw new Error(`Invalid repo format "${config.repo}" — expected "owner/repo"`)
    }
    return new GitHubTracker({ token, owner, repo })
  }

  throw new Error(`Unsupported tracker: ${config.tracker}`)
}

export async function run(args: string[]): Promise<void> {
  const command = args[0]
  const rest = args.slice(1)
  const tracker = buildTracker()

  if (command === 'epic') { await runEpicCommand(rest, tracker); return }
  if (command === 'ticket') { await runTicketCommand(rest, tracker); return }
  if (command === 'tdd') { await runTddCommand(rest, tracker); return }

  process.stderr.write(
    `Unknown command: ${command ?? '(none)'}\nUsage: flight-rules <epic|ticket|tdd> <subcommand> [flags]\n`,
  )
  process.exit(1)
}

const isMain =
  process.argv[1]?.endsWith('flight-rules') === true ||
  process.argv[1]?.endsWith('index.js') === true

if (isMain) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: add CLI entrypoint"
```

---

### Task 9: Build and smoke test

**Files:** none new — verifying the binary builds and runs correctly.

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: `bin/flight-rules` created, no errors

- [ ] **Step 2: Smoke test — unknown command prints usage**

```bash
./bin/flight-rules unknown-command 2>&1 || true
```

Expected output contains: `Unknown command: unknown-command`

- [ ] **Step 3: Smoke test — missing config prints a clear error**

```bash
./bin/flight-rules epic get 1 2>&1 || true
```

Expected: exits non-zero, prints something about the config file not being found (ENOENT)

- [ ] **Step 4: Commit the binary**

```bash
git add bin/flight-rules
git commit -m "feat: add compiled CLI binary"
```

---

### Task 10: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Check .nvmrc**

```bash
cat .nvmrc
```

If it's empty or missing a version number, set it:

```bash
echo "22" > .nvmrc
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npx eslint src/

      - name: Test
        run: npm test

      - name: Build freshness
        run: |
          npm run build
          git diff --exit-code bin/
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .nvmrc
git commit -m "feat: add CI workflow"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `flight-rules epic create/get` | 5, 8 |
| `flight-rules ticket create/get` | 6, 8 |
| `flight-rules tdd create/get` | 7, 8 |
| All Zod schemas from spec | 2 |
| `TaskTracker` interface | 2 |
| GitHub backend (Issues + Discussions) | 4 |
| Config from `.claude/flight-rules.local.md` | 3 |
| `GITHUB_TOKEN` env var | 8 |
| Binary at `bin/flight-rules` (not `bin/index.js`) | 1 |
| Committed binary | 9 |
| CI: typecheck + lint + test + build freshness | 10 |
| JSON-only output, no interactive prompts | 5, 6, 7 |
| `fr-tickets` / `fr-tdd` metadata links | 4 |

**Deferred per spec (not in this plan):**
- Jira backend — interface supports it; implementation is a future plan
- `code-reviewer-formatter` — part of the plugin files plan (Plan 2)
- Skills and agents — Plan 2

**Placeholder scan:** None found.

**Type consistency:**
- `frTicketsRegex`, `frTddRegex`, `frEpicRegex` — module-level `const`, must be `camelCase` per ESLint config (the `UPPER_CASE` rule only applies to variables with `NULL_`/`UNKNOWN_` prefix). ✓
- `OctokitIssueData`, `OctokitCommentData`, `OctokitLabelData` — type aliases, `PascalCase`. ✓
- `mapComment`, `mapTicket`, `parseFlags`, `parseTicketIds`, `parseTddId`, `upsertFrTickets`, `upsertFrTdd`, `labelName` — functions, `camelCase`. ✓
- `mockEpic`, `mockTicket`, `mockTdd` in tests — `camelCase`. ✓
- `GitHubTrackerConfig` interface — `PascalCase`. ✓
- `exactOptionalPropertyTypes: true` — the `assignee` spread pattern `...(x !== undefined ? { assignee: x } : {})` is used correctly in ticket.ts and github-tracker.ts. ✓
