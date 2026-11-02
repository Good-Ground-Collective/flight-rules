import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { JsonReviewCodec, type ReviewCodec } from '../../code-review/review-codec.js'
import {
  DefaultPullRequestBuilder,
  PullRequestTemplateSchema,
  type PullRequestBuilder,
  type PullRequestTemplate,
} from '../../git/pr-template/pr-template.js'
import type {
  CreatedPullRequest,
  ListReviewThreadsOptions,
  OpenPullRequest,
  PullRequestAttachOptions,
  PullRequestComment,
  PullRequestHost,
  PullRequestThreads,
  ReviewerRequestResult,
  ReviewThread,
  ReviewThreadComment,
  ReviewThreadReply,
} from './pull-request-host.js'

type ExecFileFn = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const GhPullRequestHostPropsSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected "owner/repo"'),
  cwd: z.string().min(1).optional(),
  env: z.custom<NodeJS.ProcessEnv>(
    (value): value is NodeJS.ProcessEnv =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
  ).optional(),
})

export type GhPullRequestHostProps = z.input<typeof GhPullRequestHostPropsSchema> & {
  builder?: PullRequestBuilder
  execFileFn?: ExecFileFn
}

const GhPullRequestListSchema = z.array(
  z.object({
    number: z.number(),
    url: z.string(),
    headRefName: z.string(),
    baseRefName: z.string(),
    title: z.string(),
  }),
)

const reviewThreadsQuery = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number url title body headRefName headRefOid baseRefName
      author { login }
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 100) {
            totalCount
            nodes { id url body createdAt author { type: __typename login } }
          }
        }
      }
    }
  }
}`

const replyToReviewThreadMutation = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) {
    comment { id url }
  }
}`

const GhReplyToReviewThreadSchema = z.object({
  data: z.object({
    addPullRequestReviewThreadReply: z.object({
      comment: z.object({ id: z.string(), url: z.string() }),
    }),
  }),
})

const GhReviewThreadsPageSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        number: z.number(),
        url: z.string(),
        title: z.string(),
        body: z.string(),
        headRefName: z.string(),
        headRefOid: z.string(),
        baseRefName: z.string(),
        author: z.object({ login: z.string() }).nullable(),
        reviewThreads: z.object({
          pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
          nodes: z.array(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              path: z.string(),
              line: z.number().nullable(),
              originalLine: z.number().nullable(),
              comments: z.object({
                totalCount: z.number(),
                nodes: z.array(
                  z.object({
                    id: z.string(),
                    url: z.string(),
                    body: z.string(),
                    createdAt: z.string(),
                    author: z.object({ type: z.string(), login: z.string() }).nullable(),
                  }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
})

type GhReviewThreadsPage = z.infer<typeof GhReviewThreadsPageSchema>
type GhReviewThreadNode = GhReviewThreadsPage['data']['repository']['pullRequest']['reviewThreads']['nodes'][number]

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
  private readonly codec: ReviewCodec
  private readonly execFile: ExecFileFn

  constructor(props: GhPullRequestHostProps) {
    const parsed = GhPullRequestHostPropsSchema.parse(props)
    this.repo = parsed.repo
    this.builder = props.builder ?? new DefaultPullRequestBuilder()
    this.codec = new JsonReviewCodec()

    const promisified = promisify(execFile)
    const cwd = parsed.cwd ?? process.cwd()
    const env = { ...(props.env ?? process.env) }
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args], { cwd, env }))
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

  async listOpenPullRequestsForTickets(ticketIds: readonly string[]): Promise<OpenPullRequest[]> {
    const { stdout } = await this.execFile('gh', [
      'pr',
      'list',
      '--repo',
      this.repo,
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      'number,url,headRefName,baseRefName,title',
    ])
    const open = GhPullRequestListSchema.parse(JSON.parse(stdout))

    return ticketIds.flatMap((ticket) => {
      const id = this.escapeRegExp(ticket)
      const branch = new RegExp(`^[a-z]+/${id}(-|$)`)
      const titleScope = new RegExp(`^[a-z]+\\(${id}\\)!?:`)
      return open
        .filter((candidate) => branch.test(candidate.headRefName) || titleScope.test(candidate.title))
        .map((candidate) => ({ ticket, ...candidate }))
    })
  }

  async defaultBranch(): Promise<string> {
    const { stdout } = await this.execFile('gh', [
      'repo',
      'view',
      this.repo,
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ])
    return stdout.trim()
  }

  async requestReviewers(number: number, logins: readonly string[]): Promise<ReviewerRequestResult> {
    const result: ReviewerRequestResult = { number, requested: [], failed: [] }

    for (const login of logins) {
      try {
        await this.execFile('gh', ['pr', 'edit', String(number), '--repo', this.repo, '--add-reviewer', login])
        result.requested.push(login)
      } catch (err) {
        result.failed.push({ login, error: this.describeFailure(err) })
      }
    }

    return result
  }

  async listReviewThreads(number: number, options: ListReviewThreadsOptions): Promise<PullRequestThreads> {
    const [owner = '', name = ''] = this.repo.split('/')
    let first: GhReviewThreadsPage['data']['repository']['pullRequest'] | undefined
    const nodes: GhReviewThreadNode[] = []
    let cursor: string | undefined

    for (;;) {
      const { stdout } = await this.execFile('gh', [
        'api',
        'graphql',
        '-f',
        `query=${reviewThreadsQuery}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${number}`,
        ...(cursor === undefined ? [] : ['-f', `endCursor=${cursor}`]),
      ])
      const { reviewThreads, ...header } = GhReviewThreadsPageSchema.parse(JSON.parse(stdout)).data.repository.pullRequest
      first ??= { ...header, reviewThreads }
      nodes.push(...reviewThreads.nodes)

      if (!reviewThreads.pageInfo.hasNextPage || reviewThreads.pageInfo.endCursor === null) break
      cursor = reviewThreads.pageInfo.endCursor
    }

    const trusted = new Set(options.trustedAuthors)
    return {
      pullRequest: {
        number: first.number,
        url: first.url,
        title: first.title,
        body: first.body,
        headRefName: first.headRefName,
        headRefOid: first.headRefOid,
        baseRefName: first.baseRefName,
        authorLogin: first.author?.login ?? 'ghost',
      },
      threads: nodes.map((node) => this.toReviewThread(node, trusted)),
    }
  }

  async replyToReviewThread(threadId: string, body: string): Promise<ReviewThreadReply> {
    const { stdout } = await this.withBodyFile(body, (bodyFile) =>
      this.execFile('gh', [
        'api',
        'graphql',
        '-f',
        `query=${replyToReviewThreadMutation}`,
        '-f',
        `id=${threadId}`,
        '-F',
        `body=@${bodyFile}`,
      ]),
    )
    return GhReplyToReviewThreadSchema.parse(JSON.parse(stdout)).data.addPullRequestReviewThreadReply.comment
  }

  private toReviewThread(node: GhReviewThreadNode, trusted: ReadonlySet<string>): ReviewThread {
    const comments: ReviewThreadComment[] = node.comments.nodes.map((comment) => ({
      id: comment.id,
      url: comment.url,
      authorLogin: (comment.author?.login ?? 'ghost').replace(/\[bot\]$/, ''),
      authorType: comment.author?.type === 'Bot' ? 'Bot' : 'User',
      body: comment.body,
      createdAt: comment.createdAt,
    }))
    const root = comments[0]
    let finding: ReviewThread['finding'] = null
    let markerError: string | null = null

    if (root !== undefined && trusted.has(root.authorType === 'Bot' ? `${root.authorLogin}[bot]` : root.authorLogin)) {
      try {
        finding = this.codec.parseFinding(root.body)
      } catch (err) {
        markerError = err instanceof Error ? err.message : String(err)
      }
    }

    return {
      id: node.id,
      path: node.path,
      line: node.line,
      originalLine: node.originalLine,
      isResolved: node.isResolved,
      isOutdated: node.isOutdated,
      commentsTruncated: node.comments.totalCount > node.comments.nodes.length,
      comments,
      finding,
      markerError,
    }
  }

  private describeFailure(err: unknown): string {
    const stderr = this.readStringProperty(err, 'stderr')?.trim()
    const text = stderr !== undefined && stderr.length > 0 ? stderr : err instanceof Error ? err.message : String(err)
    return text.split('\n')[0]?.trim() ?? text
  }

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
