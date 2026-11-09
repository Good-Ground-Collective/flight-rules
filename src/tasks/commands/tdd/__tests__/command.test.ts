import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, TechnicalDesign } from '../../../task-tracker/task-tracker.js'
import { createTddCommand } from '../command.js'

const mockTdd: TechnicalDesign = {
  id: '3',
  epicId: '42',
  body: 'Design doc body',
  comments: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
}

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  getTicketEpicId: vi.fn(),
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
  createTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  updateTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  getTechnicalDesign: vi.fn().mockResolvedValue(mockTdd),
  createInitiative: vi.fn(),
  getInitiative: vi.fn(),
  linkEpicToInitiative: vi.fn(),
  addComment: vi.fn(),
  addAttachment: vi.fn(),
  getUsers: vi.fn(),
  ping: vi.fn(),
})

const run = (tracker: TaskTracker, args: string[]) =>
  createTddCommand(() => tracker).exitOverride().parseAsync(args, { from: 'user' })

describe('tdd command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createTechnicalDesign and prints JSON for "create"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'Auth TDD', '--body', 'Design doc body', '--epic-id', '42'])
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
    await run(tracker, ['get', '3'])
    expect(tracker.getTechnicalDesign).toHaveBeenCalledWith('3')
    output.mockRestore()
  })

  it('reads the "create" body from --body-file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fr-tdd-'))
    const bodyFile = join(dir, 'tdd.md')
    writeFileSync(bodyFile, 'Design from file')
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['create', '--title', 'T', '--body-file', bodyFile, '--epic-id', '42'])
    expect(tracker.createTechnicalDesign).toHaveBeenCalledWith({ title: 'T', body: 'Design from file', epicId: '42' })
    output.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects "create" when the body references a machine-local path', async () => {
    const tracker = makeTracker()
    await expect(
      run(tracker, ['create', '--title', 'T', '--body', 'Notes: ~/notes.md', '--epic-id', '42']),
    ).rejects.toThrow('references files on this machine')
    expect(tracker.createTechnicalDesign).not.toHaveBeenCalled()
  })

  it('rejects "create" when --epic-id is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['create', '--title', 'T', '--body', 'B'])).rejects.toThrow(CommanderError)
    expect(tracker.createTechnicalDesign).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })

  it('edits a tdd title and body and prints JSON for "edit"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '3', '--title', 'New', '--body', 'Updated body'])
    expect(tracker.updateTechnicalDesign).toHaveBeenCalledWith('3', { title: 'New', body: 'Updated body' })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTdd) + '\n')
    output.mockRestore()
  })

  it('edits only the title when no body is given', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '3', '--title', 'Only title'])
    expect(tracker.updateTechnicalDesign).toHaveBeenCalledWith('3', { title: 'Only title' })
    output.mockRestore()
  })

  it('rejects "edit" with neither title nor body', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['edit', '3'])).rejects.toThrow('new title, a new body, or both')
    expect(tracker.updateTechnicalDesign).not.toHaveBeenCalled()
  })

  it('rejects "edit" when the body references a machine-local path', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['edit', '3', '--body', 'Notes: ~/notes.md'])).rejects.toThrow(
      'references files on this machine',
    )
    expect(tracker.updateTechnicalDesign).not.toHaveBeenCalled()
  })

  it('accepts a machine-local path on "edit" with --allow-local-paths', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '3', '--body', 'Notes: ~/notes.md', '--allow-local-paths'])
    expect(tracker.updateTechnicalDesign).toHaveBeenCalledWith('3', { body: 'Notes: ~/notes.md' })
    output.mockRestore()
  })
})
