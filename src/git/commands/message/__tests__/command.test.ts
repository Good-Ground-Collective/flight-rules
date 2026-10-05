import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitGuard } from '../../../../hooks/commit-guard/commit-guard.js'
import { createBranchNameCommand, createCommitMessageCommand } from '../command.js'

describe('commit-message and branch-name', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fr-message-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const lastJson = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
    JSON.parse(String(spy.mock.calls.at(-1)?.[0])) as Record<string, unknown>

  it('writes the conventional message with trailers to --out and prints it', async () => {
    const body = join(dir, 'body.md')
    writeFileSync(body, 'Why it changed.\n')
    const out = join(dir, 'msg.txt')
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await createCommitMessageCommand().parseAsync(
      ['--type', 'feat', '--scope', 'FRT-1', '--description', 'add thing', '--body-file', body, '--out', out],
      { from: 'user' },
    )
    const written = readFileSync(out, 'utf8')
    expect(written).toMatch(/^feat\(FRT-1\): add thing\n\nWhy it changed\.\n\n/)
    expect(written).toMatch(/^Flight-Rules-Version: /m)
    expect(lastJson(output)).toMatchObject({ path: out })
  })

  it('writes to a fresh temp file when --out is omitted', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await createCommitMessageCommand().parseAsync(['--type', 'fix', '--scope', 'FRT-9', '--description', 'fix thing'], { from: 'user' })
    const path = String(lastJson(output)['path'])
    expect(readFileSync(path, 'utf8')).toContain('fix(FRT-9): fix thing')
  })

  it('prints the branch name without running git', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await createBranchNameCommand().parseAsync(['--type', 'feat', '--scope', 'FRT-1', '--description', 'thing'], { from: 'user' })
    expect(lastJson(output)).toEqual({ branch: 'feat/FRT-1-thing' })
  })

  it('rejects an invalid branch type', async () => {
    await expect(
      createBranchNameCommand().parseAsync(['--type', 'nope', '--scope', 'x'], { from: 'user' }),
    ).rejects.toThrow('invalid branch type')
  })

  describe('the commit guard', () => {
    const guard = new CommitGuard({ isConfigured: () => true, env: {} })
    const bash = (command: string): unknown => ({ tool_name: 'Bash', tool_input: { command }, cwd: dir })

    it('allows a commit whose -F file came from commit-message', async () => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      await createCommitMessageCommand().parseAsync(
        ['--type', 'feat', '--scope', 'FRT-8', '--description', 'add guard test', '--out', join(dir, 'm.txt')],
        { from: 'user' },
      )
      expect(guard.decide(bash('git commit -F m.txt --only -- a.ts'))).toBeUndefined()
      expect(guard.decide(bash(`git commit --file=${join(dir, 'm.txt')}`))).toBeUndefined()
    })

    it('still denies a hand-written -F file or a stdin message', () => {
      writeFileSync(join(dir, 'hand.txt'), 'feat: by hand\n')
      expect(guard.decide(bash('git commit -F hand.txt'))).toBeDefined()
      expect(guard.decide(bash('git commit -F missing.txt'))).toBeDefined()
      expect(guard.decide(bash('git commit -F -'))).toBeDefined()
    })
  })
})
