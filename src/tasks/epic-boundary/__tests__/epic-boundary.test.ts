import { describe, it, expect, vi } from 'vitest'
import type { Ticket } from '../../task-tracker/task-tracker.js'
import { CrossEpicEdgeFinder, TrackerRefFormatter } from '../epic-boundary.js'

const ticket = (id: string, blockedBy: string[] = [], status = 'open'): Ticket => ({
  id,
  size: 'ticket',
  status,
  labels: [],
  title: `Ticket ${id}`,
  body: '',
  comments: [],
  assignee: null,
  attachments: [],
  reporter: null,
  issueType: 'Story',
  blockedBy,
  blocking: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
})

describe('CrossEpicEdgeFinder', () => {
  it('skips closed tickets and blockers that resolve back into the same epic', async () => {
    const getTicketEpicId = vi.fn(async (id: string) => (id === 'A-9' ? 'A-1' : 'B-1'))
    const finder = new CrossEpicEdgeFinder({ getTicketEpicId })

    const edges = await finder.find([
      { id: 'A-1', childIssues: [ticket('A-2', ['A-9']), ticket('A-3', ['B-5'], 'closed'), ticket('A-4', ['B-5'])] },
    ])

    expect(edges).toEqual([{ ticket: 'A-4', ticketEpic: 'A-1', blockedBy: 'B-5', blockerEpic: 'B-1', justification: null }])
  })

  it('looks each outside blocker up once', async () => {
    const getTicketEpicId = vi.fn().mockResolvedValue('B-1')
    const finder = new CrossEpicEdgeFinder({ getTicketEpicId })

    const edges = await finder.find([{ id: 'A-1', childIssues: [ticket('A-2', ['B-5']), ticket('A-3', ['B-5'])] }])

    expect(edges).toHaveLength(2)
    expect(getTicketEpicId).toHaveBeenCalledTimes(1)
  })
})

describe('TrackerRefFormatter', () => {
  it('prefixes GitHub issue numbers and leaves Jira keys alone', () => {
    const refs = new TrackerRefFormatter()
    expect(refs.format('12')).toBe('#12')
    expect(refs.format('FRT-12')).toBe('FRT-12')
  })
})
