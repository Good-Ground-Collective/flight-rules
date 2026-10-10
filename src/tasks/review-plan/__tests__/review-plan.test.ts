import { describe, it, expect } from 'vitest'
import { ReviewPlanService, ReviewRouteClassifier, type BlockedTicket } from '../review-plan.js'
import type { DependencyPlan, PlannerTicket } from '../../dependency-planner/dependency-planner.js'
import type { Ticket } from '../../task-tracker/task-tracker.js'
import type { OpenPullRequest } from '../../../pr/pull-request-host/pull-request-host.js'

const planned = (id: string, status = 'in-review', blockedBy: string[] = []): PlannerTicket => ({ id, status, blockedBy })

const ticket = (id: string): Ticket => ({
  id,
  size: 'ticket',
  status: 'open',
  labels: [],
  title: `Ticket ${id}`,
  body: '',
  comments: [],
  assignee: null,
  attachments: [],
  reporter: null,
  issueType: 'Story',
  blockedBy: [],
  blocking: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
})

const pr = (id: string, base = 'main'): OpenPullRequest => ({
  ticket: id,
  number: Number(id) + 100,
  url: `https://example.test/pull/${Number(id) + 100}`,
  headRefName: `feat/${id}-x`,
  baseRefName: base,
  title: `feat(${id}): x`,
})

const entry = (id: string, wave: number, base: string | null = 'main'): BlockedTicket => ({
  ticketId: id,
  title: id,
  wave,
  blockedBy: [],
  pr: base === null ? null : { number: Number(id), url: 'u', headRefName: `feat/${id}`, baseRefName: base },
})

describe('ReviewRouteClassifier.classify', () => {
  const classifier = new ReviewRouteClassifier()
  const cases: [string, BlockedTicket[], string, string[]][] = [
    ['one wave, 3 PRs on main', [entry('1', 0), entry('2', 0), entry('3', 0)], 'simple', []],
    ['two waves', [entry('1', 0), entry('2', 1)], 'complex', ['spans more than one wave']],
    ['stacked base', [entry('1', 0, 'feat/41-x')], 'complex', ['stacked base']],
    [
      'five PRs in one wave',
      ['1', '2', '3', '4', '5'].map((id) => entry(id, 0)),
      'complex',
      ['more than 4 PRs'],
    ],
    [
      'every trigger at once',
      ['1', '2', '3', '4'].map((id) => entry(id, 0)).concat(entry('5', 1, 'feat/x')),
      'complex',
      ['spans more than one wave', 'stacked base', 'more than 4 PRs'],
    ],
  ]

  it.each(cases)('%s', (_name, blocked, route, expected) => {
    const result = classifier.classify(blocked, 'main')
    expect(result.route).toBe(route)
    expect(result.reasons).toHaveLength(expected.length)
    expected.forEach((fragment, i) => expect(result.reasons[i]).toContain(fragment))
  })
})

describe('ReviewPlanService.build', () => {
  const service = new ReviewPlanService()
  const build = (plan: DependencyPlan, pullRequests: OpenPullRequest[], inReviewStatus?: string) =>
    service.build({
      plan,
      tickets: plan.waves.flat().map((t) => ticket(t.id)),
      pullRequests,
      defaultBranch: 'main',
      inReviewStatus,
    })

  it('is simple for one wave of in-review tickets with PRs on main', () => {
    const result = build({ waves: [[planned('1'), planned('2'), planned('3')]], cycles: [] }, [pr('1'), pr('2'), pr('3')])
    expect(result.route).toBe('simple')
    expect(result.reasons).toEqual([])
    expect(result.blocked.map((b) => b.ticketId)).toEqual(['1', '2', '3'])
    expect(result.blocked[0]).toEqual({
      ticketId: '1',
      title: 'Ticket 1',
      wave: 0,
      blockedBy: [],
      pr: { number: 101, url: 'https://example.test/pull/101', headRefName: 'feat/1-x', baseRefName: 'main' },
    })
  })

  it('orders blocked tickets by wave then plan order and is complex across waves', () => {
    const result = build(
      { waves: [[planned('1'), planned('2', 'open'), planned('3')], [planned('4', 'in-review', ['1'])]], cycles: [] },
      [pr('1'), pr('3'), pr('4')],
    )
    expect(result.blocked.map((b) => [b.ticketId, b.wave])).toEqual([['1', 0], ['3', 0], ['4', 1]])
    expect(result.route).toBe('complex')
  })

  it('is incomplete and lists missing tickets when an in-review ticket has no PR', () => {
    const result = build({ waves: [[planned('1'), planned('2')]], cycles: [] }, [pr('2')])
    expect(result.route).toBe('incomplete')
    expect(result.missing).toEqual(['1'])
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toContain('no open PR')
  })

  it('has an empty missing list when every blocked ticket has a PR', () => {
    expect(build({ waves: [[planned('1')]], cycles: [] }, [pr('1')]).missing).toEqual([])
  })

  it('gives pr null and a reason for an in-review ticket without a PR', () => {
    const result = build({ waves: [[planned('1')]], cycles: [] }, [])
    expect(result.blocked[0]?.pr).toBeNull()
    expect(result.reasons.some((r) => r.includes('1') && r.includes('no open PR'))).toBe(true)
  })

  it('treats Jira-style "In Review" and the configured status as in review', () => {
    const plan = { waves: [[planned('1', 'In Review'), planned('2', 'Ready for Review'), planned('3', 'open')]], cycles: [] }
    expect(build(plan, [], undefined).blocked.map((b) => b.ticketId)).toEqual(['1'])
    expect(build(plan, [], 'ready-for review').blocked.map((b) => b.ticketId)).toEqual(['1', '2'])
  })

  it('computes unblocksOnMerge from tickets blocked only by the blocked set', () => {
    const result = build(
      {
        waves: [
          [planned('1'), planned('2', 'open')],
          [planned('3', 'open', ['1']), planned('4', 'open', ['1', '2']), planned('5', 'open', ['1', '9'])],
        ],
        cycles: [],
      },
      [pr('1')],
    )
    expect(result.unblocksOnMerge).toEqual(['3', '5'])
  })
})
