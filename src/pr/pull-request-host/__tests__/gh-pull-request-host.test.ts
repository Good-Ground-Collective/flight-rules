import { readFile } from 'node:fs/promises'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PullRequestTemplate } from '../../../git/pr-template/pr-template.js'
import { GhPullRequestHost } from '../gh-pull-request-host.js'

type ExecFileFn = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const template: PullRequestTemplate = {
  type: 'feat',
  scope: 'KAN-31',
  description: 'add pr create',
  summary: 'Adds the command.',
  changes: ['a'],
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
    expect(args.slice(0, 2)).toEqual(['pr', 'create'])
    expect(args).toEqual(
      expect.arrayContaining([
        '--repo', 'o/r',
        '--base', 'main',
        '--head', 'feat/KAN-31-pr-create-command',
        '--title', 'feat(KAN-31): add pr create',
      ]),
    )
    expect(args).toContain('--body-file')
    expect(bodyFileContents[0]).toContain('Adds the command.')

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
    expect(args.slice(0, 3)).toEqual(['pr', 'comment', '42'])
    expect(args).toEqual(
      expect.arrayContaining(['--repo', 'o/r', '--body-file', bodyFileArg(args), '--attach', './clip.webm']),
    )
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
