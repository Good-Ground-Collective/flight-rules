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
          createMilestone: vi.fn(),
          getMilestone: vi.fn(),
          listForRepo: vi.fn(),
        },
        orgs: {
          listMembers: vi.fn(),
        },
        repos: {
          get: vi.fn(),
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

describe('GitHubTracker.getEpic metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates metadata from the body sentinel block', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql)

    const body =
      'Epic body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\ntddId: 3\n```\n\n</details>'
    mockGet.mockResolvedValueOnce({
      data: { number: 42, state: 'open', labels: [], title: 'My Epic', body, updated_at: '2026-01-01T00:00:00Z', assignee: null },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)
    mockRequest.mockResolvedValue({ data: [] } as never)
    // getEpic sees tddId: 3 and calls getTechnicalDesign('3') — stub the gql response
    mockGql.mockResolvedValueOnce({
      repository: {
        discussion: { number: 3, body: 'TDD body', updatedAt: '2026-01-01T00:00:00Z', comments: { nodes: [] } },
      },
    } as never)

    const epic = await tracker.getEpic('42')
    expect(epic.metadata.tddId).toBe(3)
  })
})

describe('GitHubTracker.getTicket metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates metadata from the body sentinel block', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    const body =
      'Ticket body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>'
    mockGet.mockResolvedValueOnce({
      data: { number: 7, state: 'open', labels: [], title: 'Fix login', body, updated_at: '2026-01-01T00:00:00Z', assignee: null },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)
    mockRequest.mockResolvedValue({ data: [] } as never)

    const ticket = await tracker.getTicket('7')
    expect(ticket.metadata.epicId).toBe(10)
  })
})

describe('GitHubTracker.updateEpicMetadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the epic body, splices the patch, and updates the issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({ data: { body: 'Epic body' } } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.updateEpicMetadata('42', { tddId: 7 })

    expect(mockGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'proj', issue_number: 42 })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 42,
        body: expect.stringContaining('tddId: 7') as string,
      }),
    )
  })
})

describe('GitHubTracker.updateTicketMetadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the ticket body, splices the patch, and updates the issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({ data: { body: 'Ticket body' } } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.updateTicketMetadata('7', { notes: 'Use JWT rotation' })

    expect(mockGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'proj', issue_number: 7 })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 7,
        body: expect.stringContaining('Use JWT rotation') as string,
      }),
    )
  })
})

describe('GitHubTracker.updateTddMetadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the discussion by node id and calls the update mutation', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql)

    mockGql
      .mockResolvedValueOnce({
        repository: { discussion: { id: 'D_kwDOABC123', body: 'TDD body' } },
      } as never)
      .mockResolvedValueOnce({ updateDiscussion: { discussion: { number: 3 } } } as never)

    await tracker.updateTddMetadata('3', { epicId: 10 })

    expect(mockGql).toHaveBeenCalledTimes(2)
    const mutVars = mockGql.mock.calls[1]?.[1] as { discussionId: string; body: string } | undefined
    expect(mutVars?.discussionId).toBe('D_kwDOABC123')
    expect(mutVars?.body).toContain('epicId: 10')
  })
})

describe('GitHubTracker.createTechnicalDesign metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes epicId into TDD body and tddId back to epic body', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql)
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGql
      .mockResolvedValueOnce({
        repository: { id: 'R_abc', discussionCategory: { id: 'DC_abc' } },
      } as never)
      .mockResolvedValueOnce({
        createDiscussion: {
          discussion: { number: 5, body: 'TDD body', updatedAt: '2026-01-01T00:00:00Z' },
        },
      } as never)

    mockGet.mockResolvedValueOnce({ data: { body: 'Epic body' } } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.createTechnicalDesign({ title: 'Auth TDD', body: 'TDD body', epicId: '10' })

    // The mutation body should contain epicId: 10 in the metadata block
    const createArgs = mockGql.mock.calls[1] as [string, Record<string, unknown>] | undefined
    expect(createArgs?.[1]?.['body']).toContain('epicId: 10')

    // The issues.update call should write tddId: 5 to the epic body
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('tddId: 5') as string,
      }),
    )
  })
})

describe('GitHubTracker.getTechnicalDesign metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('populates metadata from the body sentinel block', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql)

    const body =
      'TDD body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>'
    mockGql.mockResolvedValueOnce({
      repository: {
        discussion: {
          number: 5,
          body,
          updatedAt: '2026-01-01T00:00:00Z',
          comments: { nodes: [] },
        },
      },
    } as never)

    const tdd = await tracker.getTechnicalDesign('5')
    expect(tdd.metadata.epicId).toBe(10)
    expect(tdd.epicId).toBe('10')
  })
})

describe('GitHubTracker.getUsers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns login strings for all org members', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockListMembers = vi.mocked(tracker.octokit.rest.orgs.listMembers)
    mockListMembers.mockResolvedValueOnce({
      data: [{ login: 'alice' }, { login: 'bob' }],
    } as never)
    const result = await tracker.getUsers()
    expect(result).toEqual(['alice', 'bob'])
    expect(mockListMembers).toHaveBeenCalledWith({ org: 'acme', per_page: 100 })
  })

  it('returns empty array when org has no members', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockListMembers = vi.mocked(tracker.octokit.rest.orgs.listMembers)
    mockListMembers.mockResolvedValueOnce({ data: [] } as never)
    const result = await tracker.getUsers()
    expect(result).toEqual([])
  })
})

describe('GitHubTracker.createInitiative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a milestone and maps it to an Initiative', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.createMilestone)
    mockCreate.mockResolvedValueOnce({
      data: { number: 7, title: 'Q3 Platform', description: 'The big push' },
    } as never)

    const initiative = await tracker.createInitiative({ title: 'Q3 Platform', body: 'The big push' })

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      title: 'Q3 Platform',
      description: 'The big push',
    })
    expect(initiative).toEqual({ id: '7', size: 'initiative', title: 'Q3 Platform', body: 'The big push', epics: [] })
  })
})

describe('GitHubTracker.linkEpicToInitiative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets the epic issue milestone to the initiative number', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)
    mockUpdate.mockResolvedValueOnce({ data: {} } as never)

    await tracker.linkEpicToInitiative('19', '7')

    expect(mockUpdate).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      issue_number: 19,
      milestone: 7,
    })
  })
})

describe('GitHubTracker.getInitiative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the milestone with its epic-labelled issues', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGetMilestone = vi.mocked(tracker.octokit.rest.issues.getMilestone)
    // @ts-expect-error — accessing private field for test setup
    const mockListForRepo = vi.mocked(tracker.octokit.rest.issues.listForRepo)
    mockGetMilestone.mockResolvedValueOnce({
      data: { number: 7, title: 'Q3 Platform', description: 'The big push' },
    } as never)
    mockListForRepo.mockResolvedValueOnce({
      data: [
        { number: 19, title: 'Decomposition' },
        { number: 30, title: 'Rollout' },
      ],
    } as never)

    const initiative = await tracker.getInitiative('7')

    expect(mockGetMilestone).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      milestone_number: 7,
    })
    expect(mockListForRepo).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      milestone: '7',
      labels: 'epic',
      state: 'all',
    })
    expect(initiative).toEqual({
      id: '7',
      size: 'initiative',
      title: 'Q3 Platform',
      body: 'The big push',
      epics: [
        { id: '19', title: 'Decomposition' },
        { id: '30', title: 'Rollout' },
      ],
    })
  })
})

describe('GitHubTracker.ping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the configured repo to verify reachability', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.repos.get)
    mockGet.mockResolvedValueOnce({ data: { full_name: 'acme/proj' } } as never)
    await tracker.ping()
    expect(mockGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'proj' })
  })

  it('propagates the error when the repo is unreachable', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.repos.get)
    mockGet.mockRejectedValueOnce(new Error('Not Found'))
    await expect(tracker.ping()).rejects.toThrow('Not Found')
  })
})
