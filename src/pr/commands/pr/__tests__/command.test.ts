import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type {
  CreatedPullRequest,
  OpenPullRequest,
  PullRequestComment,
  PullRequestHost,
  ReviewerRequestResult,
} from '../../../pull-request-host/pull-request-host.js'
import { createPrCommand } from '../command.js'

const makeMockHost = (
  created: CreatedPullRequest = { number: 7, url: 'https://github.com/o/r/pull/7' },
  comment: PullRequestComment = { url: 'https://github.com/o/r/pull/7#issuecomment-1' },
): PullRequestHost => ({
  createPullRequest: vi.fn().mockResolvedValue(created),
  commentOnPullRequest: vi.fn().mockResolvedValue(comment),
  listOpenPullRequestsForTickets: vi.fn().mockResolvedValue([]),
  defaultBranch: vi.fn().mockResolvedValue('main'),
  requestReviewers: vi.fn().mockResolvedValue({ number: 7, requested: [], failed: [] }),
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

describe('pr list command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes every --ticket to the host and prints the matches as one JSON line', async () => {
    const host = makeMockHost()
    const matches: OpenPullRequest[] = [
      {
        ticket: '42',
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        headRefName: 'feat/42-x',
        baseRefName: 'main',
        title: 'feat(42): x',
      },
    ]
    vi.mocked(host.listOpenPullRequestsForTickets).mockResolvedValue(matches)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, ['list', '--ticket', '42', '--ticket', '43'])
    expect(vi.mocked(host.listOpenPullRequestsForTickets)).toHaveBeenCalledWith(['42', '43'])
    expect(output).toHaveBeenCalledWith(JSON.stringify(matches) + '\n')
    output.mockRestore()
  })
})

describe('pr required values and strict numbers', () => {
  beforeEach(() => vi.clearAllMocks())

  const quietly = async (host: PullRequestHost, args: string[]) => {
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      return await run(host, args).then(
        () => undefined,
        (err: unknown) => err,
      )
    } finally {
      errOutput.mockRestore()
    }
  }

  it('pr list without --ticket exits 1 and calls no host method', async () => {
    const host = makeMockHost()
    const error = await quietly(host, ['list'])
    expect(error).toBeInstanceOf(CommanderError)
    expect((error as CommanderError).exitCode).toBe(1)
    expect(vi.mocked(host.listOpenPullRequestsForTickets)).not.toHaveBeenCalled()
  })

  it('pr request-review without --reviewer exits 1 and calls no host method', async () => {
    const host = makeMockHost()
    const error = await quietly(host, ['request-review', '5'])
    expect(error).toBeInstanceOf(CommanderError)
    expect((error as CommanderError).exitCode).toBe(1)
    expect(vi.mocked(host.requestReviewers)).not.toHaveBeenCalled()
  })

  it.each(['', '0', '-1', '0x3', '1e2', '1.5', 'abc'])('rejects the PR number %j before any request', async (value) => {
    const host = makeMockHost()
    expect(await quietly(host, ['request-review', value, '--reviewer', 'alice'])).toBeInstanceOf(CommanderError)
    expect(await quietly(host, ['comment', value, '--body', 'x'])).toBeInstanceOf(CommanderError)
    expect(vi.mocked(host.requestReviewers)).not.toHaveBeenCalled()
    expect(vi.mocked(host.commentOnPullRequest)).not.toHaveBeenCalled()
  })

  it('accepts a plain decimal PR number', async () => {
    const host = makeMockHost()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, ['request-review', '105', '--reviewer', 'alice'])
    expect(vi.mocked(host.requestReviewers)).toHaveBeenCalledWith(105, ['alice'])
    output.mockRestore()
  })
})

describe('pr request-review command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prints the per-login result and resolves when nothing failed', async () => {
    const host = makeMockHost()
    const result: ReviewerRequestResult = { number: 7, requested: ['alice', 'bob'], failed: [] }
    vi.mocked(host.requestReviewers).mockResolvedValue(result)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(host, ['request-review', '7', '--reviewer', 'alice', '--reviewer', 'bob'])
    expect(vi.mocked(host.requestReviewers)).toHaveBeenCalledWith(7, ['alice', 'bob'])
    expect(output).toHaveBeenCalledWith(JSON.stringify(result) + '\n')
    output.mockRestore()
  })

  it('prints the result and then rejects when any login failed', async () => {
    const host = makeMockHost()
    const result: ReviewerRequestResult = {
      number: 7,
      requested: ['alice'],
      failed: [{ login: 'bob', error: 'not a collaborator' }],
    }
    vi.mocked(host.requestReviewers).mockResolvedValue(result)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(run(host, ['request-review', '7', '--reviewer', 'alice', '--reviewer', 'bob'])).rejects.toThrow(
      'reviewer request failed for: bob',
    )
    expect(output).toHaveBeenCalledWith(JSON.stringify(result) + '\n')
    output.mockRestore()
  })
})
