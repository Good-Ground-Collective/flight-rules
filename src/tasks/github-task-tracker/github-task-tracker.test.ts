import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubTaskTracker } from './github-task-tracker.js'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
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

  it('returns an epic with no child issues when body has no fr-tickets comment', async () => {
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

    const epic = await tracker.getEpic('42')
    expect(epic.id).toBe('42')
    expect(epic.childIssues).toEqual([])
    expect(epic.tdd).toBeUndefined()
  })
})

describe('GitHubTracker.linkTicketToEpic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends the ticket number to the epic body', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({
      data: { number: 10, body: 'Epic body' },
    } as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 10,
        body: expect.stringContaining('<!-- fr-tickets: [7] -->') as string,
      }),
    )
  })

  it('does not duplicate a ticket already in the list', async () => {
    const tracker = makeTracker()
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get)
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update)

    mockGet.mockResolvedValueOnce({
      data: { number: 10, body: 'Epic body\n<!-- fr-tickets: [7] -->' },
    } as never)

    await tracker.linkTicketToEpic('7', '10')

    expect(mockUpdate).not.toHaveBeenCalled()
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
    const mockGql = vi.mocked(tracker.gql)

    const body =
      'Epic body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\ntddId: 3\n```\n\n</details>'
    mockGet.mockResolvedValueOnce({
      data: { number: 42, state: 'open', labels: [], title: 'My Epic', body, updated_at: '2026-01-01T00:00:00Z', assignee: null },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)
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

    const body =
      'Ticket body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>'
    mockGet.mockResolvedValueOnce({
      data: { number: 7, state: 'open', labels: [], title: 'Fix login', body, updated_at: '2026-01-01T00:00:00Z', assignee: null },
    } as never)
    mockListComments.mockResolvedValueOnce({ data: [] } as never)

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
