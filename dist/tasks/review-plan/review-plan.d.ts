import type { DependencyPlan } from '../dependency-planner/dependency-planner.js';
import type { Ticket } from '../task-tracker/task-tracker.js';
import type { OpenPullRequest } from '../../pr/pull-request-host/pull-request-host.js';
/** A PR set larger than this needs a Review Packet rather than plain review requests. */
export declare const maxSimplePrCount = 4;
export interface BlockedPullRequest {
    number: number;
    url: string;
    headRefName: string;
    baseRefName: string;
}
export interface BlockedTicket {
    ticketId: string;
    title: string;
    wave: number;
    blockedBy: string[];
    pr: BlockedPullRequest | null;
}
export type ReviewRoute = 'simple' | 'complex' | 'incomplete';
export interface ReviewRouteDecision {
    route: Exclude<ReviewRoute, 'incomplete'>;
    reasons: string[];
}
export interface ReviewPlanInput {
    plan: DependencyPlan;
    tickets: Ticket[];
    pullRequests: OpenPullRequest[];
    defaultBranch: string;
    inReviewStatus?: string | undefined;
}
export interface ReviewPlan {
    route: ReviewRoute;
    reasons: string[];
    /** Ids of blocked tickets with no open PR; the route is `incomplete` whenever this is non-empty. */
    missing: string[];
    blocked: BlockedTicket[];
    unblocksOnMerge: string[];
}
/**
 * Decides whether blocked PRs need only plain review requests or a Review
 * Packet: a set is complex when it spans more than one wave, when any PR is
 * stacked on a branch other than the default, or when it holds more than
 * maxSimplePrCount PRs. Every rule that fires is named in `reasons`.
 */
export declare class ReviewRouteClassifier {
    classify(blocked: readonly BlockedTicket[], defaultBranch: string): ReviewRouteDecision;
}
/**
 * Joins the dependency waves of an epic or initiative, ticket titles and open
 * PRs into the hand-off an orchestrator gives reviewers while it waits on
 * merges. When any blocked ticket has no open PR the route is `incomplete`:
 * the set cannot be routed until those PRs exist.
 */
export declare class ReviewPlanService {
    private readonly classifier;
    /** Tracker statuses are display names on some trackers, so "In Review" and "in-review" must match. */
    normalizeStatus(status: string): string;
    isInReview(status: string, inReviewStatus?: string): boolean;
    /** Ids of open tickets in review, in plan order. */
    inReviewTicketIds(plan: DependencyPlan, inReviewStatus?: string): string[];
    build(input: ReviewPlanInput): ReviewPlan;
    private unblockedOnMerge;
}
