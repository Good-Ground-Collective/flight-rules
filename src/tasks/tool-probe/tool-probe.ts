import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { RedactedProbeDiagnostics } from '../readiness/probe-diagnostics.js'

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

export interface ToolCheck {
  name: string
  ok: boolean
  detail: string
  required: boolean
  code?: string | undefined
  remedy?: string | undefined
}

export interface ToolProbeInput {
  repo?: string | undefined
  /** True when QA instructions apply to the repo, which makes the capture tools required. */
  qaInstructionsFound: boolean
  /** Omitted preserves the general environment check's existing requirements. */
  githubRequired?: boolean
  pushRequired?: boolean
}

export interface ToolProbe {
  probe(input: ToolProbeInput): Promise<ToolCheck[]>
}

const minimumGhVersion: readonly [number, number, number] = [2, 99, 0]
const ghVersionLine = /gh version (\d+)\.(\d+)\.(\d+)/

export interface NodeToolProbeProps {
  execFileFn?: ExecFileFn
  cwd?: string
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

const NodeToolProbePropsSchema = z.object({ cwd: z.string().optional(), env: z.record(z.string(), z.string().optional()).optional(), timeoutMs: z.int().positive().max(60_000).default(10_000) })

/**
 * Probes the CLI's operating environment for the binaries `flight-rules`
 * shells out to, so a missing or outdated tool surfaces in `check` rather
 * than partway through a run.
 */
export class NodeToolProbe implements ToolProbe {
  private readonly execFile: ExecFileFn
  private readonly env: Record<string, string | undefined>

  constructor(props: NodeToolProbeProps = {}) {
    const input = NodeToolProbePropsSchema.parse({ ...props, env: props.env === undefined ? undefined : { ...props.env } })
    const promisified = promisify(execFile)
    const cwd = input.cwd ?? process.cwd()
    const env = props.env ?? process.env
    this.env = env
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args], { cwd, env, timeout: input.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }))
  }

  async probe(input: ToolProbeInput): Promise<ToolCheck[]> {
    const diagnostics = new RedactedProbeDiagnostics({ env: this.env })
    const qaRequired = input.qaInstructionsFound
    const ghRequired = input.githubRequired ?? input.repo !== undefined
    const pushRequired = input.pushRequired ?? ghRequired

    const [gh, ghAuth, ghPush, playwright, ffmpeg, curl] = await Promise.all([
      this.ghVersion(ghRequired, diagnostics),
      this.ghAuth(ghRequired, diagnostics),
      this.ghPush(input.repo, pushRequired, diagnostics),
      this.present('tools:playwright-cli', 'playwright-cli', ['--version'], qaRequired, diagnostics),
      this.present('tools:ffmpeg', 'ffmpeg', ['-version'], qaRequired, diagnostics),
      this.present('tools:curl', 'curl', ['--version'], qaRequired, diagnostics),
    ])

    return [gh, ghAuth, ghPush, playwright, ffmpeg, curl]
  }

  private async ghVersion(required: boolean, diagnostics: RedactedProbeDiagnostics): Promise<ToolCheck> {
    try {
      const { stdout } = await this.execFile('gh', ['--version'])
      const match = ghVersionLine.exec(stdout)
      if (match === null) {
        return { name: 'tools:gh', ok: false, detail: `unrecognized version output: ${diagnostics.redact(stdout.trim())}`, required, code: 'UNKNOWN', remedy: 'Inspect the gh executable selected by PATH and verify its version.' }
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
        ...(ok ? {} : { code: 'TOOL_VERSION', remedy: `Install gh ${minimumGhVersion.join('.')} or newer before this workflow.` }),
      }
    } catch (err) {
      return { ...diagnostics.failure('tools:gh', err, required), required }
    }
  }

  private async ghAuth(required: boolean, diagnostics: RedactedProbeDiagnostics): Promise<ToolCheck> {
    try {
      await this.execFile('gh', ['auth', 'status'])
      return { name: 'tools:gh-auth', ok: true, detail: 'authenticated', required }
    } catch (err) {
      return { ...diagnostics.failure('tools:gh-auth', err, required, 'AUTHENTICATION'), required }
    }
  }

  private async ghPush(repo: string | undefined, required: boolean, diagnostics: RedactedProbeDiagnostics): Promise<ToolCheck> {
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
        detail: ok ? `GitHub account has push entitlement to ${repo}; transport and branch policy are not tested` : stdout.trim() === 'false' ? `no push entitlement to ${repo}` : `push entitlement to ${repo} is unverified`,
        code: ok ? 'AVAILABLE' : stdout.trim() === 'false' ? 'PERMISSION_DENIED' : 'UNKNOWN',
        ...(ok ? {} : { remedy: 'Verify the selected GitHub account has push entitlement to this repository; this probe does not change access.' }),
        required,
      }
    } catch (err) {
      return { ...diagnostics.failure('tools:gh-push', err, required), required }
    }
  }

  private async present(
    name: string,
    file: string,
    args: readonly string[],
    required: boolean,
    diagnostics: RedactedProbeDiagnostics,
  ): Promise<ToolCheck> {
    try {
      const { stdout } = await this.execFile(file, args)
      return { name, ok: true, detail: diagnostics.redact(stdout.trim().split('\n')[0] ?? 'installed'), required }
    } catch (err) {
      return { ...diagnostics.failure(name, err, required), required }
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

}

export const nodeToolProbe: ToolProbe = new NodeToolProbe()
