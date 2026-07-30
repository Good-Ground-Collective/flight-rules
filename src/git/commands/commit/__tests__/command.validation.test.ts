import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitExecutor } from '../../../git-executor/git-executor.js'
import { semanticTypes } from '../../../semantic-types.js'
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

/**
 * KAN-29 contract: the commit command validates its input at the boundary —
 * an invalid --type (or empty required value) fails with a descriptive error
 * before any git call — and assembles the exact documented message shape for
 * --body / repeated --footer / --model.
 */
describe('git commit input validation (KAN-29)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('AI_AGENT', '')
  })

  it('rejects a --type outside the semantic vocabulary with an error naming the allowed types', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(
      run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'bogus', '--scope', 'cli', '--description', 'add thing']),
    ).rejects.toThrow(/feat/)
    expect(vi.mocked(executor.stage)).not.toHaveBeenCalled()
    expect(vi.mocked(executor.commit)).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('rejects an empty --scope before any git call', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(
      run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--scope', '', '--description', 'add thing']),
    ).rejects.toThrow()
    expect(vi.mocked(executor.stage)).not.toHaveBeenCalled()
    expect(vi.mocked(executor.commit)).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('rejects an empty --description before any git call', async () => {
    const executor = makeMockExecutor()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(
      run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--scope', 'cli', '--description', '']),
    ).rejects.toThrow()
    expect(vi.mocked(executor.stage)).not.toHaveBeenCalled()
    expect(vi.mocked(executor.commit)).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('accepts every semantic type', async () => {
    for (const type of semanticTypes) {
      const executor = makeMockExecutor()
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      await run(executor, ['commit', '--file', 'src/foo.ts', '--type', type, '--scope', 'cli', '--description', 'add thing'])
      expect(vi.mocked(executor.commit)).toHaveBeenCalledOnce()
      output.mockRestore()
    }
  })
})

describe('git commit message assembly from the command layer (KAN-29)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('AI_AGENT', '')
  })

  it('assembles the exact message for --body, repeated --footer, and --model', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(executor, [
      'commit',
      '--file', 'src/foo.ts',
      '--type', 'feat',
      '--scope', 'cli',
      '--description', 'add thing',
      '--body', 'because reasons',
      '--footer', 'Reviewed-By: alice',
      '--footer', 'Co-Authored-By: bob <bob@example.com>',
      '--model', 'claude-sonnet-5',
    ])
    expect(vi.mocked(executor.commit)).toHaveBeenCalledWith(
      'feat(cli): add thing\n\nbecause reasons\n\nReviewed-By: alice\nCo-Authored-By: bob <bob@example.com>\nFlight-Rules-Version: 1.2.3\nModel-Used: claude-sonnet-5',
      ['src/foo.ts'],
    )
    output.mockRestore()
  })

  it('omits the body section and optional trailers when not provided', async () => {
    const executor = makeMockExecutor()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'fix', '--scope', 'core', '--description', 'fix bug'])
    expect(vi.mocked(executor.commit)).toHaveBeenCalledWith('fix(core): fix bug\n\nFlight-Rules-Version: 1.2.3', ['src/foo.ts'])
    output.mockRestore()
  })

  it('prints a single JSON line with sha and the full message', async () => {
    const executor = makeMockExecutor()
    const writes: string[] = []
    const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    await run(executor, ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--scope', 'cli', '--description', 'add thing'])
    expect(writes).toHaveLength(1)
    const line = writes[0] ?? ''
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line) as { sha: string; message: string }
    expect(parsed.sha).toBe('abc123')
    expect(parsed.message).toBe('feat(cli): add thing\n\nFlight-Rules-Version: 1.2.3')
    output.mockRestore()
  })
})
