import type { FindingRecord } from '../../code-review/review.schema.js';
import type { PullRequestTemplate } from '../../git/pr-template/pr-template.js';
export interface CreatedPullRequest {
    number: number;
    url: string;
}
export interface PullRequestComment {
    url: string;
}
export interface OpenPullRequest {
    ticket: string;
    number: number;
    url: string;
    headRefName: string;
    baseRefName: string;
    title: string;
}
export interface ReviewThreadComment {
    id: string;
    url: string;
    /** Login with any `[bot]` suffix removed. */
    authorLogin: string;
    authorType: 'User' | 'Bot';
    body: string;
    createdAt: string;
}
export interface ReviewThread {
    /** GraphQL node id. */
    id: string;
    path: string;
    line: number | null;
    originalLine: number | null;
    isResolved: boolean;
    isOutdated: boolean;
    /** True when the thread has more comments than were fetched. */
    commentsTruncated: boolean;
    comments: ReviewThreadComment[];
    /** Parsed from the root comment only, and only when its author is a trusted author. */
    finding: FindingRecord | null;
    /** Set when the root comment of a trusted author carries a malformed finding marker. */
    markerError: string | null;
}
export interface PullRequestThreadsHeader {
    number: number;
    url: string;
    title: string;
    body: string;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
    authorLogin: string;
}
export interface PullRequestThreads {
    pullRequest: PullRequestThreadsHeader;
    threads: ReviewThread[];
}
export interface ListReviewThreadsOptions {
    /**
     * Authors whose root comments may carry finding markers; with none, no marker is parsed.
     * An entry ending in `[bot]` (e.g. `coderabbit[bot]`) trusts only the Bot with that login;
     * any other entry trusts only the User with that exact login.
     */
    trustedAuthors: readonly string[];
}
/** Per-login outcome of asking for reviewers on an existing pull request. */
export interface ReviewerRequestResult {
    number: number;
    requested: string[];
    failed: {
        login: string;
        error: string;
    }[];
}
/** Files to attach beside a PR or comment body, each formatted as `<path>#<caption>` and passed straight through to the hosting CLI. */
export interface PullRequestAttachOptions {
    attach?: readonly string[];
}
/**
 * Opens pull requests and posts comments on the code host, reusing the same
 * repo the CLI is configured against. PR hosting is deliberately separate
 * from TaskTracker: where code lives can differ from where tickets live
 * (GitHub PRs + Jira tickets is a supported combination).
 */
export interface PullRequestHost {
    createPullRequest(input: PullRequestTemplate, options?: PullRequestAttachOptions): Promise<CreatedPullRequest>;
    commentOnPullRequest(number: number, body: string, options?: PullRequestAttachOptions): Promise<PullRequestComment>;
    /** Returns every open PR matched to each ticket id, so a ticket with several PRs shows all of them. */
    listOpenPullRequestsForTickets(ticketIds: readonly string[]): Promise<OpenPullRequest[]>;
    /** Name of the repository's default branch, the base a non-stacked PR targets. */
    defaultBranch(): Promise<string>;
    /** Attempts every login and reports each outcome rather than stopping at the first failure. */
    requestReviewers(number: number, logins: readonly string[]): Promise<ReviewerRequestResult>;
    /** Every review thread, resolved and outdated included, since neither state proves a finding closed. */
    listReviewThreads(number: number, options: ListReviewThreadsOptions): Promise<PullRequestThreads>;
}
