import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import {
  DefaultPullRequestBuilder,
  PullRequestTemplateSchema,
  type PullRequestBuilder,
  type PullRequestTemplate,
} from '../../git/pr-template/pr-template.js'

export interface CreatedPullRequest {
  number: number
  url: string
}

export interface PullRequestHost {
  createPullRequest(input: PullRequestTemplate): Promise<CreatedPullRequest>
}

const GitHubPullRequestHostPropsSchema = z.object({
  token: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export type GitHubPullRequestHostProps = z.infer<typeof GitHubPullRequestHostPropsSchema>

/**
 * Opens pull requests on GitHub via Octokit, reusing the same token that backs
 * the GitHub task tracker. PR hosting is deliberately separate from TaskTracker:
 * where code lives can differ from where tickets live (GitHub PRs + Jira
 * tickets is a supported combination).
 */
export class GitHubPullRequestHost implements PullRequestHost {
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string
  private readonly builder: PullRequestBuilder

  // eslint-disable-next-line preflight/constructor-single-props -- multi-parameter constructor predates charter M-5; tracked in KAN-39
  constructor(props: GitHubPullRequestHostProps, builder: PullRequestBuilder = new DefaultPullRequestBuilder()) {
    const parsed = GitHubPullRequestHostPropsSchema.parse(props)
    this.octokit = new Octokit({ auth: parsed.token })
    this.owner = parsed.owner
    this.repo = parsed.repo
    this.builder = builder
  }

  async createPullRequest(input: PullRequestTemplate): Promise<CreatedPullRequest> {
    const template = PullRequestTemplateSchema.parse(input)
    const { title, body } = this.builder.build(template)

    const response = await this.octokit.rest.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      base: template.baseBranch,
      head: template.headBranch,
    })

    const created: CreatedPullRequest = { number: response.data.number, url: response.data.html_url }

    if (template.reviewers.length > 0) {
      await this.requestReviewers(created.number, template.reviewers)
    }

    if (template.labels.length > 0) {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: created.number,
        labels: template.labels,
      })
    }

    return created
  }

  private async requestReviewers(pullNumber: number, reviewers: string[]): Promise<void> {
    try {
      await this.octokit.rest.pulls.requestReviewers({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        reviewers,
      })
    } catch {
      // best-effort: a self-review or unknown login must not fail an otherwise-created PR
    }
  }
}
