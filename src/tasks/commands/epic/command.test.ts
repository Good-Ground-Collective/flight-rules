import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, Epic } from '../../task-tracker/task-tracker.js'
import { createEpicCommand } from './command.js'

const mockEpic: Epic = {
  id: '42',
  status: 'open',
  labels: ['epic'],
  title: 'My Epic',
  body: 'Epic body',
  childIssues: [],
  comments: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn().mockResolvedValue(mockEpic),
  getEpic: vi.fn().mockResolvedValue(mockEpic),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  createTechnicalDesign: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
})

const run = (tracker: TaskTracker, args: string[]) =>
  createEpicCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('epic command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createEpic and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'My Epic', '--body', 'Epic body'])
    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'My Epic', body: 'Epic body', labels: [] })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('splits --labels on comma', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'T', '--body', 'B', '--labels', 'bug,feature'])
    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'T', body: 'B', labels: ['bug', 'feature'] })
    output.mockRestore()
  })

  it('calls getEpic and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '42'])
    expect(tracker.getEpic).toHaveBeenCalledWith('42')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('rejects "create" when --title is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['create', '--body', 'B'])).rejects.toThrow(CommanderError)
    expect(tracker.createEpic).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})
