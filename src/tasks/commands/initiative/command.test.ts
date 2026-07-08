import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, Initiative } from '../../task-tracker/task-tracker.js'
import { createInitiativeCommand } from './command.js'

const mockInitiative: Initiative = {
  id: '7',
  title: 'Q3 Platform',
  body: 'The big push',
  epics: [{ id: '19', title: 'Decomposition' }],
}

const makeTracker = (): Pick<TaskTracker, 'createInitiative' | 'getInitiative'> => ({
  createInitiative: vi.fn().mockResolvedValue(mockInitiative),
  getInitiative: vi.fn().mockResolvedValue(mockInitiative),
})

const run = (tracker: Pick<TaskTracker, 'createInitiative' | 'getInitiative'>, args: string[]) =>
  createInitiativeCommand(() => tracker as TaskTracker)
    .exitOverride()
    .parseAsync(args, { from: 'user' })

describe('initiative command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createInitiative and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'Q3 Platform', '--body', 'The big push'])
    expect(tracker.createInitiative).toHaveBeenCalledWith({ title: 'Q3 Platform', body: 'The big push' })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + '\n')
    output.mockRestore()
  })

  it('calls getInitiative and prints JSON for "get"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7'])
    expect(tracker.getInitiative).toHaveBeenCalledWith('7')
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + '\n')
    output.mockRestore()
  })

  it('rejects "create" when --title is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['create', '--body', 'B'])).rejects.toThrow(CommanderError)
    expect(tracker.createInitiative).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})
