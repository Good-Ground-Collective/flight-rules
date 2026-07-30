import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, Ticket } from '../../../task-tracker/task-tracker.js'
import { createTicketCommand } from '../command.js'

const mockTicket: Ticket = {
  id: '7',
  size: 'ticket',
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
  transitionTicket: vi.fn(),
  listTransitions: vi.fn().mockResolvedValue([]),
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
  ping: vi.fn(),
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

  it('rejects "create" when neither --body nor --body-file is given', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['create', '--title', 'T', '--epic-id', '5'])).rejects.toThrow('one of --body or --body-file')
    expect(tracker.createTicket).not.toHaveBeenCalled()
  })

  it('calls getTicket and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7'])
    expect(tracker.getTicket).toHaveBeenCalledWith('7')
    output.mockRestore()
  })

  it('extracts a single section as JSON for "get --section"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getTicket).mockResolvedValue({
      ...mockTicket,
      body: '## Acceptance Criteria\n\n- [ ] ship it\n- [x] done\n',
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7', '--section', 'acceptance-criteria'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        id: '7',
        section: 'acceptance-criteria',
        markdown: '- [ ] ship it\n- [x] done',
        items: [
          { text: 'ship it', done: false },
          { text: 'done', done: true },
        ],
      }) + '\n',
    )
    output.mockRestore()
  })

  it('rejects "get --section" with an unknown section name', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['get', '7', '--section', 'bogus'])).rejects.toThrow(/unknown section/)
  })

  it('creates a standalone ticket when --epic-id is omitted', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'T', '--body', 'B'])
    expect(tracker.createTicket).toHaveBeenCalledWith({ title: 'T', body: 'B', labels: [] })
    expect(vi.mocked(tracker.createTicket).mock.calls[0]?.[0]).not.toHaveProperty('epicId')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTicket) + '\n')
    output.mockRestore()
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

  it('calls transitionTicket and prints JSON for "status"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['status', '7', '--to', 'In Review'])
    expect(tracker.transitionTicket).toHaveBeenCalledWith('7', 'In Review')
    expect(output).toHaveBeenCalledWith(JSON.stringify({ id: '7', status: 'In Review' }) + '\n')
    output.mockRestore()
  })

  it('rejects "status" when --to is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['status', '7'])).rejects.toThrow(CommanderError)
    expect(tracker.transitionTicket).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('rejects "block" when --by is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['block', '7'])).rejects.toThrow(CommanderError)
    expect(tracker.blockTicket).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})

describe('ticket transitions command', () => {
  it('prints the reachable statuses for the ticket', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.listTransitions).mockResolvedValue(['In Progress', 'Done'])
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await createTicketCommand(() => tracker).parseAsync(['transitions', 'KAN-35'], { from: 'user' })
    expect(tracker.listTransitions).toHaveBeenCalledWith('KAN-35')
    expect(write).toHaveBeenCalledWith(
      JSON.stringify({ id: 'KAN-35', transitions: ['In Progress', 'Done'] }) + '\n',
    )
    write.mockRestore()
  })

  it('prints an empty list rather than failing', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.listTransitions).mockResolvedValue([])
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await createTicketCommand(() => tracker).parseAsync(['transitions', '7'], { from: 'user' })
    expect(write).toHaveBeenCalledWith(JSON.stringify({ id: '7', transitions: [] }) + '\n')
    write.mockRestore()
  })
})
