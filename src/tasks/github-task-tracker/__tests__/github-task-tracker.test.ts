import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubTaskTracker } from '../github-task-tracker.js'
import { BodyMetadataService } from '../../body-metadata/body-metadata.js'
import { UnsupportedTrackerOperationError } from '../../task-tracker/unsupported-tracker-operation-error.js'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      request: vi.fn(),
      // Defaults to no repo labels, which is the pre-existing behaviour: with
      // nothing to reuse, transitionTicket falls back to the slug it derived.
      paginate: vi.fn().mockResolvedValue([]),
      rest: {
        issues: {
          create: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          createComment: vi.fn(),
          listComments: vi.fn(),
          createMilestone: vi.fn(),
          updateMilestone: vi.fn(),
          getMilestone: vi.fn(),
          listForRepo: vi.fn(),
          addLabels: vi.fn(),
          removeLabel: vi.fn(),
          listLabelsForRepo: vi.fn(),
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

describe('GitHubTracker.createTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  const createdIssue = {
    data: {
      number: 7,
      state: 'open',
      labels: [{ name: 'ticket' }],
      title: 'Standalone',
      body: 'Ticket body',
      assignee: null,
      updated_at: '2026-01-01T00:00:00Z',
    },
  }

  it('links the new ticket to its epic as a sub-issue', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)

    mockCreate.mockResolvedValueOnce(createdIssue as never)
    mockRequest.mockImplementation((route: string) => {
      if (route.startsWith('GET')) return Promise.resolve({ data: [] } as never)
      return Promise.resolve({ data: {} } as never)
    })
    mockGet.mockResolvedValueOnce({ data: { id: 999, number: 7 } } as never)

    await tracker.createTicket({ title: 'Standalone', body: 'Ticket body', epicId: '10', labels: [] })

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: 'acme', repo: 'proj', issue_number: 10, sub_issue_id: 999 },
    )
  })

  it('creates a standalone ticket without touching the sub-issue API when no epicId is given', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockCreate.mockResolvedValueOnce(createdIssue as never)

    const ticket = await tracker.createTicket({ title: 'Standalone', body: 'Ticket body', labels: [] })

    expect(ticket.id).toBe('7')
    expect(ticket.size).toBe('ticket')
    expect(ticket.metadata.epicId).toBeUndefined()
    expect(mockRequest).not.toHaveBeenCalled()
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

describe('GitHubTracker.updateEpicDescription', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rewrites the body preserving metadata, keeps the epic + status labels, and replaces free-form labels', async () => {
    const tracker = makeTracker()
    const existingBody = new BodyMetadataService().splice('old epic body', { notes: 'keep me' })
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockGet.mockResolvedValue({
      data: {
        number: 42,
        state: 'open',
        labels: [{ name: 'epic' }, { name: 'status:in-progress' }, { name: 'stale' }],
        title: 'My Epic',
        body: existingBody,
        updated_at: '2026-01-01T00:00:00Z',
        assignee: null,
      },
    } as never)
    mockUpdate.mockResolvedValue({} as never)
    mockListComments.mockResolvedValue({ data: [] } as never)
    mockRequest.mockResolvedValue({ data: [] } as never)

    await tracker.updateEpicDescription('42', { body: 'brand new epic body', labels: ['bug'] })

    const call = mockUpdate.mock.calls[0]?.[0] as { body: string; labels: string[]; issue_number: number }
    expect(call.issue_number).toBe(42)
    expect(call.body).toContain('brand new epic body')
    expect(call.body).toContain('notes: keep me')
    expect(call.labels).toEqual(['epic', 'status:in-progress', 'bug'])
  })

  it('leaves labels untouched when --labels is not supplied', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments)
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request)

    mockGet.mockResolvedValue({
      data: {
        number: 42,
        state: 'open',
        labels: [{ name: 'epic' }],
        title: 'My Epic',
        body: 'old',
        updated_at: '2026-01-01T00:00:00Z',
        assignee: null,
      },
    } as never)
    mockUpdate.mockResolvedValue({} as never)
    mockListComments.mockResolvedValue({ data: [] } as never)
    mockRequest.mockResolvedValue({ data: [] } as never)

    await tracker.updateEpicDescription('42', { body: 'new' })

    const call = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).not.toHaveProperty('labels')
  })
})

describe('GitHubTracker.updateInitiativeDescription', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates the milestone description and title, then returns the initiative', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockUpdateMilestone = vi.mocked(tracker.octokit.rest.issues.updateMilestone)
    // @ts-expect-error — accessing private field for test setup
    const mockGetMilestone = vi.mocked(tracker.octokit.rest.issues.getMilestone)
    // @ts-expect-error — accessing private field for test setup
    const mockListForRepo = vi.mocked(tracker.octokit.rest.issues.listForRepo)

    mockUpdateMilestone.mockResolvedValue({} as never)
    mockGetMilestone.mockResolvedValue({
      data: { number: 7, title: 'New Idea', description: 'new idea body' },
    } as never)
    mockListForRepo.mockResolvedValue({ data: [] } as never)

    const initiative = await tracker.updateInitiativeDescription('7', { body: 'new idea body', title: 'New Idea' })

    expect(mockUpdateMilestone).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'proj',
      milestone_number: 7,
      description: 'new idea body',
      title: 'New Idea',
    })
    expect(initiative.title).toBe('New Idea')
    expect(initiative.body).toBe('new idea body')
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

describe('GitHubTracker.transitionTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reuses a repo label that differs only in case, rather than creating a duplicate', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const octokit = tracker.octokit
    vi.mocked(octokit.paginate).mockResolvedValue([{ name: 'status:Needs-QA' }] as never)
    vi.mocked(octokit.rest.issues.get).mockResolvedValueOnce({
      data: { number: 7, labels: [{ name: 'ticket' }] },
    } as never)
    vi.mocked(octokit.rest.issues.addLabels).mockResolvedValue({} as never)

    await tracker.transitionTicket('7', 'needs qa')

    expect(vi.mocked(octokit.rest.issues.addLabels)).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['status:Needs-QA'] }),
    )
  })

  it('does not treat the case-variant label it is about to apply as stale', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const octokit = tracker.octokit
    vi.mocked(octokit.paginate).mockResolvedValue([{ name: 'status:Needs-QA' }] as never)
    vi.mocked(octokit.rest.issues.get).mockResolvedValueOnce({
      data: { number: 7, labels: [{ name: 'status:Needs-QA' }] },
    } as never)
    vi.mocked(octokit.rest.issues.addLabels).mockResolvedValue({} as never)

    await tracker.transitionTicket('7', 'needs qa')

    expect(vi.mocked(octokit.rest.issues.removeLabel)).not.toHaveBeenCalled()
  })

  it('swaps any existing status label for the new status:<slug> label', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const issues = tracker.octokit.rest.issues
    vi.mocked(issues.get).mockResolvedValueOnce({
      data: { number: 7, labels: [{ name: 'ticket' }, { name: 'status:to-do' }] },
    } as never)
    vi.mocked(issues.removeLabel).mockResolvedValue({} as never)
    vi.mocked(issues.addLabels).mockResolvedValue({} as never)

    await tracker.transitionTicket('7', 'In Review')

    expect(vi.mocked(issues.removeLabel)).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7, name: 'status:to-do' }),
    )
    expect(vi.mocked(issues.addLabels)).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7, labels: ['status:in-review'] }),
    )
  })

  it('derives Ticket.status from a status:* label over the raw issue state', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const issues = tracker.octokit.rest.issues
    vi.mocked(issues.get).mockResolvedValueOnce({
      data: {
        number: 7,
        state: 'open',
        labels: [{ name: 'ticket' }, { name: 'status:in-progress' }],
        title: 'T',
        body: '',
        assignee: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    } as never)
    vi.mocked(issues.listComments).mockResolvedValueOnce({ data: [] } as never)
    // @ts-expect-error — accessing private field for test setup
    vi.mocked(tracker.octokit.request).mockResolvedValue({ data: [] } as never)

    const ticket = await tracker.getTicket('7')
    expect(ticket.status).toBe('in-progress')
  })
})

describe('GitHubTracker.listTransitions', () => {
  beforeEach(() => vi.clearAllMocks())

  const stubLabels = (tracker: GitHubTaskTracker, names: string[]): void => {
    // @ts-expect-error — accessing private field for test setup
    vi.mocked(tracker.octokit.paginate).mockResolvedValue(
      names.map((name) => ({ name })) as never,
    )
  }

  it('returns repo status labels in human form', async () => {
    const tracker = makeTracker()
    stubLabels(tracker, ['status:in-progress', 'bug', 'status:in-review'])

    await expect(tracker.listTransitions()).resolves.toEqual(['in progress', 'in review'])
  })

  it('returns an empty list when the repo defines no status labels', async () => {
    const tracker = makeTracker()
    stubLabels(tracker, ['bug'])

    await expect(tracker.listTransitions()).resolves.toEqual([])
  })

  it('lowercases so the value round-trips through transitionTicket unchanged', async () => {
    const tracker = makeTracker()
    stubLabels(tracker, ['status:Needs-QA'])

    await expect(tracker.listTransitions()).resolves.toEqual(['needs qa'])
  })

  it('paginates rather than capping at one page', async () => {
    const tracker = makeTracker()
    const many = Array.from({ length: 150 }, (_, index) => `status:s${index}`)
    stubLabels(tracker, many)

    await expect(tracker.listTransitions()).resolves.toHaveLength(150)
    // @ts-expect-error — accessing private field for the assertion
    expect(tracker.octokit.paginate).toHaveBeenCalled()
  })
})

describe('GitHubTracker throws for unsupported label writes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects addLabel with UnsupportedTrackerOperationError naming the remedy', async () => {
    const tracker = makeTracker()

    await expect(tracker.addLabel('7', 'qa')).rejects.toBeInstanceOf(UnsupportedTrackerOperationError)
    await expect(tracker.addLabel('7', 'qa')).rejects.toThrow(/--tracker jira/)
  })

  it('rejects removeLabel with UnsupportedTrackerOperationError naming the remedy', async () => {
    const tracker = makeTracker()

    await expect(tracker.removeLabel('7', 'qa')).rejects.toBeInstanceOf(UnsupportedTrackerOperationError)
    await expect(tracker.removeLabel('7', 'qa')).rejects.toThrow(/--tracker jira/)
  })
})
