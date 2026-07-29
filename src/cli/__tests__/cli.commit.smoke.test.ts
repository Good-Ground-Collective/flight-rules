import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// KAN-29: drives `git commit` end-to-end through the built binary against a
// scratch git repository. Requires `npm run build` to have run first, like
// cli.smoke.test.ts — source changes are invisible here until rebuilt.
const bundle = fileURLToPath(new URL('../../../bin/flight-rules.mjs', import.meta.url))
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
) as { version: string }

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

describe('git commit smoke test against a scratch repo', () => {
  let scratch: string

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'flight-rules-commit-smoke-'))
    git(scratch, ['init', '-q'])
    git(scratch, ['config', 'user.name', 'Smoke Test'])
    git(scratch, ['config', 'user.email', 'smoke@example.com'])
    git(scratch, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(scratch, 'file.txt'), 'hello\n')
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('commits with the exact assembled message and prints { sha, message } JSON', () => {
    const stdout = execFileSync(
      'node',
      [
        bundle,
        'git', 'commit',
        '--file', 'file.txt',
        '--type', 'feat',
        '--scope', 'KAN-29',
        '--description', 'smoke test commit',
        '--body', 'exercises the built binary end-to-end',
        '--footer', 'Reviewed-By: alice',
        '--model', 'test-model',
      ],
      { cwd: scratch, encoding: 'utf8', env: { ...process.env, AI_AGENT: '' } },
    )

    const parsed = JSON.parse(stdout) as { sha: string; message: string }
    expect(parsed.sha).toMatch(/^[0-9a-f]{7,40}$/)
    expect(parsed.message).toBe(
      `feat(KAN-29): smoke test commit\n\nexercises the built binary end-to-end\n\nReviewed-By: alice\nFlight-Rules-Version: ${pkg.version}\nModel-Used: test-model`,
    )

    const logged = git(scratch, ['log', '-1', '--format=%B']).trimEnd()
    expect(logged).toBe(parsed.message)
  })

  it('exits non-zero on an invalid --type and creates no commit', () => {
    expect(() =>
      execFileSync(
        'node',
        [
          bundle,
          'git', 'commit',
          '--file', 'file.txt',
          '--type', 'bogus',
          '--scope', 'KAN-29',
          '--description', 'should never land',
        ],
        { cwd: scratch, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, AI_AGENT: '' } },
      ),
    ).toThrow()

    // no commit may exist — rev-parse fails on a repo with no HEAD commit
    expect(() => git(scratch, ['rev-parse', 'HEAD'])).toThrow()
  })
})
