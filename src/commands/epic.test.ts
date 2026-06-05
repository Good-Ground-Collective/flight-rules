import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, Epic } from '../task-tracker/types.js'
import { runEpicCommand } from './epic.js'

const mockEpic: Epic = {
  id: '42',
  status: 'open',
  labels: ['epic'],
  title: 'My Epic',
  body: 'Epic body',
  childIssues: [],
  comments: [],
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn().mockResolvedValue(mockEpic),
  getEpic: vi.fn().mockResolvedValue(mockEpic),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  createTechnicalDesign: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
})

describe('runEpicCommand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createEpic and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runEpicCommand(['create', '--title', 'My Epic', '--body', 'Epic body'], tracker)

    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'My Epic', body: 'Epic body', labels: [] })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('splits --labels on comma', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runEpicCommand(['create', '--title', 'T', '--body', 'B', '--labels', 'bug,feature'], tracker)

    expect(tracker.createEpic).toHaveBeenCalledWith({ title: 'T', body: 'B', labels: ['bug', 'feature'] })
    output.mockRestore()
  })

  it('calls getEpic and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runEpicCommand(['get', '42'], tracker)

    expect(tracker.getEpic).toHaveBeenCalledWith('42')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('exits with code 1 for unknown subcommand', async () => {
    const tracker = makeTracker()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })

    await expect(runEpicCommand(['unknown'], tracker)).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockRestore()
  })
})
