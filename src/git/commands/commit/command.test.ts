import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { GitExecutor } from '../../git-executor/git-executor.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.2.3' })),
}))

const makeMockExecutor = (): GitExecutor => ({
  stage: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getCommitSha: vi.fn().mockResolvedValue('abc123'),
})

const run = (executor: GitExecutor, args: string[]) =>
  createGitCommand(() => executor).parseAsync(args, { from: 'user' })

let createGitCommand: typeof import('./command.js')['createGitCommand']
let buildCommitMessage: typeof import('./command.js')['buildCommitMessage']
let parseHarnessVersion: typeof import('./command.js')['parseHarnessVersion']

beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  const mod = await import('./command.js')
  createGitCommand = mod.createGitCommand
  buildCommitMessage = mod.buildCommitMessage
  parseHarnessVersion = mod.parseHarnessVersion
})

describe('buildCommitMessage', () => {
  it('builds subject + footers with no body', () => {
    const msg = buildCommitMessage({
      type: 'feat', scope: 'cli', description: 'add thing',
      footers: [], pluginVersion: '1.2.3', harnessVersion: undefined, model: undefined,
    })
    expect(msg).toBe('feat(cli): add thing\n\nFlight-Rules-Version: 1.2.3')
  })

  it('includes body between subject and footers', () => {
    const msg = buildCommitMessage({
      type: 'fix', scope: 'core', description: 'fix bug', body: 'extra context here',
      footers: [], pluginVersion: '1.2.3', harnessVersion: undefined, model: undefined,
    })
    expect(msg).toBe('fix(core): fix bug\n\nextra context here\n\nFlight-Rules-Version: 1.2.3')
  })

  it('appends Harness-Version after Flight-Rules-Version', () => {
    const msg = buildCommitMessage({
      type: 'feat', scope: 'cli', description: 'add thing',
      footers: [], pluginVersion: '1.2.3', harnessVersion: 'claude-code@2.1.165', model: undefined,
    })
    expect(msg).toContain('Flight-Rules-Version: 1.2.3\nHarness-Version: claude-code@2.1.165')
  })

  it('appends Model-Used last when provided', () => {
    const msg = buildCommitMessage({
      type: 'feat', scope: 'cli', description: 'add thing',
      footers: [], pluginVersion: '1.2.3', harnessVersion: undefined, model: 'claude-sonnet-4-6',
    })
    expect(msg.endsWith('Model-Used: claude-sonnet-4-6')).toBe(true)
  })

  it('omits Model-Used when model is undefined', () => {
    const msg = buildCommitMessage({
      type: 'feat', scope: 'cli', description: 'add thing',
      footers: [], pluginVersion: '1.2.3', harnessVersion: undefined, model: undefined,
    })
    expect(msg).not.toContain('Model-Used')
  })

  it('places caller footers before auto-generated footers', () => {
    const msg = buildCommitMessage({
      type: 'feat', scope: 'cli', description: 'add thing',
      footers: ['Reviewed-By: alice'], pluginVersion: '1.2.3', harnessVersion: undefined, model: undefined,
    })
    const reviewedIdx = msg.indexOf('Reviewed-By: alice')
    const versionIdx = msg.indexOf('Flight-Rules-Version')
    expect(reviewedIdx).toBeGreaterThan(-1)
    expect(reviewedIdx).toBeLessThan(versionIdx)
  })
})

describe('parseHarnessVersion', () => {
  it('parses claude-code_2-1-165_agent into claude-code@2.1.165', () => {
    expect(parseHarnessVersion('claude-code_2-1-165_agent')).toBe('claude-code@2.1.165')
  })
  it('returns undefined for undefined input', () => {
    expect(parseHarnessVersion(undefined)).toBeUndefined()
  })
  it('returns undefined for unrecognised format', () => {
    expect(parseHarnessVersion('something-weird')).toBeUndefined()
  })
})

describe('git commit command', () => {
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
