import { describe, it, expect, vi } from 'vitest'
import { NodeToolProbe } from '../tool-probe.js'

type ExecResult = { stdout: string; stderr: string }
type ExecCall = (file: string, args: readonly string[]) => Promise<ExecResult>

const notInstalled = (): Promise<never> => Promise.reject({ code: 'ENOENT', message: 'not found' })
const failed = (stderr: string): Promise<never> => Promise.reject({ code: 1, stderr })
const ok = (stdout: string): Promise<ExecResult> => Promise.resolve({ stdout, stderr: '' })

describe('NodeToolProbe', () => {
  const allInstalled: ExecCall = (file, args) => {
    if (file === 'gh' && args[0] === '--version') return ok('gh version 2.99.0 (2026-09-01)\n')
    if (file === 'gh' && args[0] === 'auth') return ok('Logged in to github.com\n')
    if (file === 'gh' && args[0] === 'api') return ok('true\n')
    if (file === 'playwright-cli') return ok('1.0.0\n')
    if (file === 'ffmpeg') return ok('ffmpeg version 6.0\n')
    if (file === 'curl') return ok('curl 8.0.0\n')
    return notInstalled()
  }

  it('reports tools:gh ok with the found version when at or above the minimum', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: 'acme/proj', qaInstructionsFound: false })
    const gh = checks.find((c) => c.name === 'tools:gh')
    expect(gh).toEqual({ name: 'tools:gh', ok: true, detail: 'gh 2.99.0', required: true })
  })

  it('reports tools:gh not ok with the found version when below the minimum', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'gh' && args[0] === '--version') return ok('gh version 2.98.0 (2026-08-01)\n')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: 'acme/proj', qaInstructionsFound: false })
    const gh = checks.find((c) => c.name === 'tools:gh')
    expect(gh?.ok).toBe(false)
    expect(gh?.detail).toContain('2.98.0')
    expect(gh?.required).toBe(true)
  })

  it('marks the gh probes required only when repo is configured', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, qaInstructionsFound: false })
    expect(checks.find((c) => c.name === 'tools:gh')?.required).toBe(false)
    expect(checks.find((c) => c.name === 'tools:gh-auth')?.required).toBe(false)
    expect(checks.find((c) => c.name === 'tools:gh-push')?.required).toBe(false)
  })

  it('reports tools:gh-auth ok when gh auth status succeeds', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: 'acme/proj', qaInstructionsFound: false })
    expect(checks.find((c) => c.name === 'tools:gh-auth')?.ok).toBe(true)
  })

  it('reports tools:gh-auth not ok when gh auth status fails', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'gh' && args[0] === 'auth') return failed('not logged in')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: 'acme/proj', qaInstructionsFound: false })
    expect(checks.find((c) => c.name === 'tools:gh-auth')?.ok).toBe(false)
  })

  it('reports tools:gh-push ok when the push permission is true', async () => {
    const probe = new NodeToolProbe({ execFileFn: allInstalled })
    const checks = await probe.probe({ repo: 'acme/proj', qaInstructionsFound: false })
    expect(checks.find((c) => c.name === 'tools:gh-push')).toMatchObject({ ok: true, required: true })
  })

  it('reports tools:gh-push not ok when the push permission is false', async () => {
    const exec: ExecCall = (file, args) => {
      if (file === 'gh' && args[0] === 'api') return ok('false\n')
      return allInstalled(file, args)
    }
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: 'acme/proj', qaInstructionsFound: false })
    expect(checks.find((c) => c.name === 'tools:gh-push')?.ok).toBe(false)
  })

  it('reports the QA tools as not ok and not required when no QA instructions exist', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, qaInstructionsFound: false })
    for (const name of ['tools:playwright-cli', 'tools:ffmpeg', 'tools:curl']) {
      const check = checks.find((c) => c.name === name)
      expect(check?.ok).toBe(false)
      expect(check?.required).toBe(false)
    }
  })

  it('requires playwright-cli, ffmpeg, and curl when QA instructions exist', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, qaInstructionsFound: true })
    for (const name of ['tools:playwright-cli', 'tools:ffmpeg', 'tools:curl']) {
      const check = checks.find((c) => c.name === name)
      expect(check?.ok).toBe(false)
      expect(check?.required).toBe(true)
    }
  })

  it('never spawns op', async () => {
    const exec = vi.fn<ExecCall>(allInstalled)
    const probe = new NodeToolProbe({ execFileFn: exec })
    const checks = await probe.probe({ repo: undefined, qaInstructionsFound: true })
    expect(checks.map((c) => c.name)).not.toContain('tools:op')
    expect(exec.mock.calls.map(([file]) => file)).not.toContain('op')
  })

  it('reports "not installed" for a missing binary (ENOENT)', async () => {
    const probe = new NodeToolProbe({ execFileFn: notInstalled })
    const checks = await probe.probe({ repo: undefined, qaInstructionsFound: false })
    expect(checks.find((c) => c.name === 'tools:ffmpeg')?.detail).toBe('not installed')
  })
})
