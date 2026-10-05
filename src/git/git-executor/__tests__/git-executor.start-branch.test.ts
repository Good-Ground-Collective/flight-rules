import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NodeGitExecutor } from '../git-executor.js'

const run = promisify(execFile)

describe('NodeGitExecutor.startBranch against real repos', () => {
  let root: string
  let main: string
  let worktree: string

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const executorIn = (cwd: string): NodeGitExecutor =>
    new NodeGitExecutor((file, args) => run(file, [...args], { cwd }))

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'fr-start-branch-')))
    main = join(root, 'main')
    worktree = join(root, 'wt')
    execFileSync('git', ['init', '-q', '-b', 'main', main])
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root')
    git(main, 'worktree', 'add', '-q', '-b', 'worktree-scratch', worktree)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('renames a disposable worktree branch instead of stacking on it', async () => {
    const start = await executorIn(worktree).startBranch({ type: 'feat', scope: 'FRT-1', description: 'thing' })
    expect(start).toEqual({ branch: 'feat/FRT-1-thing', renamedFrom: 'worktree-scratch' })
    expect(git(worktree, 'branch', '--list', 'worktree-scratch')).toBe('')
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/FRT-1-thing')
  })

  it('renames when --from names the commit the worktree branch sits on', async () => {
    const start = await executorIn(worktree).startBranch({ type: 'fix', scope: 'FRT-2' }, 'main')
    expect(start.renamedFrom).toBe('worktree-scratch')
  })

  it('creates a new branch when the worktree branch has commits of its own', async () => {
    git(worktree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'work')
    const start = await executorIn(worktree).startBranch({ type: 'feat', scope: 'FRT-3' })
    expect(start).toEqual({ branch: 'feat/FRT-3', renamedFrom: null })
    expect(git(worktree, 'branch', '--list', 'worktree-scratch')).not.toBe('')
  })

  it('creates a new branch when --from points somewhere else', async () => {
    git(main, 'branch', 'other')
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'ahead')
    const start = await executorIn(worktree).startBranch({ type: 'feat', scope: 'FRT-4' }, 'main')
    expect(start.renamedFrom).toBeNull()
  })

  it('never renames a branch in the main checkout', async () => {
    git(main, 'checkout', '-q', '-b', 'scratch')
    const start = await executorIn(main).startBranch({ type: 'feat', scope: 'FRT-5' })
    expect(start).toEqual({ branch: 'feat/FRT-5', renamedFrom: null })
    expect(git(main, 'branch', '--list', 'scratch')).not.toBe('')
  })
})
