import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskTracker, TechnicalDesign } from '../task-tracker/types.js'
import { runTddCommand } from './tdd.js'

const mockTdd: TechnicalDesign = {
  id: '3',
  epicId: '42',
  body: 'Design doc body',
  comments: [],
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  createTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  getTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  addComment: vi.fn(),
})

describe('runTddCommand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTechnicalDesign and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTddCommand(
      ['create', '--title', 'Auth TDD', '--body', 'Design doc body', '--epic-id', '42'],
      tracker,
    )

    expect(tracker.createTechnicalDesign).toHaveBeenCalledWith({
      title: 'Auth TDD',
      body: 'Design doc body',
      epicId: '42',
    })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTdd) + '\n')
    output.mockRestore()
  })

  it('calls getTechnicalDesign and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runTddCommand(['get', '3'], tracker)

    expect(tracker.getTechnicalDesign).toHaveBeenCalledWith('3')
    output.mockRestore()
  })
})
