import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createUsersCommand } from '../command.js'
import type { TaskTracker } from '../../../task-tracker/task-tracker.js'

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  blockTicket: vi.fn(),
  unblockTicket: vi.fn(),
  transitionTicket: vi.fn(),
  listTransitions: vi.fn().mockResolvedValue([]),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  updateEpicDescription: vi.fn(),
  updateTicketDescription: vi.fn(),
  updateInitiativeDescription: vi.fn(),
  createTechnicalDesign: vi.fn(),
  createInitiative: vi.fn(),
  getInitiative: vi.fn(),
  linkEpicToInitiative: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
  addAttachment: vi.fn(),
  getUsers: vi.fn(),
  ping: vi.fn(),
})

const run = (tracker: TaskTracker, args: string[]) =>
  createUsersCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('users get', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes JSON array of user logins to stdout', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getUsers).mockResolvedValue(['alice', 'bob'])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get'])
    expect(output).toHaveBeenCalledWith('["alice","bob"]\n')
  })

  it('writes empty array when org has no members', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getUsers).mockResolvedValue([])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get'])
    expect(output).toHaveBeenCalledWith('[]\n')
  })
})
