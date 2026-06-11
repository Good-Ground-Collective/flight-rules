# Commander.js + Colocated Commands Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the PR #1 review by replacing the hand-rolled argv/stdout command system with Commander.js and restructuring `src/` so each command's action is colocated with the command, then cascade the same structure onto the stacked PR #2 (git commit command).

**Architecture:** A single Commander `program` is assembled in `src/cli.ts`. Each command subsystem lives in its own directory under `src/`: task-tracker commands under `src/tasks/`, the git command under `src/git/`. Every command module exports a factory `create<Name>Command(...)` returning a Commander `Command`, with its action handler colocated in the same file. The tracker is injected lazily (a `() => TaskTracker` factory) so `--help` and unrelated commands never require `GITHUB_TOKEN`. Output stays JSON-to-stdout; Commander owns flag parsing, required-flag validation, and usage/error text.

**Tech Stack:** TypeScript 6, Commander.js 14, esbuild (ESM bundle), Zod, @octokit/rest, @octokit/graphql, vitest

**Branch strategy:** Phase A is done on `worktree-flight-rules-cli` (PR #1). Phase B rebases `worktree-git-commit-release` (PR #2) onto the refactored PR #1 and ports the git command into the new layout. Phase B steps assume Phase A is merged or its branch is the rebase base.

---

## Target File Structure (Phase A end state)

```
src/
├── cli.ts                                          # Commander program, buildTracker, run(), main guard
├── config.ts                                       # unchanged — readConfig + Config schema
└── tasks/
    ├── task-tracker/
    │   └── task-tracker.ts                         # Zod schemas, inferred types, TaskTracker interface
    ├── github-task-tracker/
    │   └── github-task-tracker.ts                  # GitHubTaskTracker class
    └── commands/
        ├── epic/command.ts
        ├── ticket/command.ts
        └── tdd/command.ts
```

| File | Responsibility |
|---|---|
| `src/cli.ts` | Build root `program`, lazy `buildTracker`, export `run(argv)`, main-module guard |
| `src/config.ts` | Read + validate `.claude/flight-rules.local.md` (no change) |
| `src/tasks/task-tracker/task-tracker.ts` | Zod schemas + `TaskTracker` interface (moved from `task-tracker/types.ts`) |
| `src/tasks/github-task-tracker/github-task-tracker.ts` | `GitHubTaskTracker` (renamed from `GitHubTracker`) |
| `src/tasks/commands/epic/command.ts` | `createEpicCommand(getTracker)` → Commander `epic` command + actions |
| `src/tasks/commands/ticket/command.ts` | `createTicketCommand(getTracker)` → Commander `ticket` command + actions |
| `src/tasks/commands/tdd/command.ts` | `createTddCommand(getTracker)` → Commander `tdd` command + actions |

**Deleted in Phase A:** `src/index.ts`, `src/commands/{epic,ticket,tdd}.ts` (+ tests), `src/task-tracker/types.ts`, `src/task-tracker/github/github-tracker.ts` (+ tests), `src/index.test.ts`. Each is recreated at its new path with new tests.

## Target File Structure (Phase B end state — adds git)

```
src/
└── git/
    ├── git-executor/git-executor.ts                # GitExecutor interface + NodeGitExecutor
    └── commands/
        └── commit/command.ts                       # createGitCommand(getExecutor) + message builders
```

**Deleted in Phase B:** `src/parse-flags.ts` (+ test) — Commander replaces it entirely; `src/git/executor.ts` and `src/commands/git.ts` move into the structure above.

---

## Conventions every command module follows

A command module exports one factory. The Commander pattern is identical across all of them; only the options and tracker calls differ:

```typescript
import { Command } from 'commander'

export function createXCommand(getTracker: () => TaskTracker): Command {
  const cmd = new Command('x')
  cmd.command('create') /* .requiredOption(...).action(...) */
  cmd.command('get') /* .argument('<id>').action(...) */
  return cmd
}
```

- Required flags use `.requiredOption('--flag <value>', 'desc')` — Commander prints a clear error and exits non-zero when missing. This replaces every hand-rolled `?? ''` fallback.
- Repeatable flags (Phase B `--file`, `--footer`) use a collect function: `.option('--file <f>', 'desc', collect, [])`.
- Comma-list flags (`--labels`) take a single string and `.split(',')` in the action.
- Actions print `process.stdout.write(JSON.stringify(result) + '\n')`.
- The tracker/executor is obtained via the injected `getTracker()` **inside** the action, never at module load.

Tests parse a built command directly with `cmd.parseAsync(args, { from: 'user' })` and assert on a mock tracker + a stubbed `process.stdout.write`. `cmd.exitOverride()` converts Commander's `process.exit` into a thrown `CommanderError` so missing-required-flag cases are assertable.

---

# PHASE A — Refactor PR #1 (`worktree-flight-rules-cli`)

### Task A1: Install Commander, update build entrypoint

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Commander**

```bash
npm install commander
```

- [ ] **Step 2: Point the build at the new entrypoint**

In `package.json`, change the `build` script's input from `src/index.ts` to `src/cli.ts` (output path stays `bin/flight-rules`):

```json
"build": "esbuild src/cli.ts --bundle --platform=node --format=esm --outfile=bin/flight-rules && chmod +x bin/flight-rules",
```

- [ ] **Step 3: Verify the dependency resolves**

```bash
npm ls commander
```

Expected: prints `commander@14.x` (or current major), no `UNMET DEPENDENCY`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add commander and point build at src/cli.ts"
```

---

### Task A2: Move task-tracker types into the new layout

This is a pure move + rename of the module path. Contents are unchanged from `src/task-tracker/types.ts`; only the file location changes. The interface and schemas keep their names.

**Files:**
- Create: `src/tasks/task-tracker/task-tracker.ts`
- Create: `src/tasks/task-tracker/task-tracker.test.ts`
- Delete: `src/task-tracker/types.ts`, `src/task-tracker/types.test.ts`

- [ ] **Step 1: Create `src/tasks/task-tracker/task-tracker.ts`**

Copy the full contents of `src/task-tracker/types.ts` verbatim (all Zod schemas — `CommentSchema`, `TechnicalDesignSchema`, `TicketSchema`, `EpicSchema`, `CreateEpicInputSchema`, `CreateTicketInputSchema`, `CreateTechnicalDesignInputSchema` — their inferred type exports, and the `TaskTracker` interface) into the new path. No code changes.

- [ ] **Step 2: Create `src/tasks/task-tracker/task-tracker.test.ts`**

Copy the full contents of `src/task-tracker/types.test.ts`, changing only the import specifier:

```typescript
import {
  CommentSchema,
  TicketSchema,
  EpicSchema,
  CreateEpicInputSchema,
  CreateTicketInputSchema,
  CreateTechnicalDesignInputSchema,
} from './task-tracker.js'
```

- [ ] **Step 3: Delete the old files**

```bash
git rm src/task-tracker/types.ts src/task-tracker/types.test.ts
```

- [ ] **Step 4: Run the moved tests**

```bash
npm test -- src/tasks/task-tracker/task-tracker.test.ts
```

Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/task-tracker/
git commit -m "refactor: move task-tracker types into src/tasks/task-tracker"
```

---

### Task A3: Move + rename the GitHub tracker

Renames the class `GitHubTracker` → `GitHubTaskTracker` to match the directory name, and updates its import of the types module. The implementation body is otherwise unchanged.

**Files:**
- Create: `src/tasks/github-task-tracker/github-task-tracker.ts`
- Create: `src/tasks/github-task-tracker/github-task-tracker.test.ts`
- Delete: `src/task-tracker/github/github-tracker.ts`, `src/task-tracker/github/github-tracker.test.ts`

- [ ] **Step 1: Create `src/tasks/github-task-tracker/github-task-tracker.ts`**

Copy the full contents of `src/task-tracker/github/github-tracker.ts` with exactly two edits:

1. Change the type import path:

```typescript
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
  CreateTechnicalDesignInput,
  Epic,
  TaskTracker,
  TechnicalDesign,
  Ticket,
} from '../task-tracker/task-tracker.js'
```

2. Rename the class:

```typescript
export class GitHubTaskTracker implements TaskTracker {
```

All helper functions (`parseTicketIds`, `parseTddId`, `upsertFrTickets`, `upsertFrTdd`, `labelName`, `mapComment`, `mapTicket`), the three `fr-*` regexes, and every method body stay identical.

- [ ] **Step 2: Create `src/tasks/github-task-tracker/github-task-tracker.test.ts`**

Copy the full contents of the old `github-tracker.test.ts`, changing the import and the constructor calls:

```typescript
import { GitHubTaskTracker } from './github-task-tracker.js'
// ...
const makeTracker = () => new GitHubTaskTracker({ token: 'tok', owner: 'acme', repo: 'proj' })
```

The `vi.mock('@octokit/rest', ...)` and `vi.mock('@octokit/graphql', ...)` blocks and all four test bodies are unchanged.

- [ ] **Step 3: Delete the old files**

```bash
git rm src/task-tracker/github/github-tracker.ts src/task-tracker/github/github-tracker.test.ts
```

- [ ] **Step 4: Run the moved tests**

```bash
npm test -- src/tasks/github-task-tracker/github-task-tracker.test.ts
```

Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/github-task-tracker/
git commit -m "refactor: rename GitHubTracker to GitHubTaskTracker and relocate"
```

---

### Task A4: Epic command as a Commander command

**Files:**
- Create: `src/tasks/commands/epic/command.ts`
- Create: `src/tasks/commands/epic/command.test.ts`
- Delete: `src/commands/epic.ts`, `src/commands/epic.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tasks/commands/epic/command.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, Epic } from '../../task-tracker/task-tracker.js'
import { createEpicCommand } from './command.js'

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

const run = (tracker: TaskTracker, args: string[]) =>
  createEpicCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('epic command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createEpic and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['create', '--title', 'My Epic', '--body', 'Epic body'])

    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'My Epic', body: 'Epic body', labels: [] })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('splits --labels on comma', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['create', '--title', 'T', '--body', 'B', '--labels', 'bug,feature'])

    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'T', body: 'B', labels: ['bug', 'feature'] })
    output.mockRestore()
  })

  it('calls getEpic and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['get', '42'])

    expect(tracker.getEpic).toHaveBeenCalledWith('42')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('rejects "create" when --title is missing', async () => {
    const tracker = makeTracker()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(run(tracker, ['create', '--body', 'B'])).rejects.toThrow()
    expect(tracker.createEpic).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/tasks/commands/epic/command.test.ts
```

Expected: FAIL — cannot find module `./command.js`.

- [ ] **Step 3: Create `src/tasks/commands/epic/command.ts`**

```typescript
import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

export function createEpicCommand(getTracker: () => TaskTracker): Command {
  const epic = new Command('epic')

  epic
    .command('create')
    .requiredOption('--title <title>', 'epic title')
    .requiredOption('--body <body>', 'epic body')
    .option('--labels <labels>', 'comma-separated labels')
    .action(async (opts: { title: string; body: string; labels?: string }) => {
      const result = await getTracker().createEpic({
        title: opts.title,
        body: opts.body,
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  epic
    .command('get')
    .argument('<id>', 'epic id')
    .action(async (id: string) => {
      const result = await getTracker().getEpic(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return epic
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/tasks/commands/epic/command.test.ts
```

Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Delete the old command + commit**

```bash
git rm src/commands/epic.ts src/commands/epic.test.ts
git add src/tasks/commands/epic/
git commit -m "refactor: epic command via commander, colocated"
```

---

### Task A5: Ticket command as a Commander command

**Files:**
- Create: `src/tasks/commands/ticket/command.ts`
- Create: `src/tasks/commands/ticket/command.test.ts`
- Delete: `src/commands/ticket.ts`, `src/commands/ticket.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tasks/commands/ticket/command.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, Ticket } from '../../task-tracker/task-tracker.js'
import { createTicketCommand } from './command.js'

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

const run = (tracker: TaskTracker, args: string[]) =>
  createTicketCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('ticket command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTicket and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['create', '--title', 'Fix login', '--body', 'Details', '--epic-id', '42'])

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

    await run(tracker, ['create', '--title', 'T', '--body', 'B', '--epic-id', '1', '--assignee', 'alice'])

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

    await run(tracker, ['get', '7'])

    expect(tracker.getTicket).toHaveBeenCalledWith('7')
    output.mockRestore()
  })

  it('rejects "create" when --epic-id is missing', async () => {
    const tracker = makeTracker()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(run(tracker, ['create', '--title', 'T', '--body', 'B'])).rejects.toThrow()
    expect(tracker.createTicket).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/tasks/commands/ticket/command.test.ts
```

Expected: FAIL — cannot find module `./command.js`.

- [ ] **Step 3: Create `src/tasks/commands/ticket/command.ts`**

```typescript
import { Command } from 'commander'
import type { CreateTicketInput, TaskTracker } from '../../task-tracker/task-tracker.js'

export function createTicketCommand(getTracker: () => TaskTracker): Command {
  const ticket = new Command('ticket')

  ticket
    .command('create')
    .requiredOption('--title <title>', 'ticket title')
    .requiredOption('--body <body>', 'ticket body')
    .requiredOption('--epic-id <id>', 'parent epic id')
    .option('--labels <labels>', 'comma-separated labels')
    .option('--assignee <user>', 'assignee login')
    .action(
      async (opts: {
        title: string
        body: string
        epicId: string
        labels?: string
        assignee?: string
      }) => {
        const input: CreateTicketInput = {
          title: opts.title,
          body: opts.body,
          epicId: opts.epicId,
          labels: opts.labels !== undefined ? opts.labels.split(',') : [],
          ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
        }
        const result = await getTracker().createTicket(input)
        process.stdout.write(JSON.stringify(result) + '\n')
      },
    )

  ticket
    .command('get')
    .argument('<id>', 'ticket id')
    .action(async (id: string) => {
      const result = await getTracker().getTicket(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return ticket
}
```

Note: Commander camelCases `--epic-id` to `opts.epicId` automatically.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/tasks/commands/ticket/command.test.ts
```

Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Delete the old command + commit**

```bash
git rm src/commands/ticket.ts src/commands/ticket.test.ts
git add src/tasks/commands/ticket/
git commit -m "refactor: ticket command via commander, colocated"
```

---

### Task A6: TDD command as a Commander command

**Files:**
- Create: `src/tasks/commands/tdd/command.ts`
- Create: `src/tasks/commands/tdd/command.test.ts`
- Delete: `src/commands/tdd.ts`, `src/commands/tdd.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tasks/commands/tdd/command.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, TechnicalDesign } from '../../task-tracker/task-tracker.js'
import { createTddCommand } from './command.js'

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

const run = (tracker: TaskTracker, args: string[]) =>
  createTddCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('tdd command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTechnicalDesign and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['create', '--title', 'Auth TDD', '--body', 'Design doc body', '--epic-id', '42'])

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

    await run(tracker, ['get', '3'])

    expect(tracker.getTechnicalDesign).toHaveBeenCalledWith('3')
    output.mockRestore()
  })

  it('rejects "create" when --epic-id is missing', async () => {
    const tracker = makeTracker()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(run(tracker, ['create', '--title', 'T', '--body', 'B'])).rejects.toThrow()
    expect(tracker.createTechnicalDesign).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/tasks/commands/tdd/command.test.ts
```

Expected: FAIL — cannot find module `./command.js`.

- [ ] **Step 3: Create `src/tasks/commands/tdd/command.ts`**

```typescript
import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

export function createTddCommand(getTracker: () => TaskTracker): Command {
  const tdd = new Command('tdd')

  tdd
    .command('create')
    .requiredOption('--title <title>', 'tdd title')
    .requiredOption('--body <body>', 'tdd body')
    .requiredOption('--epic-id <id>', 'parent epic id')
    .action(async (opts: { title: string; body: string; epicId: string }) => {
      const result = await getTracker().createTechnicalDesign({
        title: opts.title,
        body: opts.body,
        epicId: opts.epicId,
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  tdd
    .command('get')
    .argument('<id>', 'tdd id')
    .action(async (id: string) => {
      const result = await getTracker().getTechnicalDesign(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return tdd
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/tasks/commands/tdd/command.test.ts
```

Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Delete the old command + commit**

```bash
git rm src/commands/tdd.ts src/commands/tdd.test.ts
git add src/tasks/commands/tdd/
git commit -m "refactor: tdd command via commander, colocated"
```

---

### Task A7: `cli.ts` entrypoint assembling the program

Replaces `src/index.ts`. Keeps `buildTracker` (config + `GITHUB_TOKEN` resolution) but injects it lazily so `--help` works without a token. The `GitHubTracker` import becomes `GitHubTaskTracker`.

**Files:**
- Create: `src/cli.ts`
- Create: `src/cli.test.ts`
- Delete: `src/index.ts`, `src/index.test.ts`
- Delete (now-empty dirs): `src/commands/`, `src/task-tracker/`

- [ ] **Step 1: Write the failing test**

```typescript
// src/cli.test.ts
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

  it('routes "epic create" through the tracker and prints JSON', async () => {
    const dir = join(tmpdir(), `fr-cli-test-${Date.now()}`)
    const configPath = writeConfig(dir, `---\ntracker: github\nrepo: acme/proj\n---\n`)
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    vi.stubEnv('FLIGHT_RULES_CONFIG', configPath)

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('./cli.js')
    await run(['epic', 'create', '--title', 'T', '--body', 'B'])

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"id":"1"') as string)
    output.mockRestore()
  })

  it('does not require GITHUB_TOKEN to show help', async () => {
    const { run } = await import('./cli.js')
    await expect(run(['--help'])).rejects.toThrow() // exitOverride throws on help
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/cli.test.ts
```

Expected: FAIL — cannot find module `./cli.js`.

- [ ] **Step 3: Write `src/cli.ts`**

```typescript
#!/usr/bin/env node
import { join } from 'node:path'
import { Command } from 'commander'
import { readConfig } from './config.js'
import { GitHubTaskTracker } from './tasks/github-task-tracker/github-task-tracker.js'
import { createEpicCommand } from './tasks/commands/epic/command.js'
import { createTicketCommand } from './tasks/commands/ticket/command.js'
import { createTddCommand } from './tasks/commands/tdd/command.js'
import type { TaskTracker } from './tasks/task-tracker/task-tracker.js'

function buildTracker(): TaskTracker {
  const configPath =
    process.env['FLIGHT_RULES_CONFIG'] ?? join(process.cwd(), '.claude', 'flight-rules.local.md')
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
    return new GitHubTaskTracker({ token, owner, repo })
  }

  throw new Error(`Unsupported tracker: ${config.tracker}`)
}

export function buildProgram(getTracker: () => TaskTracker): Command {
  const program = new Command('flight-rules')
  program.exitOverride()
  program.addCommand(createEpicCommand(getTracker))
  program.addCommand(createTicketCommand(getTracker))
  program.addCommand(createTddCommand(getTracker))
  return program
}

export async function run(argv: string[]): Promise<void> {
  await buildProgram(buildTracker).parseAsync(argv, { from: 'user' })
}

const isMain =
  process.argv[1]?.endsWith('flight-rules') === true || process.argv[1]?.endsWith('cli.js') === true

if (isMain) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
```

`buildTracker` is passed (not called) to `buildProgram`, so it only runs when an action invokes `getTracker()` — `--help` never triggers it.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/cli.test.ts
```

Expected: PASS — both tests pass.

- [ ] **Step 5: Delete old entrypoint and empty dirs**

```bash
git rm src/index.ts src/index.test.ts
rmdir src/commands src/task-tracker/github src/task-tracker 2>/dev/null || true
```

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "refactor: assemble CLI with commander in src/cli.ts"
```

---

### Task A8: Full suite, typecheck, lint, rebuild binary

**Files:** none new — verification + binary refresh.

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all tests pass (task-tracker 6, github-task-tracker 4, epic 4, ticket 4, tdd 3, config 3, cli 2).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If `opts` action params report implicit-any, the explicit param type annotations shown in each command file resolve it.

- [ ] **Step 3: Lint**

```bash
npx eslint src/
```

Expected: no errors. `GitHubTaskTracker`, `createEpicCommand`, etc. are PascalCase/camelCase-clean.

- [ ] **Step 4: Rebuild the binary**

```bash
npm run build
```

Expected: `bin/flight-rules` rebuilt from `src/cli.ts`, no errors.

- [ ] **Step 5: Smoke test — help works without a token**

```bash
env -u GITHUB_TOKEN ./bin/flight-rules --help
```

Expected: prints usage listing `epic`, `ticket`, `tdd`; exits 0; no token error.

- [ ] **Step 6: Smoke test — missing required flag**

```bash
./bin/flight-rules epic create --body B 2>&1 || true
```

Expected: Commander prints `error: required option '--title <title>' not specified`; exits non-zero.

- [ ] **Step 7: Commit the rebuilt binary**

```bash
git add bin/flight-rules
git commit -m "build: rebuild binary from commander entrypoint"
```

- [ ] **Step 8: Update PR #1 and request re-review**

```bash
git push
gh pr comment 1 --body "Refactored to Commander.js with colocated command structure per review. See src/cli.ts + src/tasks/."
```

---

# PHASE B — Cascade onto PR #2 (`worktree-git-commit-release`)

Phase B assumes Phase A is the rebase base. PR #2 currently carries: `src/parse-flags.ts` (shared flag parser — **obsoleted by Commander**), `src/git/executor.ts` (`GitExecutor` + `NodeGitExecutor`), `src/commands/git.ts` (commit command + message builders), a release pipeline, and `.claude-plugin/plugin.json`.

### Task B1: Rebase PR #2 onto refactored PR #1

**Files:** resolves conflicts only.

- [ ] **Step 1: Rebase**

```bash
cd <git-commit-release worktree>
git fetch origin
git rebase worktree-flight-rules-cli
```

- [ ] **Step 2: Resolve conflicts by taking the new structure**

The deleted files (`src/index.ts`, `src/commands/{epic,ticket,tdd}.ts`, `src/task-tracker/*`) conflict with PR #2's edits to them. Resolution: keep Phase A's deletions; the epic/ticket/tdd commands now live under `src/tasks/commands/`. `src/parse-flags.ts` and its test are kept by the rebase but will be deleted in Task B3. `src/git/executor.ts` and `src/commands/git.ts` survive the rebase unchanged — they are moved in Task B2.

- [ ] **Step 3: Do NOT build/commit yet** — the tree is intentionally inconsistent until B2–B4. Continue the rebase to completion (`git rebase --continue` through each conflicted commit), preferring deletions for Phase-A-removed files.

---

### Task B2: Move the git executor into the new layout

**Files:**
- Create: `src/git/git-executor/git-executor.ts`
- Create: `src/git/git-executor/git-executor.test.ts`
- Delete: `src/git/executor.ts`, `src/git/executor.test.ts`

- [ ] **Step 1: Move the executor**

Copy `src/git/executor.ts` to `src/git/git-executor/git-executor.ts` verbatim (the `GitExecutor` interface and `NodeGitExecutor` class — `interface → class` per charter M-3, unchanged).

- [ ] **Step 2: Move its test**

Copy `src/git/executor.test.ts` to `src/git/git-executor/git-executor.test.ts`, updating the import to `./git-executor.js`.

- [ ] **Step 3: Delete old paths**

```bash
git rm src/git/executor.ts src/git/executor.test.ts
```

- [ ] **Step 4: Run**

```bash
npm test -- src/git/git-executor/git-executor.test.ts
```

Expected: PASS (same assertions as before the move).

- [ ] **Step 5: Commit**

```bash
git add src/git/git-executor/
git commit -m "refactor: relocate git executor to src/git/git-executor"
```

---

### Task B3: Git commit command as a Commander command

Ports `src/commands/git.ts` into a colocated Commander command. The pure helpers (`readPluginVersion`, `parseHarnessVersion`, `buildCommitMessage`) move unchanged; only the argv-parsing wrapper (`runGitCommand`/`runGitCommitCommand` using `parseFlags`/`getString`/`getStrings`) is replaced by Commander option definitions.

**Files:**
- Create: `src/git/commands/commit/command.ts`
- Create: `src/git/commands/commit/command.test.ts`
- Delete: `src/commands/git.ts`, `src/commands/git.test.ts`
- Delete: `src/parse-flags.ts`, `src/parse-flags.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/git/commands/commit/command.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitExecutor } from '../../git-executor/git-executor.js'
import { createGitCommand, buildCommitMessage, parseHarnessVersion } from './command.js'

const makeExecutor = (): GitExecutor => ({
  stage: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getCommitSha: vi.fn().mockResolvedValue('abc123'),
})

const run = (executor: GitExecutor, args: string[]) =>
  createGitCommand(() => executor).exitOverride().parseAsync(args, { from: 'user' })

describe('parseHarnessVersion', () => {
  it('parses an agent env string', () => {
    expect(parseHarnessVersion('claude_2026-06-11_agent')).toBe('claude@2026.06.11')
  })
  it('returns undefined for missing input', () => {
    expect(parseHarnessVersion(undefined)).toBeUndefined()
  })
})

describe('buildCommitMessage', () => {
  it('assembles header, body, and trailers', () => {
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      body: 'details',
      footers: ['Reviewed-by: x'],
      pluginVersion: '1.2.3',
      harnessVersion: 'claude@2026.06.11',
      model: 'opus',
    })
    expect(msg).toContain('feat(cli): add thing')
    expect(msg).toContain('details')
    expect(msg).toContain('Flight-Rules-Version: 1.2.3')
    expect(msg).toContain('Harness-Version: claude@2026.06.11')
    expect(msg).toContain('Model-Used: opus')
  })
})

describe('git commit command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stages, commits, and prints sha + message', async () => {
    const executor = makeExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(executor, [
      'commit',
      '--type', 'feat',
      '--scope', 'cli',
      '--description', 'add thing',
      '--file', 'a.ts',
      '--file', 'b.ts',
    ])

    expect(executor.stage).toHaveBeenCalledWith(['a.ts', 'b.ts'])
    expect(executor.commit).toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"sha":"abc123"') as string)
    output.mockRestore()
  })

  it('rejects commit when --type is missing', async () => {
    const executor = makeExecutor()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(
      run(executor, ['commit', '--scope', 'cli', '--description', 'x']),
    ).rejects.toThrow()
    expect(executor.commit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/git/commands/commit/command.test.ts
```

Expected: FAIL — cannot find module `./command.js`.

- [ ] **Step 3: Create `src/git/commands/commit/command.ts`**

Keep `readPluginVersion`, `parseHarnessVersion`, and `buildCommitMessage` exactly as they are in `src/commands/git.ts` (copy verbatim, including their exports). Replace only the run wrappers with this Commander command:

```typescript
import { Command } from 'commander'
import type { GitExecutor } from '../../git-executor/git-executor.js'

// readPluginVersion, parseHarnessVersion, buildCommitMessage — copied verbatim from src/commands/git.ts

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

export function createGitCommand(getExecutor: () => GitExecutor): Command {
  const git = new Command('git')

  git
    .command('commit')
    .requiredOption('--type <type>', 'conventional commit type')
    .requiredOption('--scope <scope>', 'conventional commit scope')
    .requiredOption('--description <description>', 'commit description')
    .option('--file <file>', 'file to stage (repeatable)', collect, [])
    .option('--body <body>', 'commit body')
    .option('--footer <footer>', 'commit footer (repeatable)', collect, [])
    .option('--model <model>', 'model identifier')
    .action(
      async (opts: {
        type: string
        scope: string
        description: string
        file: string[]
        body?: string
        footer: string[]
        model?: string
      }) => {
        const pluginVersion = readPluginVersion(process.argv[1] ?? '')
        const harnessVersion = parseHarnessVersion(process.env['AI_AGENT'])

        const message = buildCommitMessage({
          type: opts.type,
          scope: opts.scope,
          description: opts.description,
          ...(opts.body !== undefined ? { body: opts.body } : {}),
          footers: opts.footer,
          pluginVersion,
          harnessVersion,
          model: opts.model,
        })

        const executor = getExecutor()
        await executor.stage(opts.file)
        await executor.commit(message)
        const sha = await executor.getCommitSha()

        process.stdout.write(JSON.stringify({ sha, message }) + '\n')
      },
    )

  return git
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/git/commands/commit/command.test.ts
```

Expected: PASS — all tests pass.

- [ ] **Step 5: Delete the obsolete files**

```bash
git rm src/commands/git.ts src/commands/git.test.ts src/parse-flags.ts src/parse-flags.test.ts
rmdir src/commands 2>/dev/null || true
```

- [ ] **Step 6: Commit**

```bash
git add src/git/commands/commit/
git commit -m "refactor: git commit command via commander, drop parse-flags"
```

---

### Task B4: Wire the git command into `cli.ts`

The git command takes a `GitExecutor`, not a `TaskTracker`, and must not trigger `buildTracker` (no config/token needed to commit). It is added to the program alongside the tracker commands.

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `src/cli.test.ts`:

```typescript
it('routes "git commit" without requiring a tracker config', async () => {
  vi.unstubAllEnvs()
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const { run } = await import('./cli.js')
  await run(['git', 'commit', '--type', 'feat', '--scope', 'cli', '--description', 'x'])
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"sha"') as string)
  output.mockRestore()
})
```

Note: this exercises the real `NodeGitExecutor` against the repo, matching PR #2's existing end-to-end intent. If PR #2's original `index.test.ts` mocked the executor, mirror that mock here instead.

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/cli.test.ts
```

Expected: FAIL — `git` is not a known command.

- [ ] **Step 3: Wire it in**

In `src/cli.ts`, import and register the git command. It gets a lazily-constructed `NodeGitExecutor`, independent of `buildTracker`:

```typescript
import { NodeGitExecutor } from './git/git-executor/git-executor.js'
import { createGitCommand } from './git/commands/commit/command.js'
```

In `buildProgram`, before `return program`:

```typescript
  program.addCommand(createGitCommand(() => new NodeGitExecutor()))
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: register git command in commander program"
```

---

### Task B5: Reconcile release pipeline, rebuild, update PR #2

The release pipeline and `.claude-plugin/plugin.json` carried through the rebase unchanged. Verify they still reference the right entrypoint/binary and that the build is fresh.

**Files:** verification + binary refresh.

- [ ] **Step 1: Full suite + typecheck + lint**

```bash
npm test && npm run typecheck && npx eslint src/
```

Expected: all green.

- [ ] **Step 2: Rebuild the binary**

```bash
npm run build
```

Expected: `bin/flight-rules` includes `git` — verify:

```bash
./bin/flight-rules --help
```

Expected: usage lists `epic`, `ticket`, `tdd`, AND `git`.

- [ ] **Step 3: Check the release pipeline references**

Grep the release workflow / config for stale paths:

```bash
grep -rn "src/index\|bin/index\|GitHubTracker" .github/ .claude-plugin/ package.json 2>/dev/null || echo "no stale references"
```

Expected: `no stale references`. If any are found, update them to `src/cli.ts` / `GitHubTaskTracker`.

- [ ] **Step 4: Commit the rebuilt binary**

```bash
git add bin/flight-rules
git commit -m "build: rebuild binary with git command"
```

- [ ] **Step 5: Force-push the rebased branch and note it on PR #2**

```bash
git push --force-with-lease
gh pr comment 2 --body "Rebased onto the Commander refactor; git command ported into src/git/commands/commit/ with the same colocated structure. parse-flags removed in favor of Commander."
```

---

## Self-Review

**Review-feedback coverage:**

| Review ask | Tasks |
|---|---|
| Use Commander.js, not hand-rolled stdin/stdout | A4–A7, B3, B4 |
| Colocate actions with their commands | A4 (epic/), A5 (ticket/), A6 (tdd/), B3 (commit/) |
| `src/cli.ts` entrypoint | A7 |
| `src/tasks/task-tracker/`, `github-task-tracker/`, `commands/{epic,ticket,tdd}/` layout | A2, A3, A4–A6 |
| Stacked PR #2 stays consistent | B1–B5 |
| Don't lose `coding-charter.md` | Already committed to `main` as `docs/coding-charter.md` this session; feeds skill prompts in Plan 2 |

**Charter mandates honored:** M-3 (`interface → class` preserved in task-tracker and git-executor); no planning identifiers introduced in source (M-1); no paragraph block comments added (M-2).

**Placeholder scan:** none — every code step shows complete code. The two "copy verbatim" steps (A2 schemas, B3 helpers) reference existing committed code rather than re-printing large unchanged blocks; this is a deliberate move-not-rewrite, not a placeholder.

**Type consistency:** `createEpicCommand` / `createTicketCommand` / `createTddCommand` / `createGitCommand` factory names match between command files and `cli.ts` imports. `GitHubTaskTracker` used consistently in A3 and A7. `getTracker: () => TaskTracker` and `getExecutor: () => GitExecutor` signatures match between command modules and `buildProgram`. Commander's `--epic-id` → `opts.epicId` camelCasing relied on consistently.

**Open verification point (flagged, not blocking):** Task B4 assumes PR #2's original entrypoint test used the real `NodeGitExecutor`. Confirm against PR #2's actual `index.test.ts` during execution and mirror whichever approach it took (real vs. mocked executor).
```