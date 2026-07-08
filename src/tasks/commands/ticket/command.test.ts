import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, Ticket } from '../../task-tracker/task-tracker.js'
import { createTicketCommand } from './command.js'

const mockTicket: Ticket = {
  id: '7',
  status: 'open',
  labels: ['ticket'],
  title: 'Fix login',
  body: 'Details',
  comments: [],
  assignee: null,
  blockedBy: [],
  blocking: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn().mockResolvedValue(mockTicket),
  getTicket: vi.fn().mockResolvedValue(mockTicket),
  linkTicketToEpic: vi.fn(),
  blockTicket: vi.fn(),
  unblockTicket: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  createTechnicalDesign: vi.fn(),
  createInitiative: vi.fn(),
  getInitiative: vi.fn(),
  linkEpicToInitiative: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
  getUsers: vi.fn(),
})

const run = (tracker: TaskTracker, args: string[]) =>
  createTicketCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('ticket command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTicket and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'Fix login', '--body', 'Details', '--epic-id', '42'])
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
    await run(tracker, ['create', '--title', 'T', '--body', 'B', '--epic-id', '1', '--assignee', 'alice'])
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
    await run(tracker, ['get', '7'])
    expect(tracker.getTicket).toHaveBeenCalledWith('7')
    output.mockRestore()
  })

  it('rejects "create" when --epic-id is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['create', '--title', 'T', '--body', 'B'])).rejects.toThrow(CommanderError)
    expect(tracker.createTicket).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('calls blockTicket for "block"', async () => {
    const tracker = makeTracker()
    await run(tracker, ['block', '7', '--by', '3'])
    expect(tracker.blockTicket).toHaveBeenCalledWith('7', '3')
  })

  it('calls unblockTicket for "unblock"', async () => {
    const tracker = makeTracker()
    await run(tracker, ['unblock', '7', '--by', '3'])
    expect(tracker.unblockTicket).toHaveBeenCalledWith('7', '3')
  })

  it('rejects "block" when --by is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['block', '7'])).rejects.toThrow(CommanderError)
    expect(tracker.blockTicket).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})
