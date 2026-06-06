# git commit command + Release Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `flight-rules git commit` — a conventional-commit builder with auto-generated attribution footers — and rework the release pipeline so the binary is rebuilt automatically on merge instead of committed manually by developers.

**Architecture:** A `GitExecutor` interface (parallel to `TaskTracker`) with a `NodeGitExecutor` implementation that wraps `child_process.execFile`. The command handler constructs the commit message from flags, appends three auto-generated trailers (`Flight-Rules-Version`, `Harness-Version`, `Model-Used`), and outputs JSON. A shared `parseFlags` utility replaces the duplicated version in each command file and gains support for repeated flags. The `git` command route in `index.ts` bypasses `buildTracker()`, fixing a latent bug where tracker-free commands fail if no config exists.

**Tech Stack:** TypeScript 6, Vitest, Node.js `child_process.execFile`, semantic-release

**Branch:** Stack on top of `worktree-flight-rules-cli`. All work happens in that worktree at `.claude/worktrees/flight-rules-cli/`.

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/parse-flags.ts` | Create | Shared flag parser with multi-value key support |
| `src/parse-flags.test.ts` | Create | Tests for `parseFlags`, `getString`, `getStrings` |
| `src/commands/epic.ts` | Modify | Import `parseFlags`, `getString` from shared utility |
| `src/commands/ticket.ts` | Modify | Same |
| `src/commands/tdd.ts` | Modify | Same |
| `src/git/executor.ts` | Create | `GitExecutor` interface + `NodeGitExecutor` |
| `src/git/executor.test.ts` | Create | Tests with injectable mock exec function |
| `src/commands/git.ts` | Create | `runGitCommand` → `runGitCommitCommand`; message builder; version/harness readers |
| `src/commands/git.test.ts` | Create | Tests with `MockGitExecutor` and `vi.stubEnv` |
| `src/index.ts` | Modify | Add `git` route before `buildTracker()`; fix latent bug |
| `.github/workflows/ci.yml` | Modify | Remove build freshness step; add release job |
| `.claude-plugin/plugin.json` | Create | Plugin manifest |
| `package.json` | Modify | Add semantic-release config + devDependencies |

---

### Task 1: Extract `parseFlags` to shared utility with multi-value support

**Files:**
- Create: `src/parse-flags.ts`
- Create: `src/parse-flags.test.ts`
- Modify: `src/commands/epic.ts`
- Modify: `src/commands/ticket.ts`
- Modify: `src/commands/tdd.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/parse-flags.test.ts
import { describe, it, expect } from 'vitest'
import { parseFlags, getString, getStrings } from './parse-flags.js'

describe('parseFlags', () => {
  it('parses a single-value flag as a string', () => {
    const flags = parseFlags(['--type', 'feat'])
    expect(flags['type']).toBe('feat')
  })

  it('parses a repeated flag as a string array', () => {
    const flags = parseFlags(['--file', 'a.ts', '--file', 'b.ts'])
    expect(flags['file']).toEqual(['a.ts', 'b.ts'])
  })

  it('parses mixed single and repeated flags correctly', () => {
    const flags = parseFlags(['--type', 'feat', '--file', 'a.ts', '--file', 'b.ts'])
    expect(flags['type']).toBe('feat')
    expect(flags['file']).toEqual(['a.ts', 'b.ts'])
  })

  it('ignores a flag with no following value', () => {
    const flags = parseFlags(['--type'])
    expect(flags['type']).toBeUndefined()
  })

  it('ignores a flag whose next token is another flag', () => {
    const flags = parseFlags(['--type', '--scope'])
    expect(flags['type']).toBeUndefined()
  })
})

describe('getString', () => {
  it('returns a string value directly', () => {
    const flags = parseFlags(['--type', 'feat'])
    expect(getString(flags, 'type')).toBe('feat')
  })

  it('returns the first element when value is an array', () => {
    const flags = parseFlags(['--file', 'a.ts', '--file', 'b.ts'])
    expect(getString(flags, 'file')).toBe('a.ts')
  })

  it('returns undefined for a missing key', () => {
    expect(getString({}, 'missing')).toBeUndefined()
  })
})

describe('getStrings', () => {
  it('wraps a single string value in an array', () => {
    const flags = parseFlags(['--type', 'feat'])
    expect(getStrings(flags, 'type')).toEqual(['feat'])
  })

  it('returns an array value as-is', () => {
    const flags = parseFlags(['--file', 'a.ts', '--file', 'b.ts'])
    expect(getStrings(flags, 'file')).toEqual(['a.ts', 'b.ts'])
  })

  it('returns an empty array for a missing key', () => {
    expect(getStrings({}, 'missing')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/flight-rules-cli && npm test -- src/parse-flags.test.ts
```

Expected: FAIL — cannot find module `./parse-flags.js`

- [ ] **Step 3: Create `src/parse-flags.ts`**

```typescript
export function parseFlags(args: string[]): Record<string, string | string[]> {
  const flags: Record<string, string | string[]> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg !== undefined && arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        const existing = flags[key]
        if (existing === undefined) {
          flags[key] = value
        } else if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          flags[key] = [existing, value]
        }
        i++
      }
    }
  }
  return flags
}

export function getString(
  flags: Record<string, string | string[]>,
  key: string,
): string | undefined {
  const val = flags[key]
  if (val === undefined) return undefined
  return Array.isArray(val) ? val[0] : val
}

export function getStrings(
  flags: Record<string, string | string[]>,
  key: string,
): string[] {
  const val = flags[key]
  if (val === undefined) return []
  return Array.isArray(val) ? val : [val]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/parse-flags.test.ts
```

Expected: PASS — all 11 tests pass

- [ ] **Step 5: Update `src/commands/epic.ts`**

Replace the file contents (remove the local `parseFlags`, import from shared utility):

```typescript
import type { TaskTracker } from '../task-tracker/types.js'
import { parseFlags, getString, getStrings } from '../parse-flags.js'

export async function runEpicCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const epic = await tracker.createEpic({
      title: getString(flags, 'title') ?? '',
      body: getString(flags, 'body') ?? '',
      labels: getString(flags, 'labels') !== undefined
        ? (getString(flags, 'labels') as string).split(',')
        : [],
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

- [ ] **Step 6: Update `src/commands/ticket.ts`**

```typescript
import type { CreateTicketInput, TaskTracker } from '../task-tracker/types.js'
import { parseFlags, getString } from '../parse-flags.js'

export async function runTicketCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const input: CreateTicketInput = {
      title: getString(flags, 'title') ?? '',
      body: getString(flags, 'body') ?? '',
      epicId: getString(flags, 'epic-id') ?? '',
      labels: getString(flags, 'labels') !== undefined
        ? (getString(flags, 'labels') as string).split(',')
        : [],
      ...(getString(flags, 'assignee') !== undefined
        ? { assignee: getString(flags, 'assignee') }
        : {}),
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

- [ ] **Step 7: Update `src/commands/tdd.ts`**

```typescript
import type { TaskTracker } from '../task-tracker/types.js'
import { parseFlags, getString } from '../parse-flags.js'

export async function runTddCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const tdd = await tracker.createTechnicalDesign({
      title: getString(flags, 'title') ?? '',
      body: getString(flags, 'body') ?? '',
      epicId: getString(flags, 'epic-id') ?? '',
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

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: all existing tests still pass

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add src/parse-flags.ts src/parse-flags.test.ts src/commands/epic.ts src/commands/ticket.ts src/commands/tdd.ts
git commit -m "refactor: extract shared parseFlags with multi-value key support"
```

---

### Task 2: `GitExecutor` interface + `NodeGitExecutor`

**Files:**
- Create: `src/git/executor.ts`
- Create: `src/git/executor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/git/executor.test.ts
import { describe, it, expect, vi } from 'vitest'
import { NodeGitExecutor } from './executor.js'

const makeExec = (stdout = '') =>
  vi.fn().mockResolvedValue({ stdout, stderr: '' })

describe('NodeGitExecutor.stage', () => {
  it('calls git add -- with provided files', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.stage(['src/foo.ts', 'src/bar.ts'])
    expect(exec).toHaveBeenCalledWith('git', ['add', '--', 'src/foo.ts', 'src/bar.ts'])
  })

  it('does nothing when files array is empty', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.stage([])
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('NodeGitExecutor.commit', () => {
  it('calls git commit -m with the message', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.commit('feat(scope): description')
    expect(exec).toHaveBeenCalledWith('git', ['commit', '-m', 'feat(scope): description'])
  })
})

describe('NodeGitExecutor.getCommitSha', () => {
  it('returns trimmed output of git rev-parse HEAD', async () => {
    const exec = makeExec('abc123\n')
    const executor = new NodeGitExecutor(exec)
    const sha = await executor.getCommitSha()
    expect(sha).toBe('abc123')
    expect(exec).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/git/executor.test.ts
```

Expected: FAIL — cannot find module `./executor.js`

- [ ] **Step 3: Create `src/git/executor.ts`**

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

export interface GitExecutor {
  stage(files: string[]): Promise<void>
  commit(message: string): Promise<void>
  getCommitSha(): Promise<string>
}

export class NodeGitExecutor implements GitExecutor {
  private readonly execFile: ExecFileFn

  constructor(execFileFn?: ExecFileFn) {
    this.execFile = execFileFn ?? (promisify(execFile) as ExecFileFn)
  }

  async stage(files: string[]): Promise<void> {
    if (files.length === 0) return
    await this.execFile('git', ['add', '--', ...files])
  }

  async commit(message: string): Promise<void> {
    await this.execFile('git', ['commit', '-m', message])
  }

  async getCommitSha(): Promise<string> {
    const { stdout } = await this.execFile('git', ['rev-parse', 'HEAD'])
    return stdout.trim()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/git/executor.test.ts
```

Expected: PASS — all 4 tests pass

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/git/executor.ts src/git/executor.test.ts
git commit -m "feat: add GitExecutor interface and NodeGitExecutor"
```

---

### Task 3: `git commit` command handler

**Files:**
- Create: `src/commands/git.ts`
- Create: `src/commands/git.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/git.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitExecutor } from '../git/executor.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.2.3' })),
}))

const makeMockExecutor = (): GitExecutor => ({
  stage: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getCommitSha: vi.fn().mockResolvedValue('abc123'),
})

describe('buildCommitMessage', () => {
  it('builds subject + footers with no body', async () => {
    const { buildCommitMessage } = await import('./git.js')
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      footers: [],
      pluginVersion: '1.2.3',
      harnessVersion: undefined,
      model: undefined,
    })
    expect(msg).toBe('feat(cli): add thing\n\nFlight-Rules-Version: 1.2.3')
  })

  it('includes body between subject and footers', async () => {
    const { buildCommitMessage } = await import('./git.js')
    const msg = buildCommitMessage({
      type: 'fix',
      scope: 'core',
      description: 'fix bug',
      body: 'extra context here',
      footers: [],
      pluginVersion: '1.2.3',
      harnessVersion: undefined,
      model: undefined,
    })
    expect(msg).toBe('fix(core): fix bug\n\nextra context here\n\nFlight-Rules-Version: 1.2.3')
  })

  it('appends Harness-Version after Flight-Rules-Version', async () => {
    const { buildCommitMessage } = await import('./git.js')
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      footers: [],
      pluginVersion: '1.2.3',
      harnessVersion: 'claude-code@2.1.165',
      model: undefined,
    })
    expect(msg).toContain('Flight-Rules-Version: 1.2.3\nHarness-Version: claude-code@2.1.165')
  })

  it('appends Model-Used last when provided', async () => {
    const { buildCommitMessage } = await import('./git.js')
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      footers: [],
      pluginVersion: '1.2.3',
      harnessVersion: undefined,
      model: 'claude-sonnet-4-6',
    })
    expect(msg.endsWith('Model-Used: claude-sonnet-4-6')).toBe(true)
  })

  it('omits Model-Used when model is undefined', async () => {
    const { buildCommitMessage } = await import('./git.js')
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      footers: [],
      pluginVersion: '1.2.3',
      harnessVersion: undefined,
      model: undefined,
    })
    expect(msg).not.toContain('Model-Used')
  })

  it('places caller footers before auto-generated footers', async () => {
    const { buildCommitMessage } = await import('./git.js')
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      footers: ['Reviewed-By: alice'],
      pluginVersion: '1.2.3',
      harnessVersion: undefined,
      model: undefined,
    })
    const reviewedIdx = msg.indexOf('Reviewed-By: alice')
    const versionIdx = msg.indexOf('Flight-Rules-Version')
    expect(reviewedIdx).toBeGreaterThan(-1)
    expect(reviewedIdx).toBeLessThan(versionIdx)
  })
})

describe('parseHarnessVersion', () => {
  it('parses claude-code_2-1-165_agent into claude-code@2.1.165', async () => {
    const { parseHarnessVersion } = await import('./git.js')
    expect(parseHarnessVersion('claude-code_2-1-165_agent')).toBe('claude-code@2.1.165')
  })

  it('returns undefined for undefined input', async () => {
    const { parseHarnessVersion } = await import('./git.js')
    expect(parseHarnessVersion(undefined)).toBeUndefined()
  })

  it('returns undefined for unrecognised format', async () => {
    const { parseHarnessVersion } = await import('./git.js')
    expect(parseHarnessVersion('something-weird')).toBeUndefined()
  })
})

describe('runGitCommitCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('stages files, commits, and outputs JSON', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.stubEnv('AI_AGENT', '')
    const { runGitCommitCommand } = await import('./git.js')

    await runGitCommitCommand(
      ['--file', 'src/foo.ts', '--type', 'feat', '--scope', 'cli', '--description', 'add thing'],
      executor,
    )

    expect(vi.mocked(executor.stage)).toHaveBeenCalledWith(['src/foo.ts'])
    expect(vi.mocked(executor.commit)).toHaveBeenCalledOnce()
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"sha":"abc123"') as string,
    )
    output.mockRestore()
  })

  it('collects multiple --file flags into an array', async () => {
    const executor = makeMockExecutor()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.stubEnv('AI_AGENT', '')
    const { runGitCommitCommand } = await import('./git.js')

    await runGitCommitCommand(
      ['--file', 'src/foo.ts', '--file', 'src/bar.ts', '--type', 'feat', '--scope', 'cli', '--description', 'add thing'],
      executor,
    )

    expect(vi.mocked(executor.stage)).toHaveBeenCalledWith(['src/foo.ts', 'src/bar.ts'])
  })

  it('exits with code 1 when --type is missing', async () => {
    const executor = makeMockExecutor()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    const { runGitCommitCommand } = await import('./git.js')

    await expect(
      runGitCommitCommand(['--file', 'src/foo.ts', '--scope', 'cli', '--description', 'add thing'], executor),
    ).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
  })

  it('exits with code 1 when --scope is missing', async () => {
    const executor = makeMockExecutor()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    const { runGitCommitCommand } = await import('./git.js')

    await expect(
      runGitCommitCommand(['--file', 'src/foo.ts', '--type', 'feat', '--description', 'add thing'], executor),
    ).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
  })

  it('exits with code 1 when --description is missing', async () => {
    const executor = makeMockExecutor()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    const { runGitCommitCommand } = await import('./git.js')

    await expect(
      runGitCommitCommand(['--file', 'src/foo.ts', '--type', 'feat', '--scope', 'cli'], executor),
    ).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
  })
})

describe('runGitCommand', () => {
  it('exits with code 1 for unknown subcommand', async () => {
    const executor = makeMockExecutor()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    const { runGitCommand } = await import('./git.js')

    await expect(runGitCommand(['unknown'], executor)).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/commands/git.test.ts
```

Expected: FAIL — cannot find module `./git.js`

- [ ] **Step 3: Create `src/commands/git.ts`**

```typescript
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GitExecutor } from '../git/executor.js'
import { parseFlags, getString, getStrings } from '../parse-flags.js'

export function readPluginVersion(binPath: string): string {
  try {
    const pkgPath = join(dirname(binPath), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function parseHarnessVersion(agentEnv: string | undefined): string | undefined {
  if (!agentEnv) return undefined
  const match = /^(.+)_(\d+-\d+-\d+)_agent$/.exec(agentEnv)
  if (match?.[1] === undefined || match?.[2] === undefined) return undefined
  return `${match[1]}@${match[2].replace(/-/g, '.')}`
}

export function buildCommitMessage(opts: {
  type: string
  scope: string
  description: string
  body?: string
  footers: string[]
  pluginVersion: string
  harnessVersion: string | undefined
  model: string | undefined
}): string {
  const sections: string[] = []

  sections.push(`${opts.type}(${opts.scope}): ${opts.description}`)

  if (opts.body !== undefined) {
    sections.push(opts.body)
  }

  const trailers: string[] = [
    ...opts.footers,
    `Flight-Rules-Version: ${opts.pluginVersion}`,
    ...(opts.harnessVersion !== undefined ? [`Harness-Version: ${opts.harnessVersion}`] : []),
    ...(opts.model !== undefined ? [`Model-Used: ${opts.model}`] : []),
  ]

  sections.push(trailers.join('\n'))

  return sections.join('\n\n')
}

export async function runGitCommitCommand(args: string[], executor: GitExecutor): Promise<void> {
  const flags = parseFlags(args)

  const type = getString(flags, 'type')
  const scope = getString(flags, 'scope')
  const description = getString(flags, 'description')

  if (type === undefined || scope === undefined || description === undefined) {
    process.stderr.write('--type, --scope, and --description are all required\n')
    process.exit(1)
  }

  const files = getStrings(flags, 'file')
  const body = getString(flags, 'body')
  const footers = getStrings(flags, 'footer')
  const model = getString(flags, 'model')

  const pluginVersion = readPluginVersion(process.argv[1] ?? '')
  const harnessVersion = parseHarnessVersion(process.env['AI_AGENT'])

  const message = buildCommitMessage({
    type,
    scope,
    description,
    body,
    footers,
    pluginVersion,
    harnessVersion,
    model,
  })

  await executor.stage(files)
  await executor.commit(message)
  const sha = await executor.getCommitSha()

  process.stdout.write(JSON.stringify({ sha, message }) + '\n')
}

export async function runGitCommand(args: string[], executor: GitExecutor): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'commit') {
    await runGitCommitCommand(args.slice(1), executor)
    return
  }

  process.stderr.write(`Unknown git subcommand: ${subcommand ?? '(none)'}\n`)
  process.exit(1)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/commands/git.test.ts
```

Expected: PASS — all 13 tests pass

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/commands/git.ts src/commands/git.test.ts
git commit -m "feat: add git commit command handler"
```

---

### Task 4: Wire `src/index.ts`

**Files:**
- Modify: `src/index.ts`

The `git` command must be routed before `buildTracker()` is called — `git` requires no config file and no tracker.

- [ ] **Step 1: Update `src/index.ts`**

Replace the full file:

```typescript
#!/usr/bin/env node
import { join } from 'node:path'
import { readConfig } from './config.js'
import { GitHubTracker } from './task-tracker/github/github-tracker.js'
import { NodeGitExecutor } from './git/executor.js'
import { runEpicCommand } from './commands/epic.js'
import { runTicketCommand } from './commands/ticket.js'
import { runTddCommand } from './commands/tdd.js'
import { runGitCommand } from './commands/git.js'
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

  if (command === 'git') { await runGitCommand(rest, new NodeGitExecutor()); return }

  const tracker = buildTracker()
  if (command === 'epic') { await runEpicCommand(rest, tracker); return }
  if (command === 'ticket') { await runTicketCommand(rest, tracker); return }
  if (command === 'tdd') { await runTddCommand(rest, tracker); return }

  process.stderr.write(
    `Unknown command: ${command ?? '(none)'}\nUsage: flight-rules <git|epic|ticket|tdd> <subcommand> [flags]\n`,
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

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Build and smoke test**

```bash
npm run build
./bin/flight-rules git 2>&1 || true
```

Expected: output contains `Unknown git subcommand`

```bash
./bin/flight-rules git commit --type feat --scope cli --description "smoke test" 2>&1 || true
```

Expected: exits non-zero with a git error (no staged changes or not in a git repo) — not a crash

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: route git command in CLI entrypoint"
```

---

### Task 5: Release infrastructure

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.claude-plugin/plugin.json`
- Modify: `package.json`

- [ ] **Step 1: Install semantic-release dependencies**

```bash
npm install --save-dev semantic-release @semantic-release/commit-analyzer @semantic-release/release-notes-generator @semantic-release/npm @semantic-release/github
```

- [ ] **Step 2: Update `package.json`**

Add `release` script and `semantic-release` config block. The final `scripts` and new `release` sections should look like:

```json
"scripts": {
  "build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=bin/flight-rules && chmod +x bin/flight-rules",
  "fmt": "sort-package-json && oxfmt",
  "fmt:check": "sort-package-json --check && oxfmt --check",
  "release": "semantic-release",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
},
"release": {
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
```

- [ ] **Step 3: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "flight-rules",
  "version": "0.1.0",
  "description": "PM-to-engineering pipeline for Good Ground Collective",
  "repository": "https://github.com/good-ground-collective/flight-rules",
  "skills": "./skills/",
  "agents": "./agents/"
}
```

- [ ] **Step 4: Update `.github/workflows/ci.yml`**

Replace the full file:

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

  release:
    needs: ci
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - run: npm ci

      - name: Release
        run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Rebuild binary
        run: npm run build

      - name: Commit binary
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add bin/flight-rules
          git diff --cached --quiet || git commit -m "chore: rebuild binary for release [skip ci]"
          git push
```

- [ ] **Step 5: Run typecheck to confirm nothing is broken**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .claude-plugin/plugin.json .github/workflows/ci.yml
git commit -m "feat: add release pipeline, remove build freshness check, add plugin manifest"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `flight-rules git commit` command | 3, 4 |
| `--file` repeated flag | 1, 3 |
| `--type`, `--scope`, `--description` required (exit 1 if missing) | 3 |
| `--body`, `--footer`, `--model` optional flags | 3 |
| `Flight-Rules-Version` from `package.json` at runtime | 3 |
| `Harness-Version` parsed from `AI_AGENT` env var | 3 |
| `Model-Used` from `--model` flag, omitted if absent | 3 |
| Caller footers appear before auto-generated footers | 3 |
| JSON output `{ sha, message }` | 3 |
| `GitExecutor` interface with `NodeGitExecutor` | 2 |
| `parseFlags` shared utility with multi-value support | 1 |
| `git` command bypasses `buildTracker()` | 4 |
| Remove build freshness CI step | 5 |
| Release job rebuilds binary on merge to main | 5 |
| `contents: write` permission for release job | 5 |
| `.claude-plugin/plugin.json` manifest | 5 |
| `semantic-release` config in `package.json` | 5 |

**Placeholder scan:** None found.

**Type consistency:**
- `GitExecutor` interface defined in `executor.ts` and referenced in `commands/git.ts` and `index.ts` — consistent
- `parseFlags` returns `Record<string, string | string[]>` — used with `getString`/`getStrings` helpers throughout
- `buildCommitMessage` opts type uses `model: string | undefined` and `harnessVersion: string | undefined` — consistent with `parseHarnessVersion` return type
- `ExecFileFn` type in `executor.ts` matches the injectable parameter in `NodeGitExecutor` constructor
