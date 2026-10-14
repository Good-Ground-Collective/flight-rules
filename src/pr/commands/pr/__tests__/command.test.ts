import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CommanderError } from 'commander'
import type {
  CreatedPullRequest,
  OpenPullRequest,
  PullRequestComment,
  PullRequestHost,
  ReviewerRequestResult,
} from '../../../pull-request-host/pull-request-host.js'
import { createPrCommand } from '../command.js'
import { GhPullRequestHost } from '../../../pull-request-host/gh-pull-request-host.js'
import { DefaultPrOperations } from '../../../../operations/pr-operations.js'
import { LaunchOperationAccessPolicy, MapOperationRegistry } from '../../../../operations/operation-registry.js'

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

const testCwd = dirname(fileURLToPath(import.meta.url))
const registryFor = (host: PullRequestHost, allowedEffects: Array<'read' | 'write' | 'network' | 'process'> = ['read', 'write', 'network', 'process']) =>
  new MapOperationRegistry({
    operations: new DefaultPrOperations({ cwd: testCwd, getHost: () => host }).operations(),
    policy: new LaunchOperationAccessPolicy({ allowedEffects }),
  })
const run = (host: PullRequestHost, args: string[]) =>
  createPrCommand(registryFor(host)).parseAsync(args, { from: 'user' })

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

const processFixture = (stdout: string, failedReviewer?: string) => {
  const calls: [string, readonly string[]][] = []
  const bodies: Buffer[] = []
  const execFileFn = vi.fn(async (file: string, args: readonly string[]) => {
    calls.push([file, [...args]])
    const bodyIndex = args.indexOf('--body-file')
    if (bodyIndex !== -1) {
      const path = args[bodyIndex + 1]
      if (path === undefined) throw new Error('Missing body file path')
      bodies.push(await readFile(path))
    }
    if (failedReviewer !== undefined && args.at(-1) === failedReviewer) {
      throw Object.assign(new Error('Reviewer request failed'), { stderr: 'not a collaborator\nmore details' })
    }
    return { stdout, stderr: '' }
  })
  const host = new GhPullRequestHost({ repo: 'o/r', cwd: testCwd, execFileFn })
  return { host, calls, bodies }
}

const invokeTransport = (
  transport: 'commander' | 'shared',
  host: PullRequestHost,
  args: string[],
  id: string,
  input: unknown,
) => {
  const registry = registryFor(host)
  return transport === 'commander'
    ? createPrCommand(registry).parseAsync(args, { from: 'user' })
    : registry.invoke(id, input)
}

describe.each(['commander', 'shared'] as const)('PR process parity through %s', (transport) => {
  beforeEach(() => vi.spyOn(process.stdout, 'write').mockImplementation(() => true))
  afterEach(() => vi.restoreAllMocks())

  it('preserves the complete create argv and exact UTF-8 template body with repeated options', async () => {
    const { host, calls, bodies } = processFixture('https://github.com/o/r/pull/7\n')
    const what = ['Preserve café and trailing spaces.  ', 'Keep `literal` $text.'] as const
    const why = 'Reason one.\r\n  Reason two.  \n'
    const ots = '```json\r\n{"label":"café"}\r\n```'
    const attach = ['./fixtures/before.png#Before café', './fixtures/after.png#After'] as const
    await invokeTransport(transport, host, [
      ...baseArgs.slice(0, 7),
      '--why', why, '--what', what[0], '--what', what[1],
      '--base', 'main', '--head', 'feat/KAN-31-pr-create-command',
      '--ots', ots, '--ticket-id', 'KAN-31', '--ticket-url', 'https://example.com/KAN-31',
      '--label', 'wave-1', '--label', 'wave-2',
      '--attach', attach[0], '--attach', attach[1],
      '--reviewer', 'alice', '--reviewer', 'carol',
    ], 'pr-create', {
      type: 'feat', scope: 'KAN-31', description: 'add pr create', why, what,
      base: 'main', head: 'feat/KAN-31-pr-create-command', ots,
      ticketId: 'KAN-31', ticketUrl: 'https://example.com/KAN-31',
      reviewer: ['alice', 'carol'], label: ['wave-1', 'wave-2'], attach,
    })

    expect(calls).toEqual([
      ['gh', [
        'pr', 'create', '--repo', 'o/r', '--base', 'main',
        '--head', 'feat/KAN-31-pr-create-command', '--title', 'feat(KAN-31): add pr create',
        '--body-file', expect.stringMatching(/[/\\]body\.md$/),
        '--label', 'wave-1', '--label', 'wave-2',
        '--attach', './fixtures/before.png#Before café', '--attach', './fixtures/after.png#After',
      ]],
      ['gh', ['pr', 'edit', 'https://github.com/o/r/pull/7', '--add-reviewer', 'alice']],
      ['gh', ['pr', 'edit', 'https://github.com/o/r/pull/7', '--add-reviewer', 'carol']],
    ])
    expect(bodies).toEqual([Buffer.from(
      '## What Was Changed\n\n- Preserve café and trailing spaces.  \n- Keep `literal` $text.\n\n' +
      '## Why Was It Changed\n\nReason one.\r\n  Reason two.  \n\n\n' +
      '## OTS Materials\n\n<details><summary>Click to expand</summary>\n\n' +
      '```json\r\n{"label":"café"}\r\n```\n\n</details>\n\n' +
      '## Ticket Link\n\n- [KAN-31](https://example.com/KAN-31)', 'utf8',
    )])
  })

  it('preserves the complete comment argv and exact body bytes with repeated attachments', async () => {
    const { host, calls, bodies } = processFixture('https://github.com/o/r/pull/42#issuecomment-1\n')
    const body = 'café\r\n  `literal` $text  \n\n'
    const attach = ['./fixtures/clip.webm#Clip', './fixtures/after.png#After'] as const
    await invokeTransport(transport, host, [
      'comment', '42', '--body', body,
      '--attach', attach[0], '--attach', attach[1],
    ], 'pr-comment', { number: 42, body, attach })

    expect(calls).toEqual([['gh', [
      'pr', 'comment', '42', '--repo', 'o/r',
      '--body-file', expect.stringMatching(/[/\\]body\.md$/),
      '--attach', './fixtures/clip.webm#Clip', '--attach', './fixtures/after.png#After',
    ]]])
    expect(bodies).toEqual([Buffer.from(body, 'utf8')])
  })

  it('preserves the complete list argv for repeated ticket IDs', async () => {
    const { host, calls, bodies } = processFixture('[]')
    await invokeTransport(transport, host, ['list', '--ticket', 'KAN-31', '--ticket', 'KAN-32'],
      'pr-list', { ticket: ['KAN-31', 'KAN-32'] })

    expect(calls).toEqual([['gh', [
      'pr', 'list', '--repo', 'o/r', '--state', 'open', '--limit', '200',
      '--json', 'number,url,headRefName,baseRefName,title',
    ]]])
    expect(bodies).toEqual([])
  })

  it('preserves every reviewer argv and partial outcome without retrying a failed write', async () => {
    const { host, calls, bodies } = processFixture('', 'bob')
    const invocation = invokeTransport(transport, host, [
      'request-review', '7', '--reviewer', 'alice', '--reviewer', 'bob', '--reviewer', 'carol',
    ], 'pr-request-review', { number: 7, reviewer: ['alice', 'bob', 'carol'] })
    const result = {
      number: 7, requested: ['alice', 'carol'],
      failed: [{ login: 'bob', error: 'not a collaborator' }],
    }
    if (transport === 'commander') {
      await expect(invocation).rejects.toThrow('reviewer request failed for: bob')
      expect(process.stdout.write).toHaveBeenCalledWith(JSON.stringify(result) + '\n')
    } else {
      await expect(invocation).resolves.toEqual({
        status: 'partial', data: result,
        error: { name: 'ReviewerRequestPartialFailure', message: 'reviewer request failed for: bob' },
      })
    }

    expect(calls).toEqual([
      ['gh', ['pr', 'edit', '7', '--repo', 'o/r', '--add-reviewer', 'alice']],
      ['gh', ['pr', 'edit', '7', '--repo', 'o/r', '--add-reviewer', 'bob']],
      ['gh', ['pr', 'edit', '7', '--repo', 'o/r', '--add-reviewer', 'carol']],
    ])
    expect(bodies).toEqual([])
  })
})

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
    await run(host, [...baseArgs, '--attach', './fixtures/before.png#Before', '--attach', './fixtures/after.png#After'])
    expect(vi.mocked(host.createPullRequest)).toHaveBeenCalledWith(expect.anything(), {
      attach: ['./fixtures/before.png#Before', './fixtures/after.png#After'],
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
    await run(host, ['comment', '42', '--body', 'see clip', '--attach', './fixtures/clip.webm#Clip'])
    expect(vi.mocked(host.commentOnPullRequest)).toHaveBeenCalledWith(42, 'see clip', { attach: ['./fixtures/clip.webm#Clip'] })
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
