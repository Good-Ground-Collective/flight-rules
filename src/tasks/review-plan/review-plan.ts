import type { DependencyPlan } from '../dependency-planner/dependency-planner.js'
import type { Ticket } from '../task-tracker/task-tracker.js'
import type { OpenPullRequest } from '../../pr/pull-request-host/pull-request-host.js'

/** A PR set larger than this needs a Review Packet rather than plain review requests. */
export const maxSimplePrCount = 4

export interface BlockedPullRequest {
  number: number
  url: string
  headRefName: string
  baseRefName: string
}

export interface BlockedTicket {
  ticketId: string
  title: string
  wave: number
  blockedBy: string[]
  pr: BlockedPullRequest | null
}

export type ReviewRoute = 'simple' | 'complex' | 'incomplete'

export interface ReviewRouteDecision {
  route: Exclude<ReviewRoute, 'incomplete'>
  reasons: string[]
}

export interface ReviewPlanInput {
  plan: DependencyPlan
  tickets: Ticket[]
  pullRequests: OpenPullRequest[]
  defaultBranch: string
  inReviewStatus?: string | undefined
}

export interface ReviewPlan {
  route: ReviewRoute
  reasons: string[]
  /** Ids of blocked tickets with no open PR; the route is `incomplete` whenever this is non-empty. */
  missing: string[]
  blocked: BlockedTicket[]
  unblocksOnMerge: string[]
}

/**
 * Decides whether blocked PRs need only plain review requests or a Review
 * Packet: a set is complex when it spans more than one wave, when any PR is
 * stacked on a branch other than the default, or when it holds more than
 * maxSimplePrCount PRs. Every rule that fires is named in `reasons`.
 */
export class ReviewRouteClassifier {
  classify(blocked: readonly BlockedTicket[], defaultBranch: string): ReviewRouteDecision {
    const reasons: string[] = []
    const pullRequests = blocked.flatMap((entry) => (entry.pr === null ? [] : [entry.pr]))

    const waveCount = new Set(blocked.map((entry) => entry.wave)).size
    if (waveCount > 1) {
      reasons.push(`spans more than one wave (${waveCount} waves)`)
    }

    const stacked = pullRequests.filter((pr) => pr.baseRefName !== defaultBranch)
    if (stacked.length > 0) {
      const bases = [...new Set(stacked.map((pr) => pr.baseRefName))].join(', ')
      reasons.push(`stacked base: a PR targets ${bases} instead of ${defaultBranch}`)
    }

    if (pullRequests.length > maxSimplePrCount) {
      reasons.push(`more than ${maxSimplePrCount} PRs (${pullRequests.length} PRs)`)
    }

    return { route: reasons.length > 0 ? 'complex' : 'simple', reasons }
  }
}

/**
 * Joins an epic's dependency waves, ticket titles and open PRs into the
 * hand-off an orchestrator gives reviewers while it waits on merges. When any
 * blocked ticket has no open PR the route is `incomplete`: the set cannot be
 * routed until those PRs exist.
 */
export class ReviewPlanService {
  private readonly classifier = new ReviewRouteClassifier()

  /** Tracker statuses are display names on some trackers, so "In Review" and "in-review" must match. */
  normalizeStatus(status: string): string {
    return status.trim().toLowerCase().replace(/[\s-]+/g, '-')
  }

  isInReview(status: string, inReviewStatus?: string): boolean {
    const normalized = this.normalizeStatus(status)
    return (
      normalized === 'in-review' || (inReviewStatus !== undefined && normalized === this.normalizeStatus(inReviewStatus))
    )
  }

  /** Ids of open tickets in review, in plan order. */
  inReviewTicketIds(plan: DependencyPlan, inReviewStatus?: string): string[] {
    return plan.waves.flat().filter((t) => this.isInReview(t.status, inReviewStatus)).map((t) => t.id)
  }

  build(input: ReviewPlanInput): ReviewPlan {
    const titles = new Map(input.tickets.map((ticket) => [ticket.id, ticket.title]))
    const blocked: BlockedTicket[] = []
    const missingPrReasons: string[] = []

    input.plan.waves.forEach((wave, waveIndex) => {
      for (const planned of wave) {
        if (!this.isInReview(planned.status, input.inReviewStatus)) continue

        const found = input.pullRequests.find((pr) => pr.ticket === planned.id)
        blocked.push({
          ticketId: planned.id,
          title: titles.get(planned.id) ?? '',
          wave: waveIndex,
          blockedBy: planned.blockedBy,
          pr:
            found === undefined
              ? null
              : { number: found.number, url: found.url, headRefName: found.headRefName, baseRefName: found.baseRefName },
        })
        if (found === undefined) missingPrReasons.push(`ticket ${planned.id} is in review but has no open PR`)
      }
    })

    const missing = blocked.filter((entry) => entry.pr === null).map((entry) => entry.ticketId)
    if (missing.length > 0) {
      return {
        route: 'incomplete',
        reasons: missingPrReasons,
        missing,
        blocked,
        unblocksOnMerge: this.unblockedOnMerge(input.plan, blocked),
      }
    }

    const decision = this.classifier.classify(blocked, input.defaultBranch)

    return {
      route: decision.route,
      reasons: decision.reasons,
      missing,
      blocked,
      unblocksOnMerge: this.unblockedOnMerge(input.plan, blocked),
    }
  }

  private unblockedOnMerge(plan: DependencyPlan, blocked: readonly BlockedTicket[]): string[] {
    const blockedIds = new Set(blocked.map((entry) => entry.ticketId))
    const openIds = new Set(plan.waves.flat().map((t) => t.id))

    return plan.waves
      .flat()
      .filter((t) => !blockedIds.has(t.id))
      .filter((t) => {
        const openBlockers = t.blockedBy.filter((id) => openIds.has(id))
        return openBlockers.some((id) => blockedIds.has(id)) && openBlockers.every((id) => blockedIds.has(id))
      })
      .map((t) => t.id)
  }
}
