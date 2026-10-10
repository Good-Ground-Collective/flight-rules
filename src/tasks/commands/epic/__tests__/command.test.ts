import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommanderError } from 'commander'
import type { TaskTracker, Epic, Ticket } from '../../../task-tracker/task-tracker.js'
import type { PullRequestHost, OpenPullRequest } from '../../../../pr/pull-request-host/pull-request-host.js'
import { createEpicCommand } from '../command.js'

const mockEpic: Epic = {
  id: '42',
  size: 'epic',
  status: 'open',
  labels: ['epic'],
  title: 'My Epic',
  body: 'Epic body',
  childIssues: [],
  comments: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
}

const child = (id: string, blockedBy: string[] = [], status = 'open'): Ticket => ({
  id,
  size: 'ticket',
  status,
  labels: ['ticket'],
  title: `Ticket ${id}`,
  body: 'B',
  comments: [],
  assignee: null,
  attachments: [],
  reporter: null,
  issueType: 'Story',
  blockedBy,
  blocking: [],
  metadata: {},
  updatedAt: '2026-01-01T00:00:00Z',
})

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn().mockResolvedValue(mockEpic),
  getEpic: vi.fn().mockResolvedValue(mockEpic),
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
  updateEpicDescription: vi.fn().mockResolvedValue(mockEpic),
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

const makeHost = (open: OpenPullRequest[] = []): PullRequestHost => ({
  createPullRequest: vi.fn(),
  commentOnPullRequest: vi.fn(),
  listOpenPullRequestsForTickets: vi.fn().mockResolvedValue(open),
  defaultBranch: vi.fn().mockResolvedValue('main'),
  requestReviewers: vi.fn(),
})

const run = (tracker: TaskTracker, args: string[], host: PullRequestHost = makeHost()) =>
  createEpicCommand(() => tracker, () => host).exitOverride().parseAsync(args, { from: 'user' })

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

  it('rejects "create" and "edit" when the body references a machine-local path', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['create', '--title', 'T', '--body', 'Spec at ~/specs/e.md'])).rejects.toThrow(
      'references files on this machine',
    )
    await expect(run(tracker, ['edit', '42', '--body', 'file:///tmp/spec.html'])).rejects.toThrow(
      'references files on this machine',
    )
    expect(tracker.createEpic).not.toHaveBeenCalled()
    expect(tracker.updateEpicDescription).not.toHaveBeenCalled()
  })

  it('rejects "create" when neither --body nor --body-file is given', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['create', '--title', 'T'])).rejects.toThrow('one of --body or --body-file')
    expect(tracker.createEpic).not.toHaveBeenCalled()
  })


  it('calls updateEpicDescription and prints JSON for "edit"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '42', '--body', 'Rewritten body'])
    expect(tracker.updateEpicDescription).toHaveBeenCalledWith('42', { body: 'Rewritten body' })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockEpic) + '\n')
    output.mockRestore()
  })

  it('passes --title and comma-split --labels through "edit"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '42', '--body', 'B', '--title', 'New Title', '--labels', 'bug,ui'])
    expect(tracker.updateEpicDescription).toHaveBeenCalledWith('42', {
      body: 'B',
      title: 'New Title',
      labels: ['bug', 'ui'],
    })
    output.mockRestore()
  })

  it('rejects "edit" when neither --body nor --body-file is given', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['edit', '42'])).rejects.toThrow('one of --body or --body-file')
    expect(tracker.updateEpicDescription).not.toHaveBeenCalled()
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

  it('prints dependency-ordered waves for "plan"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getEpic).mockResolvedValue({
      ...mockEpic,
      childIssues: [child('1'), child('2', ['1'])],
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['plan', '42'])

    expect(tracker.getEpic).toHaveBeenCalledWith('42')
    const written = vi.mocked(output).mock.calls[0]?.[0]
    expect(written).toContain('"waves"')
    const parsed: { waves: { id: string }[][]; cycles: string[] } = JSON.parse(String(written))
    expect(parsed.waves.map((w) => w.map((t) => t.id))).toEqual([['1'], ['2']])
    expect(parsed.cycles).toEqual([])
    output.mockRestore()
  })

  it('exits non-zero when a cycle is detected for "plan"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getEpic).mockResolvedValue({
      ...mockEpic,
      childIssues: [child('1', ['2']), child('2', ['1'])],
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(run(tracker, ['plan', '42'])).rejects.toThrow('dependency cycle')

    expect(output).toHaveBeenCalled() // JSON still printed before throwing
    output.mockRestore()
  })

  it('prints the review hand-off for "review-plan"', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getEpic).mockResolvedValue({
      ...mockEpic,
      childIssues: [child('1', [], 'In Review'), child('2', ['1']), child('3', [], 'closed')],
    })
    const host = makeHost([
      { ticket: '1', number: 7, url: 'https://x/pull/7', headRefName: 'feat/1-a', baseRefName: 'main', title: 'feat(1): a' },
    ])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await run(tracker, ['review-plan', '42'], host)

    expect(host.listOpenPullRequestsForTickets).toHaveBeenCalledWith(['1'])
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        epic: { id: '42', title: 'My Epic' },
        defaultBranch: 'main',
        route: 'simple',
        reasons: [],
        blocked: [
          {
            ticketId: '1',
            title: 'Ticket 1',
            wave: 0,
            blockedBy: [],
            pr: { number: 7, url: 'https://x/pull/7', headRefName: 'feat/1-a', baseRefName: 'main' },
          },
        ],
        unblocksOnMerge: ['2'],
      }) + '\n',
    )
    output.mockRestore()
  })

  it('throws after printing when "review-plan" finds a cycle', async () => {
    const tracker = makeTracker()
    vi.mocked(tracker.getEpic).mockResolvedValue({
      ...mockEpic,
      childIssues: [child('1', ['2']), child('2', ['1'])],
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(run(tracker, ['review-plan', '42'])).rejects.toThrow('dependency cycle')

    expect(output).toHaveBeenCalled()
    output.mockRestore()
  })

  it('calls linkEpicToInitiative for "link-initiative"', async () => {
    const tracker = makeTracker()
    await run(tracker, ['link-initiative', '19', '--initiative', '7'])
    expect(tracker.linkEpicToInitiative).toHaveBeenCalledWith('19', '7')
  })

  it('rejects "link-initiative" when --initiative is missing', async () => {
    const tracker = makeTracker()
    const errOutput = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(run(tracker, ['link-initiative', '19'])).rejects.toThrow(CommanderError)
    expect(tracker.linkEpicToInitiative).not.toHaveBeenCalled()
    errOutput.mockRestore()
  })
})
