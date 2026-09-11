import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NodeToolProbe } from '../tool-probe.js'

type ExecResult = { stdout: string; stderr: string }
type ExecCall = (file: string, args: readonly string[]) => Promise<ExecResult>

const notInstalled = (): Promise<never> => Promise.reject({ code: 'ENOENT', message: 'not found' })
const failed = (stderr: string): Promise<never> => Promise.reject({ code: 1, stderr })
const ok = (stdout: string): Promise<ExecResult> => Promise.resolve({ stdout, stderr: '' })

describe('NodeToolProbe', () => {
  let scratch: string

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'tool-probe-'))
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  const noRecipePath = (): string => join(scratch, 'no-such-recipe.md')
  const writeRecipe = (content: string): string => {
    const recipePath = join(scratch, 'flight-rules.qa.md')
    writeFileSync(recipePath, content)
    return recipePath
  }

  const allInstalled: ExecCall = (file, args) => {
    if (file === 'gh' && args[0] === '--version') return ok('gh version 2.99.0 (2026-09-01)\n')
    if (file === 'gh' && args[0] === 'auth') return ok('Logged in to github.com\n')
    if (file === 'gh' && args[0] === 'api') return ok('true\n')
    if (file === 'playwright-cli') return ok('1.0.0\n')
    if (file === 'ffmpeg') return ok('ffmpeg version 6.0\n')
    if (file === 'curl') return ok('curl 8.0.0\n')
    if (file === 'op' && args[0] === '--version') return ok('2.0.0\n')
    if (file === 'op' && args[0] === 'whoami') return ok('{"email":"me@acme.com"}\n')
    return notInstalled()
  }

  it('reports tools:gh ok with the found version when at or above the minimum', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: 'acme/proj', recipePath: noRecipePath() })
    const gh = checks.find((c) => c.name === 'tools:gh')
    expect(gh).toEqual({ name: 'tools:gh', ok: true, detail: 'gh 2.99.0', required: true })
  })

  it('reports tools:gh not ok with the found version when below the minimum', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'gh' && args[0] === '--version') return ok('gh version 2.98.0 (2026-08-01)\n')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: 'acme/proj', recipePath: noRecipePath() })
    const gh = checks.find((c) => c.name === 'tools:gh')
    expect(gh?.ok).toBe(false)
    expect(gh?.detail).toContain('2.98.0')
    expect(gh?.required).toBe(true)
  })

  it('marks the gh probes required only when repo is configured', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:gh')?.required).toBe(false)
    expect(checks.find((c) => c.name === 'tools:gh-auth')?.required).toBe(false)
    expect(checks.find((c) => c.name === 'tools:gh-push')?.required).toBe(false)
  })

  it('reports tools:gh-auth ok when gh auth status succeeds', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: 'acme/proj', recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:gh-auth')?.ok).toBe(true)
  })

  it('reports tools:gh-auth not ok when gh auth status fails', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'gh' && args[0] === 'auth') return failed('not logged in')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: 'acme/proj', recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:gh-auth')?.ok).toBe(false)
  })

  it('reports tools:gh-push ok when the push permission is true', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: 'acme/proj', recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:gh-push')).toMatchObject({ ok: true, required: true })
  })

  it('reports tools:gh-push not ok when the push permission is false', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'gh' && args[0] === 'api') return ok('false\n')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: 'acme/proj', recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:gh-push')?.ok).toBe(false)
  })

  it('reports the QA tools as not ok and not required when no recipe file exists', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, recipePath: noRecipePath() })
    for (const name of ['tools:playwright-cli', 'tools:ffmpeg', 'tools:curl', 'tools:op']) {
      const check = checks.find((c) => c.name === name)
      expect(check?.ok).toBe(false)
      expect(check?.required).toBe(false)
    }
  })

  it('requires playwright-cli, ffmpeg, and curl when a recipe file is present', async () => {
    const recipePath = writeRecipe('# QA recipe\n\nRun the browser and capture a clip.\n')
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, recipePath })
    for (const name of ['tools:playwright-cli', 'tools:ffmpeg', 'tools:curl']) {
      const check = checks.find((c) => c.name === name)
      expect(check?.ok).toBe(false)
      expect(check?.required).toBe(true)
    }
  })

  it('requires tools:op only when the recipe references op://', async () => {
    const withoutOp = writeRecipe('# QA recipe\n\nRun the browser.\n')
    const probeWithoutOp = new NodeToolProbe({ execFileFn: notInstalled })
    const checksWithoutOp = await probeWithoutOp.probe({ repo: undefined, recipePath: withoutOp })
    expect(checksWithoutOp.find((c) => c.name === 'tools:op')?.required).toBe(false)

    const withOp = writeRecipe('# QA recipe\n\nlogin: op://vault/item/field\n')
    const probeWithOp = new NodeToolProbe({ execFileFn: notInstalled })
    const checksWithOp = await probeWithOp.probe({ repo: undefined, recipePath: withOp })
    expect(checksWithOp.find((c) => c.name === 'tools:op')?.required).toBe(true)
  })

  it('reports tools:op ok via a signed-in op whoami session', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: undefined, recipePath: noRecipePath() })
    const op = checks.find((c) => c.name === 'tools:op')
    expect(op?.ok).toBe(true)
    expect(op?.detail).toContain('whoami')
  })

  it('reports tools:op ok via OP_SERVICE_ACCOUNT_TOKEN without calling whoami', async () => {
    const exec = vi.fn<ExecCall>((file, args) => {
      if (file === 'op' && args[0] === 'whoami') return Promise.reject(new Error('should not be called'))
      return allInstalled(file, args)
    })
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({
      repo: undefined,
      recipePath: noRecipePath(),
      env: { OP_SERVICE_ACCOUNT_TOKEN: 'tok' },
    })
    const op = checks.find((c) => c.name === 'tools:op')
    expect(op?.ok).toBe(true)
    expect(op?.detail).toContain('OP_SERVICE_ACCOUNT_TOKEN')
    expect(exec).not.toHaveBeenCalledWith('op', ['whoami', '--format=json'])
  })

  it('reports tools:op not ok when op is not signed in and no token is set', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'op' && args[0] === 'whoami') return failed('not signed in')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: undefined, recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:op')?.ok).toBe(false)
  })

  it('reports "not installed" for a missing binary (ENOENT)', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, recipePath: noRecipePath() })
    expect(checks.find((c) => c.name === 'tools:ffmpeg')?.detail).toBe('not installed')
  })
})
