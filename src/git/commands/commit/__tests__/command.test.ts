import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { GitExecutor } from '../../../git-executor/git-executor.js'
import { createGitCommand } from '../command.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.2.3' })),
}))

const makeMockExecutor = (): GitExecutor => ({
  stage: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getCommitSha: vi.fn().mockResolvedValue('abc123'),
  checkout: vi.fn().mockResolvedValue('feat/25-saw'),
  getCurrentBranch: vi.fn().mockResolvedValue('feat/25-saw'),
  push: vi.fn().mockResolvedValue(undefined),
})

const run = (executor: GitExecutor, args: string[]) =>
  createGitCommand(() => executor).parseAsync(args, { from: 'user' })

describe('git commit command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('stages files, commits, and outputs JSON', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.stubEnv('AI_AGENT', '')
    await run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--scope', 'cli', '--description', 'add thing'])
    expect(vi.mocked(executor.stage)).toHaveBeenCalledWith(['src/foo.ts'])
    expect(vi.mocked(executor.commit)).toHaveBeenCalledOnce()
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"sha":"abc123"') as string)
    output.mockRestore()
  })

  it('collects multiple --file flags into an array', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.stubEnv('AI_AGENT', '')
    await run(executor, ['commit', '--file', 'src/foo.ts', '--file', 'src/bar.ts', '--type', 'feat', '--scope', 'cli', '--description', 'add thing'])
    expect(vi.mocked(executor.stage)).toHaveBeenCalledWith(['src/foo.ts', 'src/bar.ts'])
    output.mockRestore()
  })

  it('rejects commit when --type is missing', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(executor, ['commit', '--file', 'src/foo.ts', '--scope', 'cli', '--description', 'add thing'])).rejects.toThrow(CommanderError)
    expect(vi.mocked(executor.commit)).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('rejects commit when --scope is missing', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--description', 'add thing'])).rejects.toThrow(CommanderError)
    errOutput.mockRestore()
  })

  it('rejects commit when --description is missing', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--scope', 'cli'])).rejects.toThrow(CommanderError)
    errOutput.mockRestore()
  })

  it('rejects an unknown git subcommand', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(createGitCommand(() => executor).exitOverride().parseAsync(['bogus'], { from: 'user' })).rejects.toThrow(CommanderError)
    errOutput.mockRestore()
  })
})

describe('git checkout command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a semantic branch and outputs the branch name as JSON', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(executor, ['checkout', '--type', 'feat', '--scope', '25', '--description', 'saw'])
    expect(vi.mocked(executor.checkout)).toHaveBeenCalledWith({ type: 'feat', scope: '25', description: 'saw' }, undefined)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"branch":"feat/25-saw"') as string)
    output.mockRestore()
  })

  it('passes --from as the base branch for stacking', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(executor, ['checkout', '--type', 'feat', '--scope', '25', '--from', 'feat/22-research-agent'])
    expect(vi.mocked(executor.checkout)).toHaveBeenCalledWith({ type: 'feat', scope: '25' }, 'feat/22-research-agent')
    output.mockRestore()
  })

  it('rejects checkout when --scope is missing', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(executor, ['checkout', '--type', 'feat'])).rejects.toThrow(CommanderError)
    expect(vi.mocked(executor.checkout)).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})

describe('git push command', () => {
  it('resolves the branch from HEAD and sets upstream by default', async () => {
    const executor = makeMockExecutor()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(executor, ['push'])
    expect(executor.getCurrentBranch).toHaveBeenCalled()
    expect(executor.push).toHaveBeenCalledWith({
      branch: 'feat/25-saw',
      remote: 'origin',
      setUpstream: true,
    })
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"branch":"feat/25-saw"') as string)
    write.mockRestore()
  })

  it('honours --remote and --no-set-upstream', async () => {
    const executor = makeMockExecutor()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(executor, ['push', '--remote', 'upstream', '--no-set-upstream'])
    expect(executor.push).toHaveBeenCalledWith({
      branch: 'feat/25-saw',
      remote: 'upstream',
      setUpstream: false,
    })
  })

  it('has no force option', () => {
    const push = createGitCommand(() => makeMockExecutor())
      .commands.find((c) => c.name() === 'push')
    expect(push).toBeDefined()
    expect(push?.options.some((o) => o.long === '--force')).toBe(false)
  })
})
