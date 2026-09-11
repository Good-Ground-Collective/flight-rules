import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { CreatedPullRequest, PullRequestComment, PullRequestHost } from '../../../pull-request-host/pull-request-host.js'
import { createPrCommand } from '../command.js'

const makeMockHost = (
  created: CreatedPullRequest = { number: 7, url: 'https://github.com/o/r/pull/7' },
  comment: PullRequestComment = { url: 'https://github.com/o/r/pull/7#issuecomment-1' },
): PullRequestHost => ({
  createPullRequest: vi.fn().mockResolvedValue(created),
  commentOnPullRequest: vi.fn().mockResolvedValue(comment),
})

const run = (host: PullRequestHost, args: string[]) =>
  createPrCommand(() => host).parseAsync(args, { from: 'user' })

const baseArgs = [
  'create',
  '--type', 'feat',
  '--scope', 'KAN-31',
  '--description', 'add pr create',
  '--why', 'The old PR bodies read as slop.',
  '--what', 'Added the pr create command.',
  '--base', 'main',
  '--head', 'feat/KAN-31-pr-create-command',
]

describe('pr create command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('validates options, calls the host, and prints the created PR as JSON', async () => {
    const host = makeMockHost()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, [
      ...baseArgs,
      '--what', 'Added a second bullet.',
      '--ots', '```json\n{}\n```',
      '--ticket-id', 'KAN-31',
      '--ticket-url', 'https://example.atlassian.net/browse/KAN-31',
      '--reviewer', 'alice',
      '--label', 'wave-1',
    ])
    expect(vi.mocked(host.createPullRequest)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'feat',
        scope: 'KAN-31',
        description: 'add pr create',
        whatWasChanged: ['Added the pr create command.', 'Added a second bullet.'],
        whyWasItChanged: 'The old PR bodies read as slop.',
        otsMaterials: '```json\n{}\n```',
        ticketId: 'KAN-31',
        ticketUrl: 'https://example.atlassian.net/browse/KAN-31',
        baseBranch: 'main',
        headBranch: 'feat/KAN-31-pr-create-command',
        reviewers: ['alice'],
        labels: ['wave-1'],
      }),
      { attach: [] },
    )
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"number":7') as string)
    output.mockRestore()
  })

  it('passes repeated --attach specs through to the host', async () => {
    const host = makeMockHost()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, [...baseArgs, '--attach', './before.png#Before', '--attach', './after.png#After'])
    expect(vi.mocked(host.createPullRequest)).toHaveBeenCalledWith(expect.anything(), {
      attach: ['./before.png#Before', './after.png#After'],
    })
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

describe('pr comment command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves the body from --body, calls the host, and prints the comment as JSON', async () => {
    const host = makeMockHost()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, ['comment', '42', '--body', 'looks good'])
    expect(vi.mocked(host.commentOnPullRequest)).toHaveBeenCalledWith(42, 'looks good', { attach: [] })
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"url":"https://github.com/o/r/pull/7#issuecomment-1"') as string,
    )
    output.mockRestore()
  })

  it('passes repeated --attach specs through to the host', async () => {
    const host = makeMockHost()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, ['comment', '42', '--body', 'see clip', '--attach', './clip.webm'])
    expect(vi.mocked(host.commentOnPullRequest)).toHaveBeenCalledWith(42, 'see clip', { attach: ['./clip.webm'] })
    output.mockRestore()
  })

  it('rejects when neither --body nor --body-file is given', async () => {
    const host = makeMockHost()
    await expect(run(host, ['comment', '42'])).rejects.toThrow()
    expect(vi.mocked(host.commentOnPullRequest)).not.toHaveBeenCalled()
  })
})
