import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GitExecutor } from '../../../git-executor/git-executor.js'
import { createGitCommand } from '../command.js'

const makeMockExecutor = (): GitExecutor => ({
  stage: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getCommitSha: vi.fn().mockResolvedValue('abc123'),
  checkout: vi.fn().mockResolvedValue('feat/25-saw'),
  getCurrentBranch: vi.fn().mockResolvedValue('feat/25-saw'),
  push: vi.fn().mockResolvedValue(undefined),
})

const run = async (executor: GitExecutor, args: string[]): Promise<string> => {
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  await createGitCommand(() => executor).parseAsync(args, { from: 'user' })
  output.mockRestore()
  const [message] = vi.mocked(executor.commit).mock.calls[0] ?? []
  return message ?? ''
}

const base = ['commit', '--file', 'src/foo.ts', '--type', 'feat', '--scope', 'KAN-1', '--description', 'add thing']

describe('git commit --body-file', () => {
  let dir: string

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('AI_AGENT', '')
    dir = mkdtempSync(join(tmpdir(), 'fr-commit-body-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('puts a multi-paragraph markdown body between the subject and the trailers', async () => {
    const body = '## Why\n\nThe old path dropped data.\n\n- first point\n- second point\n\n```ts\nconst x = 1\n```\n'
    const bodyFile = join(dir, 'body.md')
    writeFileSync(bodyFile, body)

    const message = await run(makeMockExecutor(), [...base, '--body-file', bodyFile, '--footer', 'Refs: KAN-1'])

    expect(message).toMatch(
      /^feat\(KAN-1\): add thing\n\n## Why\n\nThe old path dropped data\.\n\n- first point\n- second point\n\n```ts\nconst x = 1\n```\n\nRefs: KAN-1\nFlight-Rules-Version: /,
    )
  })

  it('prefers --body-file over --body', async () => {
    const bodyFile = join(dir, 'body.md')
    writeFileSync(bodyFile, 'from the file')

    const message = await run(makeMockExecutor(), [...base, '--body', 'inline', '--body-file', bodyFile])

    expect(message).toContain('\n\nfrom the file\n\n')
    expect(message).not.toContain('inline')
  })

  it('fails before staging when the body file does not exist', async () => {
    const executor = makeMockExecutor()
    await expect(
      createGitCommand(() => executor).parseAsync([...base, '--body-file', join(dir, 'missing.md')], { from: 'user' }),
    ).rejects.toThrow(/ENOENT/)
    expect(vi.mocked(executor.stage)).not.toHaveBeenCalled()
  })
})
