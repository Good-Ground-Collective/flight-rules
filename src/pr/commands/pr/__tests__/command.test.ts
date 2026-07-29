import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { CreatedPullRequest, PullRequestHost } from '../../../pull-request-host/pull-request-host.js'
import { createPrCommand } from '../command.js'

const makeMockHost = (created: CreatedPullRequest = { number: 7, url: 'https://github.com/o/r/pull/7' }): PullRequestHost => ({
  createPullRequest: vi.fn().mockResolvedValue(created),
})

const run = (host: PullRequestHost, args: string[]) =>
  createPrCommand(() => host).parseAsync(args, { from: 'user' })

const baseArgs = [
  'create',
  '--type', 'feat',
  '--scope', 'KAN-31',
  '--description', 'add pr create',
  '--summary', 'Adds the command.',
  '--base', 'main',
  '--head', 'feat/KAN-31-pr-create-command',
]

describe('pr create command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('validates options, calls the host, and prints the created PR as JSON', async () => {
    const host = makeMockHost()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, [...baseArgs, '--change', 'a', '--change', 'b', '--reviewer', 'alice', '--label', 'wave-1'])
    expect(vi.mocked(host.createPullRequest)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'feat',
        scope: 'KAN-31',
        description: 'add pr create',
        summary: 'Adds the command.',
        changes: ['a', 'b'],
        baseBranch: 'main',
        headBranch: 'feat/KAN-31-pr-create-command',
        reviewers: ['alice'],
        labels: ['wave-1'],
      }),
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"number":7') as string)
    output.mockRestore()
  })

  it('rejects an invalid --type before calling the host', async () => {
    const host = makeMockHost()
    await expect(run(host, [...baseArgs.slice(0, 2), 'bogus', ...baseArgs.slice(3)])).rejects.toThrow()
    expect(vi.mocked(host.createPullRequest)).not.toHaveBeenCalled()
  })

  it('rejects when a required option is missing', async () => {
    const host = makeMockHost()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(host, ['create', '--type', 'feat', '--scope', 'KAN-31'])).rejects.toThrow(CommanderError)
    expect(vi.mocked(host.createPullRequest)).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})
