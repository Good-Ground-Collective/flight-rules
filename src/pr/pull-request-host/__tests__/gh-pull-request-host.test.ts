import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PullRequestTemplate } from '../../../git/pr-template/pr-template.js'
import { FindingRecordSchema } from '../../../code-review/review.schema.js'
import { JsonReviewCodec } from '../../../code-review/review-codec.js'
import { GhPullRequestHost } from '../gh-pull-request-host.js'

type ExecFileFn = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const template: PullRequestTemplate = {
  type: 'feat',
  scope: 'KAN-31',
  description: 'add pr create',
  whatWasChanged: ['a'],
  whyWasItChanged: 'Adds the command.',
  baseBranch: 'main',
  headBranch: 'feat/KAN-31-pr-create-command',
  reviewers: [],
  labels: [],
}

const bodyFileArg = (args: readonly string[]): string => {
  const index = args.indexOf('--body-file')
  const path = args[index + 1]
  if (path === undefined) throw new Error('--body-file not found in args')
  return path
}

describe('GhPullRequestHost.createPullRequest', () => {
  let execFileFn: ExecFileFn & ReturnType<typeof vi.fn>
  let calls: [string, readonly string[]][]
  let bodyFileContents: string[]

  beforeEach(() => {
    calls = []
    bodyFileContents = []
    execFileFn = vi.fn(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      const bodyFileIndex = args.indexOf('--body-file')
      if (bodyFileIndex !== -1) {
        const path = args[bodyFileIndex + 1]
        if (path !== undefined) bodyFileContents.push(await readFile(path, 'utf8'))
      }
      return { stdout: 'https://github.com/o/r/pull/42\n', stderr: '' }
    })
  })

  it('invokes gh pr create with repo, base, head, title, and a body-file holding the rendered body', async () => {
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    const result = await host.createPullRequest(template)

    const [file, args] = calls[0] as [string, readonly string[]]
    expect(file).toBe('gh')
    expect(args).toEqual([
      'pr', 'create',
      '--repo', 'o/r',
      '--base', 'main',
      '--head', 'feat/KAN-31-pr-create-command',
      '--title', 'feat(KAN-31): add pr create',
      '--body-file', bodyFileArg(args),
    ])
    expect(bodyFileContents).toEqual([
      '## What Was Changed\n\n- a\n\n## Why Was It Changed\n\nAdds the command.',
    ])

    expect(result).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42' })
  })

  it('removes the temp body file after the call completes', async () => {
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await host.createPullRequest(template)

    const bodyFile = bodyFileArg((calls[0] as [string, readonly string[]])[1])
    await expect(readFile(bodyFile, 'utf8')).rejects.toThrow()
  })

  it('passes --label as a repeated flag, in order', async () => {
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await host.createPullRequest({ ...template, labels: ['wave-1', 'wave-2'] })

    const [, args] = calls[0] as [string, readonly string[]]
    const labelIndex = args.indexOf('--label')
    expect(args.slice(labelIndex, labelIndex + 4)).toEqual(['--label', 'wave-1', '--label', 'wave-2'])
  })

  it('passes --attach flags straight through to gh', async () => {
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await host.createPullRequest(template, { attach: ['./before.png#Before', './after.png#After'] })

    const [, args] = calls[0] as [string, readonly string[]]
    const attachIndex = args.indexOf('--attach')
    expect(args.slice(attachIndex, attachIndex + 4)).toEqual([
      '--attach', './before.png#Before',
      '--attach', './after.png#After',
    ])
  })

  it('requests each reviewer with a separate gh pr edit call after creation', async () => {
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await host.createPullRequest({ ...template, reviewers: ['alice', 'bob'] })

    expect(calls[1]).toEqual(['gh', ['pr', 'edit', 'https://github.com/o/r/pull/42', '--add-reviewer', 'alice']])
    expect(calls[2]).toEqual(['gh', ['pr', 'edit', 'https://github.com/o/r/pull/42', '--add-reviewer', 'bob']])
  })

  it('still resolves when a reviewer request fails (best-effort, e.g. a self-review)', async () => {
    execFileFn.mockImplementation(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      if (args[0] === 'pr' && args[1] === 'edit') throw new Error('cannot request review from the author')
      return { stdout: 'https://github.com/o/r/pull/42\n', stderr: '' }
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })

    await expect(host.createPullRequest({ ...template, reviewers: ['self'] })).resolves.toEqual({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
    })
  })

  it('skips reviewer calls when none are provided', async () => {
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await host.createPullRequest(template)
    expect(calls).toHaveLength(1)
  })

  it('returns the created PR when a partial upload leaves gh non-zero but the URL already printed', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    execFileFn.mockImplementation(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      const error: Error & { stdout?: string; stderr?: string } = new Error('gh: attachment upload failed')
      error.stdout = 'https://github.com/o/r/pull/42\n'
      error.stderr = 'failed to upload ./before.png'
      throw error
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })

    await expect(host.createPullRequest(template)).resolves.toEqual({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
    })
    expect(stderrSpy).toHaveBeenCalledWith('failed to upload ./before.png')
    stderrSpy.mockRestore()
  })

  it('rethrows when the failure carries no parseable PR URL', async () => {
    execFileFn.mockImplementation(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      const error: Error & { stdout?: string; stderr?: string } = new Error('gh: not authenticated')
      error.stdout = ''
      error.stderr = 'gh: not authenticated'
      throw error
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await expect(host.createPullRequest(template)).rejects.toThrow('gh: not authenticated')
  })

  it('rejects construction with a repo not shaped like owner/repo', () => {
    expect(() => new GhPullRequestHost({ repo: 'not-a-repo', execFileFn })).toThrow()
  })
})

describe('GhPullRequestHost.commentOnPullRequest', () => {
  it('invokes gh pr comment with the number, repo, a body-file, and attachments', async () => {
    const calls: [string, readonly string[]][] = []
    const bodyFileContents: string[] = []
    const execFileFn = vi.fn(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      const bodyFileIndex = args.indexOf('--body-file')
      if (bodyFileIndex !== -1) {
        const path = args[bodyFileIndex + 1]
        if (path !== undefined) bodyFileContents.push(await readFile(path, 'utf8'))
      }
      return { stdout: 'https://github.com/o/r/pull/42#issuecomment-1\n', stderr: '' }
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })

    const result = await host.commentOnPullRequest(42, 'comment body', { attach: ['./clip.webm'] })

    const [file, args] = calls[0] as [string, readonly string[]]
    expect(file).toBe('gh')
    expect(args).toEqual([
      'pr', 'comment', '42', '--repo', 'o/r',
      '--body-file', bodyFileArg(args), '--attach', './clip.webm',
    ])
    expect(bodyFileContents[0]).toBe('comment body')

    expect(result).toEqual({ url: 'https://github.com/o/r/pull/42#issuecomment-1' })
  })

  it('removes the temp body file after the call completes', async () => {
    const calls: [string, readonly string[]][] = []
    const execFileFn = vi.fn(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      return { stdout: 'https://github.com/o/r/pull/42\n', stderr: '' }
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    await host.commentOnPullRequest(42, 'comment body')

    const bodyFile = bodyFileArg((calls[0] as [string, readonly string[]])[1])
    await expect(readFile(bodyFile, 'utf8')).rejects.toThrow()
  })
})

const listArgs = [
  'pr', 'list',
  '--repo', 'o/r',
  '--state', 'open',
  '--limit', '200',
  '--json', 'number,url,headRefName,baseRefName,title',
]

const ghPr = (number: number, headRefName: string, title: string) => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  headRefName,
  baseRefName: 'main',
  title,
})

const listHost = (prs: unknown[]) => {
  const calls: [string, readonly string[]][] = []
  const execFileFn = vi.fn(async (file: string, args: readonly string[]) => {
    calls.push([file, args])
    return { stdout: JSON.stringify(prs), stderr: '' }
  })
  return { host: new GhPullRequestHost({ repo: 'o/r', execFileFn }), calls }
}

describe('GhPullRequestHost.listOpenPullRequestsForTickets', () => {
  it('runs one gh pr list with the exact argv', async () => {
    const { host, calls } = listHost([])
    await host.listOpenPullRequestsForTickets(['42', '43'])
    expect(calls).toEqual([['gh', listArgs]])
  })

  it('matches a head branch of <type>/<id> or <type>/<id>-slug', async () => {
    const { host } = listHost([ghPr(1, 'feat/42-add-thing', 'unrelated'), ghPr(2, 'fix/43', 'unrelated')])
    const result = await host.listOpenPullRequestsForTickets(['42', '43'])
    expect(result).toEqual([
      { ticket: '42', ...ghPr(1, 'feat/42-add-thing', 'unrelated') },
      { ticket: '43', ...ghPr(2, 'fix/43', 'unrelated') },
    ])
  })

  it('matches a title scope of (<id>) including a breaking-change bang', async () => {
    const { host } = listHost([ghPr(3, 'wip', 'feat(42): add thing'), ghPr(4, 'wip2', 'fix(42)!: break it')])
    const result = await host.listOpenPullRequestsForTickets(['42'])
    expect(result.map((r) => r.number)).toEqual([3, 4])
  })

  it('does not match a ticket id that is a prefix of another', async () => {
    const { host } = listHost([ghPr(1, 'feat/42-x', 'feat(42): x')])
    expect(await host.listOpenPullRequestsForTickets(['4'])).toEqual([])
  })

  it('returns every match when a ticket has more than one open PR', async () => {
    const { host } = listHost([ghPr(1, 'feat/42-a', 'feat(42): a'), ghPr(2, 'fix/42-b', 'fix(42): b')])
    const result = await host.listOpenPullRequestsForTickets(['42'])
    expect(result.map((r) => r.number)).toEqual([1, 2])
  })

  it('returns an empty array when nothing matches', async () => {
    const { host } = listHost([ghPr(1, 'feat/99-x', 'feat(99): x')])
    expect(await host.listOpenPullRequestsForTickets(['42'])).toEqual([])
  })

  it('treats regex metacharacters in the ticket id literally', async () => {
    const { host } = listHost([ghPr(1, 'feat/KAN-31-x', 'feat(KAN-31): x')])
    expect(await host.listOpenPullRequestsForTickets(['K.N-31'])).toEqual([])
  })
})

describe('GhPullRequestHost.requestReviewers', () => {
  it('attempts every login with the exact argv and reports each outcome', async () => {
    const calls: [string, readonly string[]][] = []
    const execFileFn = vi.fn(async (file: string, args: readonly string[]) => {
      calls.push([file, args])
      if (args.includes('bob')) {
        const error: Error & { stderr?: string } = new Error('Command failed')
        error.stderr = 'bob is not a collaborator\nsecond line'
        throw error
      }
      return { stdout: '', stderr: '' }
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })

    const result = await host.requestReviewers(7, ['alice', 'bob', 'carol'])

    expect(calls).toEqual([
      ['gh', ['pr', 'edit', '7', '--repo', 'o/r', '--add-reviewer', 'alice']],
      ['gh', ['pr', 'edit', '7', '--repo', 'o/r', '--add-reviewer', 'bob']],
      ['gh', ['pr', 'edit', '7', '--repo', 'o/r', '--add-reviewer', 'carol']],
    ])
    expect(result).toEqual({
      number: 7,
      requested: ['alice', 'carol'],
      failed: [{ login: 'bob', error: 'bob is not a collaborator' }],
    })
  })

  it('falls back to the error message when stderr is absent', async () => {
    const execFileFn = vi.fn(async () => {
      throw new Error('boom')
    })
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    const result = await host.requestReviewers(7, ['alice'])
    expect(result.failed).toEqual([{ login: 'alice', error: 'boom' }])
  })
})

describe('GhPullRequestHost.defaultBranch', () => {
  it('uses a snapshot of the launch environment for subprocesses', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flight-rules-gh-env-'))
    try {
      const gh = join(directory, 'gh')
      await writeFile(gh, '#!/bin/sh\nprintf "%s" "$FR_FIXTURE"\n')
      await chmod(gh, 0o755)
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        FR_FIXTURE: 'launch',
      }
      const host = new GhPullRequestHost({ repo: 'o/r', cwd: directory, env })
      env.FR_FIXTURE = 'mutated'

      await expect(host.defaultBranch()).resolves.toBe('launch')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reads the default branch name through gh repo view', async () => {
    const execFileFn = vi.fn(async () => ({ stdout: 'main\n', stderr: '' }))
    const host = new GhPullRequestHost({ repo: 'o/r', execFileFn })
    expect(await host.defaultBranch()).toBe('main')
    expect(execFileFn).toHaveBeenCalledWith('gh', expect.arrayContaining(['repo', 'view', 'o/r', 'defaultBranchRef']))
  })
})

const findingRecord = FindingRecordSchema.parse({
  v: 1,
  schema_revision: 1,
  finding: {
    id: 'f-0000000001',
    path: 'src/a.ts',
    line: 3,
    label: 'issue',
    type: 'fix',
    blocking: true,
    severity: 'major',
    subject: 'Scope the query',
    discussion: 'Records can cross tenants.',
    details: 'Filter on tenantId.',
    resolved_when: 'The query is scoped.',
  },
  status: 'open',
  evidence: [],
})
const marker = new JsonReviewCodec().finding(findingRecord)

const commentNode = (id: string, login: string | null, body: string, typename = 'User') => ({
  id,
  url: `https://github.com/o/r/pull/9#discussion_${id}`,
  body,
  createdAt: '2026-01-01T00:00:00Z',
  author: login === null ? null : { type: typename, login },
})

const threadNode = (id: string, comments: ReturnType<typeof commentNode>[], extra: Record<string, unknown> = {}, totalCount = comments.length) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'src/a.ts',
  line: 3,
  originalLine: 3,
  comments: { totalCount, nodes: comments },
  ...extra,
})

const page = (nodes: unknown[], endCursor: string | null) =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number: 9,
          url: 'https://github.com/o/r/pull/9',
          title: 'feat: x',
          body: 'PR body',
          headRefName: 'feat/x',
          headRefOid: 'abc123',
          baseRefName: 'main',
          author: { login: 'dev' },
          reviewThreads: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes },
        },
      },
    },
  })

describe('GhPullRequestHost.listReviewThreads', () => {
  const hostFor = (pages: string[]) => {
    const calls: (readonly string[])[] = []
    const execFileFn = vi.fn(async (_file: string, args: readonly string[]) => {
      calls.push(args)
      return { stdout: pages[calls.length - 1] ?? '', stderr: '' }
    })
    return { host: new GhPullRequestHost({ repo: 'o/r', execFileFn }), calls }
  }

  it('merges two pages, sends the cursor only on the second, and returns the first page header', async () => {
    const { host, calls } = hostFor([
      page([threadNode('T1', [commentNode('C1', 'alice', 'one')])], 'CUR1'),
      page([threadNode('T2', [commentNode('C2', 'bob', 'two')], { isResolved: true })], null),
    ])
    const result = await host.listReviewThreads(9, { trustedAuthors: [] })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.slice(0, 3)).toEqual(['api', 'graphql', '-f'])
    expect(calls[0]?.slice(4)).toEqual(['-f', 'owner=o', '-f', 'name=r', '-F', 'number=9'])
    expect(calls[0]?.[3]).toMatch(/^query=query\(/)
    expect(calls[1]?.slice(4)).toEqual(['-f', 'owner=o', '-f', 'name=r', '-F', 'number=9', '-f', 'endCursor=CUR1'])
    expect(result.pullRequest).toEqual({
      number: 9,
      url: 'https://github.com/o/r/pull/9',
      title: 'feat: x',
      body: 'PR body',
      headRefName: 'feat/x',
      headRefOid: 'abc123',
      baseRefName: 'main',
      authorLogin: 'dev',
    })
    expect(result.threads.map((t) => [t.id, t.isResolved])).toEqual([['T1', false], ['T2', true]])
  })

  it('keeps a null line on an outdated thread, strips [bot], and flags truncated comments', async () => {
    const { host } = hostFor([
      page(
        [
          threadNode(
            'T1',
            [commentNode('C1', 'coderabbit[bot]', 'hi', 'Bot'), commentNode('C2', 'alice', 'reply')],
            { line: null, isOutdated: true, originalLine: 7 },
            150,
          ),
          threadNode('T2', [commentNode('C3', null, 'orphan')]),
        ],
        null,
      ),
    ])
    const { threads } = await host.listReviewThreads(9, { trustedAuthors: [] })

    expect(threads[0]).toMatchObject({ line: null, originalLine: 7, isOutdated: true, commentsTruncated: true })
    expect(threads[0]?.comments[0]).toMatchObject({ authorLogin: 'coderabbit', authorType: 'Bot' })
    expect(threads[0]?.comments[1]).toMatchObject({ authorLogin: 'alice', authorType: 'User' })
    expect(threads[1]).toMatchObject({ commentsTruncated: false })
    expect(threads[1]?.comments[0]).toMatchObject({ authorLogin: 'ghost', authorType: 'User' })
  })

  it('parses a marker only from a trusted root comment', async () => {
    const body = `Please fix.\n${marker}`
    const { host } = hostFor([
      page(
        [
          threadNode('trusted', [commentNode('C1', 'reviewer[bot]', body, 'Bot')]),
          threadNode('untrusted', [commentNode('C2', 'mallory', body)]),
          threadNode('reply', [commentNode('C3', 'alice', 'plain'), commentNode('C4', 'reviewer[bot]', body, 'Bot')]),
        ],
        null,
      ),
    ])
    const { threads } = await host.listReviewThreads(9, { trustedAuthors: ['reviewer'] })

    expect(threads.map((t) => [t.id, t.finding === null ? null : t.finding.finding.id, t.markerError])).toEqual([
      ['trusted', 'f-0000000001', null],
      ['untrusted', null, null],
      ['reply', null, null],
    ])
  })

  it('parses nothing when no author is trusted', async () => {
    const { host } = hostFor([page([threadNode('T1', [commentNode('C1', 'reviewer', marker)])], null)])
    const { threads } = await host.listReviewThreads(9, { trustedAuthors: [] })
    expect(threads[0]).toMatchObject({ finding: null, markerError: null })
  })

  it('reports a malformed marker on its own thread without failing the call', async () => {
    const { host } = hostFor([
      page(
        [
          threadNode('bad', [commentNode('C1', 'reviewer', '<!-- code-review:finding {not json} -->')]),
          threadNode('good', [commentNode('C2', 'reviewer', marker)]),
        ],
        null,
      ),
    ])
    const { threads } = await host.listReviewThreads(9, { trustedAuthors: ['reviewer'] })

    expect(threads[0]?.finding).toBeNull()
    expect(threads[0]?.markerError).toContain('invalid JSON')
    expect(threads[1]?.finding?.finding.id).toBe('f-0000000001')
    expect(threads[1]?.markerError).toBeNull()
  })
})
