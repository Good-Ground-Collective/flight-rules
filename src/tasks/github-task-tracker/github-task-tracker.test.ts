import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubTaskTracker } from './github-task-tracker.js'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      request: vi.fn(),
      rest: {
        issues: {
          create: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          createComment: vi.fn(),
          listComments: vi.fn(),
        },
      },
    }
  }),
}))

vi.mock('@octokit/graphql', () => ({
  graphql: Object.assign(vi.fn(), {
    defaults: vi.fn().mockReturnValue(vi.fn()),
  }),
}))

const makeTracker = () => new GitHubTaskTracker({ token: 'tok', owner: 'acme', repo: 'proj' })

describe('GitHubTracker.createEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a GitHub issue and returns an Epic', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create)
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        state: 'open',
        labels: [{ name: 'epic' }],
        title: 'My Epic',
        body: 'Epic body',
        updated_at: '2026-01-01T00:00:00Z',
      },
    } as never)

    const epic = await tracker.createEpic({ title: 'My Epic', body: 'Epic body', labels: [] })

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      title: 'My Epic',
      body: 'Epic body',
      labels: ['epic'],
    })
    expect(epic.id).toBe('42')
    expect(epic.title).toBe('My Epic')
    expect(epic.childIssues).toEqual([])
    expect(epic.tdd).toBeUndefined()
  })
})

describe('GitHubTracker.getEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an epic with no child issues when it has no sub-issues', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)

    mockGet.mockResolvedValueOnce({
      data: {
        number: 42,
        state: 'open',
        labels: [{ name: 'epic' }],
        title: 'My Epic',
        body: 'Epic body',
        updated_at: '2026-01-01T00:00:00Z',
        assignee: null,
      },
    } as never)

    mockListComments.mockResolvedValueOnce({ data: [] } as never)

    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    mockRequest.mockResolvedValue({ data: [] } as never)

    const epic = await tracker.getEpic('42')
    expect(epic.id).toBe('42')
    expect(epic.childIssues).toEqual([])
    expect(epic.tdd).toBeUndefined()
  })
})

describe('GitHubTracker.getTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates blockedBy and blocking from the dependency endpoints', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockGet.mockResolvedValueOnce({
      data: {
        number: 7,
        state: 'open',
        labels: [{ name: 'ticket' }],
        title: 'Fix login',
        body: 'Details',
        updated_at: '2026-01-01T00:00:00Z',
        assignee: null,
      },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)
    mockRequest.mockImplementation((route: string) => {
      if (route.includes('/dependencies/blocked_by')) return Promise.resolve({ data: [{ number: 3 }] } as never)
      if (route.includes('/dependencies/blocking')) return Promise.resolve({ data: [{ number: 9 }] } as never)
      return Promise.resolve({ data: [] } as never)
    })

    const ticket = await tracker.getTicket('7')

    expect(ticket.blockedBy).toEqual(['3'])
    expect(ticket.blocking).toEqual(['9'])
  })
})

describe('GitHubTracker.linkTicketToEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds the ticket as a native sub-issue of the epic', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)

    mockRequest.mockImplementation((route: string) => {
      if (route.startsWith('GET')) return Promise.resolve({ data: [] } as never)
      return Promise.resolve({ data: {} } as never)
    })
    // resolveIssueId(7) → global id 999
    mockGet.mockResolvedValueOnce({ data: { id: 999, number: 7 } } as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: 'acme', repo: 'proj', issue_number: 10, sub_issue_id: 999 },
    )
  })

  it('does not re-add a ticket already a sub-issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockRequest.mockResolvedValueOnce({ data: [{ number: 7 }] } as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: 'acme', repo: 'proj', issue_number: 10 },
    )
  })
})

describe('GitHubTracker.blockTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds a native blocked_by dependency using the blocker global id', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockRequest.mockImplementation(((route: string) => {
      if (route.startsWith('GET')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    }) as never)
    // resolveIssueId(3) → global id 555
    mockGet.mockResolvedValueOnce({ data: { id: 555, number: 3 } } as never)

    await tracker.blockTicket('7', '3')

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
      { owner: 'acme', repo: 'proj', issue_number: 7, issue_id: 555 },
    )
  })

  it('does not re-add an existing blocker', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    mockRequest.mockResolvedValueOnce({ data: [{ number: 3 }] } as never)

    await tracker.blockTicket('7', '3')

    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects a self-block', async () => {
    const tracker = makeTracker()
    await expect(tracker.blockTicket('7', '7')).rejects.toThrow('cannot block itself')
  })
})

describe('GitHubTracker.unblockTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the blocked_by dependency using the blocker global id', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockGet.mockResolvedValueOnce({ data: { id: 555, number: 3 } } as never)
    mockRequest.mockResolvedValue({ data: {} } as never)

    await tracker.unblockTicket('7', '3')

    expect(mockRequest).toHaveBeenCalledWith(
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}',
      { owner: 'acme', repo: 'proj', issue_number: 7, issue_id: 555 },
    )
  })
})
