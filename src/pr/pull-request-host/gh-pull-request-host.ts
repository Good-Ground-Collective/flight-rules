import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  DefaultPullRequestBuilder,
  PullRequestTemplateSchema,
  type PullRequestBuilder,
  type PullRequestTemplate,
} from '../../git/pr-template/pr-template.js'
import type {
  CreatedPullRequest,
  PullRequestAttachOptions,
  PullRequestComment,
  PullRequestHost,
} from './pull-request-host.js'

type ExecFileFn = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const GhPullRequestHostPropsSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected "owner/repo"'),
})

export type GhPullRequestHostProps = z.input<typeof GhPullRequestHostPropsSchema> & {
  builder?: PullRequestBuilder
  execFileFn?: ExecFileFn
}

const pullUrl = /\/pull\/(\d+)\b/

/** gh printed no recognizable pull request URL on stdout, so the create/comment result cannot be reported back to the caller. */
export class GhOutputParseError extends Error {
  override name = 'GhOutputParseError'

  constructor(stdout: string) {
    super(`gh did not print a pull request URL on stdout: ${JSON.stringify(stdout)}`)
  }
}

/**
 * Opens pull requests and posts comments by shelling out to the `gh` CLI, so
 * screenshots and video reach a PR through `--attach` — an upload path
 * Octokit cannot reach. Authentication comes from gh's own keyring (or
 * GH_TOKEN/GITHUB_TOKEN), not a token this class manages.
 */
export class GhPullRequestHost implements PullRequestHost {
  private readonly repo: string
  private readonly builder: PullRequestBuilder
  private readonly execFile: ExecFileFn

  constructor(props: GhPullRequestHostProps) {
    const parsed = GhPullRequestHostPropsSchema.parse(props)
    this.repo = parsed.repo
    this.builder = props.builder ?? new DefaultPullRequestBuilder()

    const promisified = promisify(execFile)
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args]))
  }

  async createPullRequest(input: PullRequestTemplate, options?: PullRequestAttachOptions): Promise<CreatedPullRequest> {
    const template = PullRequestTemplateSchema.parse(input)
    const { title, body } = this.builder.build(template)
    const attach = options?.attach ?? []

    const created = await this.withBodyFile(body, (bodyFile) =>
      this.runCreate(template, title, bodyFile, attach),
    )

    for (const reviewer of template.reviewers) {
      try {
        await this.execFile('gh', ['pr', 'edit', created.url, '--add-reviewer', reviewer])
      } catch {
        // best-effort: a self-review or unknown login must not fail an otherwise-created PR
      }
    }

    return created
  }

  async commentOnPullRequest(number: number, body: string, options?: PullRequestAttachOptions): Promise<PullRequestComment> {
    const attach = options?.attach ?? []

    const { stdout } = await this.withBodyFile(body, (bodyFile) =>
      this.execFile('gh', [
        'pr',
        'comment',
        String(number),
        '--repo',
        this.repo,
        '--body-file',
        bodyFile,
        ...attach.flatMap((spec) => ['--attach', spec]),
      ]),
    )

    return { url: stdout.trim() }
  }

  private async runCreate(
    template: PullRequestTemplate,
    title: string,
    bodyFile: string,
    attach: readonly string[],
  ): Promise<CreatedPullRequest> {
    const args = [
      'pr',
      'create',
      '--repo',
      this.repo,
      '--base',
      template.baseBranch,
      '--head',
      template.headBranch,
      '--title',
      title,
      '--body-file',
      bodyFile,
      ...template.labels.flatMap((label) => ['--label', label]),
      ...attach.flatMap((spec) => ['--attach', spec]),
    ]

    try {
      const { stdout } = await this.execFile('gh', args)
      return this.parseCreated(stdout)
    } catch (err) {
      // A failed --attach upload can still leave the PR created; treat a printed URL as success.
      const partialStdout = this.readStringProperty(err, 'stdout')
      if (partialStdout !== undefined && pullUrl.test(partialStdout)) {
        const partialStderr = this.readStringProperty(err, 'stderr')
        if (partialStderr !== undefined && partialStderr.length > 0) {
          process.stderr.write(partialStderr)
        }
        return this.parseCreated(partialStdout)
      }
      throw err
    }
  }

  private parseCreated(stdout: string): CreatedPullRequest {
    const url = stdout.trim()
    const match = pullUrl.exec(url)
    if (match?.[1] === undefined) throw new GhOutputParseError(url)
    return { number: Number(match[1]), url }
  }

  private async withBodyFile<T>(body: string, run: (bodyFile: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'flight-rules-'))
    const bodyFile = join(dir, 'body.md')
    try {
      await writeFile(bodyFile, body, 'utf8')
      return await run(bodyFile)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  private readStringProperty(err: unknown, key: 'stdout' | 'stderr'): string | undefined {
    if (typeof err !== 'object' || err === null) return undefined
    if (key === 'stdout' && 'stdout' in err) return typeof err.stdout === 'string' ? err.stdout : undefined
    if (key === 'stderr' && 'stderr' in err) return typeof err.stderr === 'string' ? err.stderr : undefined
    return undefined
  }
}
