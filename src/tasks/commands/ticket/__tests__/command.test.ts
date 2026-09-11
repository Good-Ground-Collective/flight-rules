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
  attachments: [],
  reporter: null,
  issueType: 'Story',
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
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  updateEpicDescription: vi.fn(),
  updateTicketDescription: vi.fn().mockResolvedValue(mockTicket),
  updateInitiativeDescription: vi.fn(),
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

  it('calls updateTicketDescription and prints JSON for "edit"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '7', '--body', 'Rewritten body'])
    expect(tracker.updateTicketDescription).toHaveBeenCalledWith('7', { body: 'Rewritten body' })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockTicket) + '\n')
    output.mockRestore()
  })

  it('passes --title and comma-split --labels through "edit"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '7', '--body', 'B', '--title', 'New Title', '--labels', 'bug,ui'])
    expect(tracker.updateTicketDescription).toHaveBeenCalledWith('7', {
      body: 'B',
      title: 'New Title',
      labels: ['bug', 'ui'],
    })
    output.mockRestore()
  })

  it('rejects "edit" when neither --body nor --body-file is given', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['edit', '7'])).rejects.toThrow('one of --body or --body-file')
    expect(tracker.updateTicketDescription).not.toHaveBeenCalled()
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
        format: 'layered-body',
        markdown: '- [ ] ship it\n- [x] done',
        items: [
          { text: 'ship it', done: false },
          { text: 'done', done: true },
        ],
      }) + '\n',
    )
    output.mockRestore()
  })

  it('returns fixed-when items and the bug-report format for "get --section fixed-when"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getTicket).mockResolvedValue({
      ...mockTicket,
      issueType: 'Bug',
      body: '## Symptom\n\nBroken.\n\n## Fixed When\n\n- [ ] it works\n- [x] test added\n',
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7', '--section', 'fixed-when'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        id: '7',
        section: 'fixed-when',
        format: 'bug-report',
        markdown: '- [ ] it works\n- [x] test added',
        items: [
          { text: 'it works', done: false },
          { text: 'test added', done: true },
        ],
      }) + '\n',
    )
    output.mockRestore()
  })

  // Regression for the placeholder-issueType integration bug: an untyped GitHub
  // issue reaches the command with issueType 'Issue' (what the GitHub adapter
  // yields for `issue.type?.name ?? 'Issue'`) and no metadata.kind. Before the
  // fix the detector treated 'Issue' as an authoritative non-bug type, forced
  // layered-body, and `get --section fixed-when` returned markdown:null/items:[]
  // — silently hiding the bug's verification requirements.
  it('treats a GitHub-untyped ticket (issueType "Issue") with a Symptom body as a bug-report for "get --section fixed-when"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getTicket).mockResolvedValue({
      ...mockTicket,
      issueType: 'Issue',
      metadata: {},
      body: '## Symptom\n\nCrashes on save.\n\n## Fixed When\n\n- [ ] no crash\n- [x] regression test added\n',
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7', '--section', 'fixed-when'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        id: '7',
        section: 'fixed-when',
        format: 'bug-report',
        markdown: '- [ ] no crash\n- [x] regression test added',
        items: [
          { text: 'no crash', done: false },
          { text: 'regression test added', done: true },
        ],
      }) + '\n',
    )
    output.mockRestore()
  })

  it('returns markdown null and empty items for acceptance-criteria on a bug-report body', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getTicket).mockResolvedValue({
      ...mockTicket,
      issueType: 'Bug',
      body: '## Symptom\n\nBroken.\n\n## Fixed When\n\n- [ ] it works\n',
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7', '--section', 'acceptance-criteria'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        id: '7',
        section: 'acceptance-criteria',
        format: 'bug-report',
        markdown: null,
        items: [],
      }) + '\n',
    )
    output.mockRestore()
  })

  it('detects a Jira Bug with no metadata and no recognizable headings as bug-report', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getTicket).mockResolvedValue({
      ...mockTicket,
      issueType: 'Bug',
      metadata: {},
      body: 'Plain description with no level-2 headings at all.\n',
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7', '--section', 'symptom'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        id: '7',
        section: 'symptom',
        format: 'bug-report',
        markdown: null,
      }) + '\n',
    )
    output.mockRestore()
  })

  it('lets metadata.kind override a contradictory heading for "get --section"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getTicket).mockResolvedValue({
      ...mockTicket,
      issueType: 'Bug',
      metadata: { kind: 'story' },
      body: '## Symptom\n\nLooks like a bug body.\n',
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['get', '7', '--section', 'acceptance-criteria'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        id: '7',
        section: 'acceptance-criteria',
        format: 'layered-body',
        markdown: null,
        items: [],
      }) + '\n',
    )
    output.mockRestore()
  })

  it('rejects "get --section" with an unknown section name listing every valid slug', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['get', '7', '--section', 'bogus'])).rejects.toThrow(/unknown section/)
    await expect(run(tracker, ['get', '7', '--section', 'bogus'])).rejects.toThrow(/reproduction-notes/)
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

describe('ticket label command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes before adding and prints the applied labels as JSON', async () => {
    const tracker = makeTracker()
    const calls: string[] = []
    vi.mocked(tracker.removeLabel).mockImplementation(async () => {
      calls.push('remove')
    })
    vi.mocked(tracker.addLabel).mockImplementation(async () => {
      calls.push('add')
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['label', 'PROJ-1', '--add', 'A', '--remove', 'B'])

    expect(tracker.removeLabel).toHaveBeenCalledWith('PROJ-1', 'B')
    expect(tracker.addLabel).toHaveBeenCalledWith('PROJ-1', 'A')
    expect(calls).toEqual(['remove', 'add'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({ id: 'PROJ-1', added: ['A'], removed: ['B'] }) + '\n',
    )
    output.mockRestore()
  })

  it('rejects when neither --add nor --remove is given', async () => {
    const tracker = makeTracker()

    await expect(run(tracker, ['label', 'PROJ-1'])).rejects.toThrow(/--add.*--remove|--remove.*--add/)
    expect(tracker.addLabel).not.toHaveBeenCalled()
    expect(tracker.removeLabel).not.toHaveBeenCalled()
  })
})
