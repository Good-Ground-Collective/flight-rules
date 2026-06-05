import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, Ticket } from '../task-tracker/types.js'
import { runTicketCommand } from './ticket.js'

const mockTicket: Ticket = {
  id: '7',
  status: 'open',
  labels: ['ticket'],
  title: 'Fix login',
  body: 'Details',
  comments: [],
  assignee: null,
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn().mockResolvedValue(mockTicket),
  getTicket: vi.fn().mockResolvedValue(mockTicket),
  linkTicketToEpic: vi.fn(),
  createTechnicalDesign: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
})

describe('runTicketCommand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTicket and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTicketCommand(
      ['create', '--title', 'Fix login', '--body', 'Details', '--epic-id', '42'],
      tracker,
    )

    expect(tracker.createTicket).toHaveBeenCalledWith({
      title: 'Fix login',
      body: 'Details',
      epicId: '42',
      labels: [],
    })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTicket) + '\n')
    output.mockRestore()
  })

  it('passes assignee when provided', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTicketCommand(
      ['create', '--title', 'T', '--body', 'B', '--epic-id', '1', '--assignee', 'alice'],
      tracker,
    )

    expect(tracker.createTicket).toHaveBeenCalledWith({
      title: 'T',
      body: 'B',
      epicId: '1',
      labels: [],
      assignee: 'alice',
    })
    output.mockRestore()
  })

  it('calls getTicket and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTicketCommand(['get', '7'], tracker)

    expect(tracker.getTicket).toHaveBeenCalledWith('7')
    output.mockRestore()
  })
})
