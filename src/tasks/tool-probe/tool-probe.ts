import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

export interface ToolCheck {
  name: string
  ok: boolean
  detail: string
  required: boolean
}

export interface ToolProbeInput {
  repo?: string | undefined
  recipePath: string
  env?: Record<string, string | undefined>
}

export interface ToolProbe {
  probe(input: ToolProbeInput): Promise<ToolCheck[]>
}

const minimumGhVersion: readonly [number, number, number] = [2, 99, 0]
const ghVersionLine = /gh version (\d+)\.(\d+)\.(\d+)/

export interface NodeToolProbeProps {
  execFileFn?: ExecFileFn
}

/**
 * Probes the CLI's operating environment for the binaries `flight-rules`
 * shells out to, so a missing or outdated tool surfaces in `check` rather
 * than partway through a run.
 */
export class NodeToolProbe implements ToolProbe {
  private readonly execFile: ExecFileFn

  constructor(props: NodeToolProbeProps = {}) {
    const promisified = promisify(execFile)
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args]))
  }

  async probe(input: ToolProbeInput): Promise<ToolCheck[]> {
    const recipe = existsSync(input.recipePath) ? readFileSync(input.recipePath, 'utf8') : undefined
    const qaRequired = recipe !== undefined
    const opRequired = qaRequired && recipe.includes('op://')
    const ghRequired = input.repo !== undefined
    const env = input.env ?? {}

    const [gh, ghAuth, ghPush, playwright, ffmpeg, curl, op] = await Promise.all([
      this.ghVersion(ghRequired),
      this.ghAuth(ghRequired),
      this.ghPush(input.repo, ghRequired),
      this.present('tools:playwright-cli', 'playwright-cli', ['--version'], qaRequired),
      this.present('tools:ffmpeg', 'ffmpeg', ['-version'], qaRequired),
      this.present('tools:curl', 'curl', ['--version'], qaRequired),
      this.op(env, opRequired),
    ])

    return [gh, ghAuth, ghPush, playwright, ffmpeg, curl, op]
  }

  private async ghVersion(required: boolean): Promise<ToolCheck> {
    try {
      const { stdout } = await this.execFile('gh', ['--version'])
      const match = ghVersionLine.exec(stdout)
      if (match === null) {
        return { name: 'tools:gh', ok: false, detail: `unrecognized version output: ${stdout.trim()}`, required }
      }
      const [, major, minor, patch] = match
      const version: readonly [number, number, number] = [Number(major), Number(minor), Number(patch)]
      const ok = this.meetsMinimumVersion(version, minimumGhVersion)
      const found = `${version[0]}.${version[1]}.${version[2]}`
      return {
        name: 'tools:gh',
        ok,
        detail: ok
          ? `gh ${found}`
          : `gh ${found} is older than the required ${minimumGhVersion.join('.')}`,
        required,
      }
    } catch (err) {
      const detail = this.isMissingBinary(err) ? 'not installed' : this.stderrOf(err)
      return { name: 'tools:gh', ok: false, detail, required }
    }
  }

  private async ghAuth(required: boolean): Promise<ToolCheck> {
    try {
      await this.execFile('gh', ['auth', 'status'])
      return { name: 'tools:gh-auth', ok: true, detail: 'authenticated', required }
    } catch (err) {
      const detail = this.isMissingBinary(err) ? 'not installed' : this.stderrOf(err)
      return { name: 'tools:gh-auth', ok: false, detail, required }
    }
  }

  private async ghPush(repo: string | undefined, required: boolean): Promise<ToolCheck> {
    if (repo === undefined) {
      return { name: 'tools:gh-push', ok: false, detail: 'skipped — repo is not configured', required }
    }
    try {
      const { stdout } = await this.execFile('gh', [
        'api',
        `repos/${repo}`,
        '--jq',
        '.permissions.push',
      ])
      const ok = stdout.trim() === 'true'
      return {
        name: 'tools:gh-push',
        ok,
        detail: ok ? `push access to ${repo}` : `no push access to ${repo}`,
        required,
      }
    } catch (err) {
      const detail = this.isMissingBinary(err) ? 'not installed' : this.stderrOf(err)
      return { name: 'tools:gh-push', ok: false, detail, required }
    }
  }

  private async present(
    name: string,
    file: string,
    args: readonly string[],
    required: boolean,
  ): Promise<ToolCheck> {
    try {
      const { stdout } = await this.execFile(file, args)
      return { name, ok: true, detail: stdout.trim().split('\n')[0] ?? 'installed', required }
    } catch (err) {
      const detail = this.isMissingBinary(err) ? 'not installed' : this.stderrOf(err)
      return { name, ok: false, detail, required }
    }
  }

  private async op(env: Record<string, string | undefined>, required: boolean): Promise<ToolCheck> {
    try {
      await this.execFile('op', ['--version'])
    } catch (err) {
      const detail = this.isMissingBinary(err) ? 'not installed' : this.stderrOf(err)
      return { name: 'tools:op', ok: false, detail, required }
    }

    if (env['OP_SERVICE_ACCOUNT_TOKEN'] !== undefined) {
      return { name: 'tools:op', ok: true, detail: 'authenticated via OP_SERVICE_ACCOUNT_TOKEN', required }
    }

    try {
      await this.execFile('op', ['whoami', '--format=json'])
      return { name: 'tools:op', ok: true, detail: 'authenticated via op whoami', required }
    } catch (err) {
      const detail = this.isMissingBinary(err) ? 'not installed' : this.stderrOf(err)
      return { name: 'tools:op', ok: false, detail: `not signed in — ${detail}`, required }
    }
  }

  /** True when `version` is at least `minimum`, comparing major, minor, then patch. */
  private meetsMinimumVersion(
    version: readonly [number, number, number],
    minimum: readonly [number, number, number],
  ): boolean {
    for (let i = 0; i < minimum.length; i++) {
      const actual = version[i] ?? 0
      const required = minimum[i] ?? 0
      if (actual !== required) return actual > required
    }
    return true
  }

  /** Distinguishes a missing binary (ENOENT) from a binary that ran and failed. */
  private isMissingBinary(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
  }

  private stderrOf(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'stderr' in err) {
      const stderr = err.stderr
      if (typeof stderr === 'string') return stderr.trim()
    }
    if (err instanceof Error) return err.message
    return String(err)
  }
}

export const nodeToolProbe: ToolProbe = new NodeToolProbe()
