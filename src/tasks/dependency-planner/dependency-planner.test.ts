import { describe, it, expect } from 'vitest'
import { DependencyPlannerService } from './dependency-planner.js'
import type { PlannerTicket } from './dependency-planner.js'

const planner = new DependencyPlannerService()

const t = (id: string, blockedBy: string[] = [], status = 'open'): PlannerTicket => ({
  id,
  status,
  blockedBy,
})

const ids = (wave: PlannerTicket[]): string[] => wave.map((x) => x.id)

describe('DependencyPlannerService.plan', () => {
  it('puts all unblocked open tickets in wave 0', () => {
    const plan = planner.plan([t('1'), t('2'), t('3')])
    expect(plan.waves.map(ids)).toEqual([['1', '2', '3']])
    expect(plan.cycles).toEqual([])
  })

  it('orders a linear chain into successive waves', () => {
    // 3 blocked by 2, 2 blocked by 1
    const plan = planner.plan([t('1'), t('2', ['1']), t('3', ['2'])])
    expect(plan.waves.map(ids)).toEqual([['1'], ['2'], ['3']])
  })

  it('treats a closed blocker as satisfied', () => {
    const plan = planner.plan([t('1', [], 'closed'), t('2', ['1'])])
    expect(plan.waves.map(ids)).toEqual([['2']])
    expect(plan.cycles).toEqual([])
  })

  it('treats an out-of-epic blocker as satisfied', () => {
    const plan = planner.plan([t('2', ['999'])])
    expect(plan.waves.map(ids)).toEqual([['2']])
  })

  it('excludes closed tickets from waves', () => {
    const plan = planner.plan([t('1', [], 'closed'), t('2')])
    expect(plan.waves.map(ids)).toEqual([['2']])
  })

  it('reports unschedulable tickets when a cycle exists', () => {
    // 1 blocked by 2, 2 blocked by 1
    const plan = planner.plan([t('1', ['2']), t('2', ['1'])])
    expect(plan.waves).toEqual([])
    expect(plan.cycles).toEqual(['1', '2'])
  })

  it('schedules acyclic tickets and reports only the stuck ones', () => {
    // 1 ok; 2<->3 cycle
    const plan = planner.plan([t('1'), t('2', ['3']), t('3', ['2'])])
    expect(plan.waves.map(ids)).toEqual([['1']])
    expect(plan.cycles).toEqual(['2', '3'])
  })
})
