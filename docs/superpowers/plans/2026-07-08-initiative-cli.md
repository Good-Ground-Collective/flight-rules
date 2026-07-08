# Initiative-level CLI (GitHub Milestones) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an initiative rung to the task tracker — `createInitiative` / `getInitiative` / `linkEpicToInitiative` on `TaskTracker`, backed by GitHub Milestones, plus `flight-rules initiative` CLI commands and an `epic link-initiative` subcommand.

**Architecture:** A GitHub Milestone models an initiative (an issue links up to exactly one milestone — a clean many-to-one). `createInitiative` creates a milestone; `linkEpicToInitiative` sets an epic issue's `milestone`; `getInitiative` reads the milestone and lists its `epic`-labelled issues. Mirrors the existing sub-issue/dependency pattern: thin Zod schemas + interface methods + `GitHubTaskTracker` impl (via `octokit.rest.issues.*`) + colocated commander command factories.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod, commander (`.exitOverride()`), `@octokit/rest`, vitest.

## Global Constraints

- Import specifiers use `.js` extensions even for `.ts` files (ESM/NodeNext).
- All octokit access goes through `this.octokit.rest.issues.*`; tests mock `@octokit/rest` (see the `vi.mock` block at the top of `github-task-tracker.test.ts`).
- Every command uses `.exitOverride()` on each subcommand, matching the existing commands.
- The CLI resolves config relative to CWD — always run `flight-rules`/`npm` from the repo root.
- CI runs `npm run typecheck`, `npx eslint src/`, `npm run build`, `npm test`. The committed bundle `bin/flight-rules` must be rebuilt with `npm run build` and committed before merge (folded into the final task).
- Adding a method to the `TaskTracker` interface breaks every full mock until that method is added. The four full-tracker mocks are: `src/tasks/commands/epic/command.test.ts`, `src/tasks/commands/ticket/command.test.ts`, `src/tasks/commands/users/command.test.ts`, `src/tasks/commands/tdd/command.test.ts`. `src/cli.test.ts` mocks octokit directly (not a `TaskTracker` mock) and needs no change for interface additions.

---

### Task 1: Initiative schemas & types

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts` (after `CreateTechnicalDesignInputSchema`, before the `export type` block around line 79-87)
- Test: `src/tasks/task-tracker/task-tracker.test.ts`

**Interfaces:**
- Produces:
  - `InitiativeSchema` — `{ id: string; title: string; body: string; epics: { id: string; title: string }[] }`
  - `CreateInitiativeInputSchema` — `{ title: string; body: string }`
  - `Initiative`, `CreateInitiativeInput` types (`z.infer<...>`)

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/task-tracker/task-tracker.test.ts`. Import the new schemas by extending the existing import from `./task-tracker.js` at the top of the file to include `InitiativeSchema` and `CreateInitiativeInputSchema`, then add:

```ts
describe('InitiativeSchema', () => {
  it('parses an initiative with linked epics', () => {
    const result = InitiativeSchema.parse({
      id: '5',
      title: 'Q3 Platform',
      body: 'The big push',
      epics: [{ id: '19', title: 'Decomposition' }],
    })
    expect(result.id).toBe('5')
    expect(result.epics).toEqual([{ id: '19', title: 'Decomposition' }])
  })

  it('defaults epics to an empty array when omitted', () => {
    const result = InitiativeSchema.parse({ id: '5', title: 'T', body: 'B' })
    expect(result.epics).toEqual([])
  })

  it('parses create input', () => {
    const result = CreateInitiativeInputSchema.parse({ title: 'T', body: 'B' })
    expect(result.title).toBe('T')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tasks/task-tracker/task-tracker.test.ts`
Expected: FAIL — `InitiativeSchema` is not exported / undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/tasks/task-tracker/task-tracker.ts`, add after `CreateTechnicalDesignInputSchema` (before the `export type Comment = ...` block):

```ts
export const InitiativeSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  epics: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
})

export const CreateInitiativeInputSchema = z.object({
  title: z.string(),
  body: z.string(),
})
```

And add to the `export type` block (near lines 81-87):

```ts
export type Initiative = z.infer<typeof InitiativeSchema>
export type CreateInitiativeInput = z.infer<typeof CreateInitiativeInputSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tasks/task-tracker/task-tracker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tasks/task-tracker/task-tracker.ts src/tasks/task-tracker/task-tracker.test.ts
git commit -m "feat(tasks): add Initiative schemas and types"
```

---

### Task 2: `createInitiative` on the tracker

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts` (add to `TaskTracker` interface, around line 104)
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts` (new method + octokit mock imports already present; add `createMilestone` to the test mock)
- Test: `src/tasks/github-task-tracker/github-task-tracker.test.ts`
- Modify (mock stubs): `src/tasks/commands/epic/command.test.ts`, `src/tasks/commands/ticket/command.test.ts`, `src/tasks/commands/users/command.test.ts`, `src/tasks/commands/tdd/command.test.ts`

**Interfaces:**
- Consumes: `CreateInitiativeInput`, `Initiative` (Task 1)
- Produces: `createInitiative(input: CreateInitiativeInput): Promise<Initiative>` on `TaskTracker`

- [ ] **Step 1: Add `createMilestone` to the octokit mock**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, inside the `vi.mock('@octokit/rest', ...)` block, add `createMilestone: vi.fn(),` to the `rest.issues` object (alongside `create`, `get`, `update`, etc.):

```ts
        issues: {
          create: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          createComment: vi.fn(),
          listComments: vi.fn(),
          createMilestone: vi.fn(),
        },
```

- [ ] **Step 2: Write the failing test**

Add to `src/tasks/github-task-tracker/github-task-tracker.test.ts`:

```ts
describe('GitHubTracker.createInitiative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a milestone and maps it to an Initiative', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.createMilestone)
    mockCreate.mockResolvedValueOnce({
      data: { number: 7, title: 'Q3 Platform', description: 'The big push' },
    } as never)

    const initiative = await tracker.createInitiative({ title: 'Q3 Platform', body: 'The big push' })

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      title: 'Q3 Platform',
      description: 'The big push',
    })
    expect(initiative).toEqual({ id: '7', title: 'Q3 Platform', body: 'The big push', epics: [] })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: FAIL — `tracker.createInitiative is not a function`.

- [ ] **Step 4: Add the interface method**

In `src/tasks/task-tracker/task-tracker.ts`, add to the `TaskTracker` interface (after `getUsers()` or grouped with the create methods):

```ts
  createInitiative(input: CreateInitiativeInput): Promise<Initiative>
```

- [ ] **Step 5: Implement in `GitHubTaskTracker`**

In `src/tasks/github-task-tracker/github-task-tracker.ts`, first extend the type import from `../task-tracker/task-tracker.js` to include `CreateInitiativeInput` and `Initiative`. Then add the method (place it near `createEpic`):

```ts
  async createInitiative(input: CreateInitiativeInput): Promise<Initiative> {
    const { data } = await this.octokit.rest.issues.createMilestone({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      description: input.body,
    })
    return {
      id: String(data.number),
      title: data.title,
      body: data.description ?? '',
      epics: [],
    }
  }
```

- [ ] **Step 6: Add mock stubs to the four full-tracker mocks**

In each of `src/tasks/commands/epic/command.test.ts`, `src/tasks/commands/ticket/command.test.ts`, `src/tasks/commands/users/command.test.ts`, `src/tasks/commands/tdd/command.test.ts`, add to the object returned by `makeTracker()`:

```ts
  createInitiative: vi.fn(),
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/tasks/task-tracker/task-tracker.ts src/tasks/github-task-tracker/ src/tasks/commands/
git commit -m "feat(tasks): add createInitiative (GitHub milestone-backed)"
```

---

### Task 3: `linkEpicToInitiative` on the tracker

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts` (interface)
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Test: `src/tasks/github-task-tracker/github-task-tracker.test.ts`
- Modify (mock stubs): the same four command test files as Task 2

**Interfaces:**
- Produces: `linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void>` on `TaskTracker`

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/github-task-tracker/github-task-tracker.test.ts`:

```ts
describe('GitHubTracker.linkEpicToInitiative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets the epic issue milestone to the initiative number', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)
    mockUpdate.mockResolvedValueOnce({ data: {} } as never)

    await tracker.linkEpicToInitiative('19', '7')

    expect(mockUpdate).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      issue_number: 19,
      milestone: 7,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: FAIL — `tracker.linkEpicToInitiative is not a function`.

- [ ] **Step 3: Add the interface method**

In `src/tasks/task-tracker/task-tracker.ts`, add to `TaskTracker`:

```ts
  linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void>
```

- [ ] **Step 4: Implement in `GitHubTaskTracker`**

In `src/tasks/github-task-tracker/github-task-tracker.ts`, add:

```ts
  async linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(epicId, 10),
      milestone: parseInt(initiativeId, 10),
    })
  }
```

- [ ] **Step 5: Add mock stubs to the four full-tracker mocks**

Add `linkEpicToInitiative: vi.fn(),` to `makeTracker()` in each of the four command test files.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tasks/task-tracker/task-tracker.ts src/tasks/github-task-tracker/ src/tasks/commands/
git commit -m "feat(tasks): add linkEpicToInitiative (sets epic milestone)"
```

---

### Task 4: `getInitiative` on the tracker

**Files:**
- Modify: `src/tasks/task-tracker/task-tracker.ts` (interface)
- Modify: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Test: `src/tasks/github-task-tracker/github-task-tracker.test.ts` (also add `getMilestone` + `listForRepo` to the octokit mock)
- Modify (mock stubs): the same four command test files

**Interfaces:**
- Produces: `getInitiative(id: string): Promise<Initiative>` on `TaskTracker`

- [ ] **Step 1: Add `getMilestone` and `listForRepo` to the octokit mock**

In `src/tasks/github-task-tracker/github-task-tracker.test.ts`, inside `vi.mock('@octokit/rest', ...)`, add to `rest.issues`:

```ts
          getMilestone: vi.fn(),
          listForRepo: vi.fn(),
```

- [ ] **Step 2: Write the failing test**

Add to `src/tasks/github-task-tracker/github-task-tracker.test.ts`:

```ts
describe('GitHubTracker.getInitiative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the milestone with its epic-labelled issues', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGetMilestone = vi.mocked(tracker.octokit.rest.issues.getMilestone)
    // @ts-expect-error — accessing private field for test setup
    const mockListForRepo = vi.mocked(tracker.octokit.rest.issues.listForRepo)
    mockGetMilestone.mockResolvedValueOnce({
      data: { number: 7, title: 'Q3 Platform', description: 'The big push' },
    } as never)
    mockListForRepo.mockResolvedValueOnce({
      data: [
        { number: 19, title: 'Decomposition' },
        { number: 30, title: 'Rollout' },
      ],
    } as never)

    const initiative = await tracker.getInitiative('7')

    expect(mockGetMilestone).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      milestone_number: 7,
    })
    expect(mockListForRepo).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      milestone: '7',
      labels: 'epic',
      state: 'all',
    })
    expect(initiative).toEqual({
      id: '7',
      title: 'Q3 Platform',
      body: 'The big push',
      epics: [
        { id: '19', title: 'Decomposition' },
        { id: '30', title: 'Rollout' },
      ],
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts`
Expected: FAIL — `tracker.getInitiative is not a function`.

- [ ] **Step 4: Add the interface method**

In `src/tasks/task-tracker/task-tracker.ts`, add to `TaskTracker`:

```ts
  getInitiative(id: string): Promise<Initiative>
```

- [ ] **Step 5: Implement in `GitHubTaskTracker`**

In `src/tasks/github-task-tracker/github-task-tracker.ts`, add:

```ts
  async getInitiative(id: string): Promise<Initiative> {
    const milestoneNumber = parseInt(id, 10)
    const [milestoneResponse, epicsResponse] = await Promise.all([
      this.octokit.rest.issues.getMilestone({
        owner: this.owner,
        repo: this.repo,
        milestone_number: milestoneNumber,
      }),
      this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        milestone: String(milestoneNumber),
        labels: 'epic',
        state: 'all',
      }),
    ])
    const milestone = milestoneResponse.data
    return {
      id,
      title: milestone.title,
      body: milestone.description ?? '',
      epics: epicsResponse.data.map((issue) => ({
        id: String(issue.number),
        title: issue.title,
      })),
    }
  }
```

- [ ] **Step 6: Add mock stubs to the four full-tracker mocks**

Add `getInitiative: vi.fn(),` to `makeTracker()` in each of the four command test files.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/tasks/github-task-tracker/github-task-tracker.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/tasks/task-tracker/task-tracker.ts src/tasks/github-task-tracker/ src/tasks/commands/
git commit -m "feat(tasks): add getInitiative (milestone + epic-labelled issues)"
```

---

### Task 5: `initiative` CLI command (`create`, `get`)

**Files:**
- Create: `src/tasks/commands/initiative/command.ts`
- Create: `src/tasks/commands/initiative/command.test.ts`
- Modify: `src/cli.ts` (import + register)

**Interfaces:**
- Consumes: `getTracker().createInitiative(...)`, `getTracker().getInitiative(...)` (Tasks 2, 4)
- Produces: `createInitiativeCommand(getTracker: () => TaskTracker): Command`

- [ ] **Step 1: Write the failing test**

Create `src/tasks/commands/initiative/command.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, Initiative } from '../../task-tracker/task-tracker.js'
import { createInitiativeCommand } from './command.js'

const mockInitiative: Initiative = {
  id: '7',
  title: 'Q3 Platform',
  body: 'The big push',
  epics: [{ id: '19', title: 'Decomposition' }],
}

const makeTracker = (): Pick<TaskTracker, 'createInitiative' | 'getInitiative'> => ({
  createInitiative: vi.fn().mockResolvedValue(mockInitiative),
  getInitiative: vi.fn().mockResolvedValue(mockInitiative),
})

const run = (tracker: Pick<TaskTracker, 'createInitiative' | 'getInitiative'>, args: string[]) =>
  createInitiativeCommand(() => tracker as TaskTracker)
    .exitOverride()
    .parseAsync(args, { from: 'user' })

describe('initiative command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createInitiative and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'Q3 Platform', '--body', 'The big push'])
    expect(tracker.createInitiative).toHaveBeenCalledWith({ title: 'Q3 Platform', body: 'The big push' })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + '\n')
    output.mockRestore()
  })

  it('calls getInitiative and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7'])
    expect(tracker.getInitiative).toHaveBeenCalledWith('7')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + '\n')
    output.mockRestore()
  })

  it('rejects "create" when --title is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['create', '--body', 'B'])).rejects.toThrow(CommanderError)
    expect(tracker.createInitiative).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tasks/commands/initiative/command.test.ts`
Expected: FAIL — cannot find module `./command.js`.

- [ ] **Step 3: Write the command**

Create `src/tasks/commands/initiative/command.ts`:

```ts
import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

type CreateInitiativeOptions = { title: string; body: string }

export function createInitiativeCommand(getTracker: () => TaskTracker): Command {
  const initiative = new Command('initiative')

  initiative
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'initiative title')
    .requiredOption('--body <body>', 'initiative body')
    .action(async (opts: CreateInitiativeOptions) => {
      const result = await getTracker().createInitiative({ title: opts.title, body: opts.body })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  initiative
    .command('get')
    .exitOverride()
    .argument('<id>', 'initiative id')
    .action(async (id: string) => {
      const result = await getTracker().getInitiative(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return initiative
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tasks/commands/initiative/command.test.ts`
Expected: PASS

- [ ] **Step 5: Register the command in the CLI**

In `src/cli.ts`, add the import alongside the other command imports:

```ts
import { createInitiativeCommand } from './tasks/commands/initiative/command.js'
```

And register it in `buildProgram` (after `createEpicCommand`):

```ts
  program.addCommand(createInitiativeCommand(getTracker))
```

- [ ] **Step 6: Run full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tasks/commands/initiative/ src/cli.ts
git commit -m "feat(cli): add initiative create/get commands"
```

---

### Task 6: `epic link-initiative` subcommand + bundle rebuild

**Files:**
- Modify: `src/tasks/commands/epic/command.ts` (new subcommand before `return epic`)
- Modify: `src/tasks/commands/epic/command.test.ts` (already has `linkEpicToInitiative: vi.fn()` from Task 3)
- Modify: `bin/flight-rules` (regenerated)

**Interfaces:**
- Consumes: `getTracker().linkEpicToInitiative(epicId, initiativeId)` (Task 3)

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/commands/epic/command.test.ts`:

```ts
  it('calls linkEpicToInitiative for "link-initiative"', async () => {
    const tracker = makeTracker()
    await run(tracker, ['link-initiative', '19', '--initiative', '7'])
    expect(tracker.linkEpicToInitiative).toHaveBeenCalledWith('19', '7')
  })

  it('rejects "link-initiative" when --initiative is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['link-initiative', '19'])).rejects.toThrow(CommanderError)
    expect(tracker.linkEpicToInitiative).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tasks/commands/epic/command.test.ts`
Expected: FAIL — unknown command `link-initiative`.

- [ ] **Step 3: Add the subcommand**

In `src/tasks/commands/epic/command.ts`, before `return epic`:

```ts
  epic
    .command('link-initiative')
    .exitOverride()
    .argument('<epicId>', 'epic id')
    .requiredOption('--initiative <id>', 'initiative (milestone) id')
    .action(async (epicId: string, opts: { initiative: string }) => {
      await getTracker().linkEpicToInitiative(epicId, opts.initiative)
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tasks/commands/epic/command.test.ts`
Expected: PASS

- [ ] **Step 5: Full verification + rebuild bundle**

Run: `npm run typecheck && npx eslint src/ && npm test && npm run build`
Expected: all PASS; `bin/flight-rules` regenerated.

- [ ] **Step 6: Smoke-test the CLI help (no network)**

Run: `./bin/flight-rules initiative --help && ./bin/flight-rules epic --help`
Expected: `initiative` shows `create` and `get`; `epic` shows `link-initiative`.

- [ ] **Step 7: Commit**

```bash
git add src/tasks/commands/epic/ bin/flight-rules
git commit -m "feat(cli): add epic link-initiative subcommand + rebuild bundle"
```

---

## Self-Review

**Spec coverage (against #21 acceptance criteria):**
- `initiative create --title --body` → Task 5. ✓
- `initiative get <id>` returns initiative + linked epics → Task 4 (tracker) + Task 5 (CLI). ✓
- `epic link-initiative <epicId> --initiative <id>` → Task 3 (tracker) + Task 6 (CLI). ✓
- `InitiativeSchema` (Zod), thinner than an Issue → Task 1. ✓
- `GitHubTaskTracker` methods unit-tested with mocked octokit → Tasks 2, 3, 4. ✓

**Type consistency:** `Initiative` shape (`id`, `title`, `body`, `epics: {id,title}[]`) is identical in Task 1 (schema), Tasks 2/4 (tracker returns), and Task 5 (command mock). Method signatures `createInitiative(CreateInitiativeInput)`, `getInitiative(string)`, `linkEpicToInitiative(string, string)` match across interface, impl, and command usages.

**Green-per-task:** Each interface addition (Tasks 2/3/4) lands with its impl and its mock stubs in the four full-tracker test files in the same commit, so `tsc` stays green after every task.
