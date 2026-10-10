import type { PullRequestTemplate } from '../../git/pr-template/pr-template.js'

export interface CreatedPullRequest {
  number: number
  url: string
}

export interface PullRequestComment {
  url: string
}

export interface OpenPullRequest {
  ticket: string
  number: number
  url: string
  headRefName: string
  baseRefName: string
  title: string
}

/** Per-login outcome of asking for reviewers on an existing pull request. */
export interface ReviewerRequestResult {
  number: number
  requested: string[]
  failed: { login: string; error: string }[]
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
  /** Returns every open PR matched to each ticket id, so a ticket with several PRs shows all of them. */
  listOpenPullRequestsForTickets(ticketIds: readonly string[]): Promise<OpenPullRequest[]>
  /** Name of the repository's default branch, the base a non-stacked PR targets. */
  defaultBranch(): Promise<string>
  /** Attempts every login and reports each outcome rather than stopping at the first failure. */
  requestReviewers(number: number, logins: readonly string[]): Promise<ReviewerRequestResult>
}
