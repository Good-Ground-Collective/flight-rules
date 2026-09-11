import type { PullRequestTemplate } from '../../git/pr-template/pr-template.js'

export interface CreatedPullRequest {
  number: number
  url: string
}

export interface PullRequestComment {
  url: string
}

/** Files to attach beside a PR or comment body, each formatted as `<path>#<caption>` and passed straight through to the hosting CLI. */
export interface PullRequestAttachOptions {
  attach?: readonly string[]
}

/**
 * Opens pull requests and posts comments on the code host, reusing the same
 * repo the CLI is configured against. PR hosting is deliberately separate
 * from TaskTracker: where code lives can differ from where tickets live
 * (GitHub PRs + Jira tickets is a supported combination).
 */
export interface PullRequestHost {
  createPullRequest(input: PullRequestTemplate, options?: PullRequestAttachOptions): Promise<CreatedPullRequest>
  commentOnPullRequest(number: number, body: string, options?: PullRequestAttachOptions): Promise<PullRequestComment>
}
