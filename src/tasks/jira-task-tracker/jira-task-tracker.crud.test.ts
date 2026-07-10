import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adfBuilder, type AdfDocNode } from './adf.js'
import { jiraAdfMetadataService } from './adf-metadata.js'
import type { EntityMetadata } from '../task-tracker/task-tracker.js'

const request = vi.hoisted(() => vi.fn())
vi.mock('./jira-client.js', () => ({
  JiraClient: class {
    request = request
  },
}))

import { JiraTaskTracker } from './jira-task-tracker.js'

const makeTracker = () =>
  new JiraTaskTracker({ token: 'tok', host: 'acme.atlassian.net', email: 'me@acme.com', project: 'PROJ' })

const descriptionWith = (body: string, metadata: Partial<EntityMetadata>): AdfDocNode =>
  jiraAdfMetadataService.splice(adfBuilder.doc(body), metadata)

const issue = (
  key: string,
  fields: {
    summary?: string
    status?: string
    labels?: string[]
    assignee?: string | null
    description?: AdfDocNode
    parent?: string
    issuelinks?: unknown[]
  },
) => ({
  id: `id-${key}`,
  key,
  fields: {
    summary: fields.summary ?? 'Summary',
    status: { name: fields.status ?? 'To Do' },
    labels: fields.labels ?? [],
    assignee: fields.assignee === undefined ? null : { accountId: fields.assignee },
    description: fields.description ?? null,
    updated: '2026-07-10T00:00:00.000Z',
    ...(fields.parent !== undefined ? { parent: { key: fields.parent } } : {}),
    issuelinks: fields.issuelinks ?? [],
  },
})

const createMeta = { issueTypes: [{ id: '10000', name: 'Epic' }, { id: '10001', name: 'Story' }] }
const blocksLinkTypes = { issueLinkTypes: [{ id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }] }

const postCallBody = (): { fields: Record<string, unknown> } => {
  const call = request.mock.calls.find(([method, path]) => method === 'POST' && path === '/issue')
  return call?.[2] as { fields: Record<string, unknown> }
}

describe('JiraTaskTracker.createEpic', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('creates an Epic-typed issue with metadata spliced into the description', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (path.startsWith('/issue/createmeta')) return Promise.resolve(createMeta)
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'POST' && path === '/issue') return Promise.resolve({ id: 'id-PROJ-1', key: 'PROJ-1' })
      if (method === 'GET' && path === '/issue/PROJ-1')
        return Promise.resolve(issue('PROJ-1', { summary: 'My Epic', description: descriptionWith('Epic body', { size: 'epic' }) }))
      if (method === 'GET' && path === '/search/jql') return Promise.resolve({ issues: [] })
      throw new Error(`unexpected ${method} ${path}`)
    })

    const epic = await makeTracker().createEpic({ title: 'My Epic', body: 'Epic body', labels: [], metadata: { size: 'epic' } })

    expect(epic.id).toBe('PROJ-1')
    expect(epic.title).toBe('My Epic')
    expect(epic.metadata).toEqual({ size: 'epic' })
    expect(epic.childIssues).toEqual([])

    const body = postCallBody()
    expect(body.fields['issuetype']).toEqual({ name: 'Epic' })
    expect(body.fields['project']).toEqual({ key: 'PROJ' })
    expect(jiraAdfMetadataService.parse(body.fields['description'] as AdfDocNode)).toEqual({ size: 'epic' })
  })

  it('throws a clear error when the Epic issue type is unavailable', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (path.startsWith('/issue/createmeta')) return Promise.resolve({ issueTypes: [{ id: '10001', name: 'Story' }] })
      throw new Error(`unexpected ${method} ${path}`)
    })

    await expect(
      makeTracker().createEpic({ title: 'X', body: 'b', labels: [] }),
    ).rejects.toThrow(/Epic.*not available in project PROJ/)
  })
})

describe('JiraTaskTracker.createTicket', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('creates a Story with parent, labels, and assignee set', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (path.startsWith('/issue/createmeta')) return Promise.resolve(createMeta)
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'POST' && path === '/issue') return Promise.resolve({ id: 'id-PROJ-2', key: 'PROJ-2' })
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(issue('PROJ-2', { summary: 'A ticket', parent: 'PROJ-1', assignee: 'acct-1', labels: ['backend'] }))
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().createTicket({
      title: 'A ticket',
      body: 'do the thing',
      epicId: 'PROJ-1',
      labels: ['backend'],
      assignee: 'acct-1',
    })

    expect(ticket.id).toBe('PROJ-2')
    expect(ticket.assignee).toBe('acct-1')
    expect(ticket.labels).toEqual(['backend'])

    const body = postCallBody()
    expect(body.fields['issuetype']).toEqual({ name: 'Story' })
    expect(body.fields['parent']).toEqual({ key: 'PROJ-1' })
    expect(body.fields['assignee']).toEqual({ accountId: 'acct-1' })
    expect(body.fields['labels']).toEqual(['backend'])
  })
})

describe('JiraTaskTracker.getEpic', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('populates childIssues with the planner trio {id, status, blockedBy} via a parent JQL search', async () => {
    const child = issue('PROJ-3', {
      status: 'In Progress',
      issuelinks: [{ type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-9' } }],
    })
    request.mockImplementation((method: string, path: string, _body?: unknown, params?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-1')
        return Promise.resolve(issue('PROJ-1', { summary: 'Epic', description: descriptionWith('body', { size: 'epic' }) }))
      if (method === 'GET' && path === '/search/jql') {
        expect(params?.['jql']).toBe('parent = PROJ-1')
        return Promise.resolve({ issues: [child], total: 1, startAt: 0, maxResults: 100 })
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    const epic = await makeTracker().getEpic('PROJ-1')

    expect(epic.childIssues).toHaveLength(1)
    const [c] = epic.childIssues
    expect(c?.id).toBe('PROJ-3')
    expect(c?.status).toBe('In Progress')
    expect(c?.blockedBy).toEqual(['PROJ-9'])
  })
})

describe('JiraTaskTracker.getTicket', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('round-trips metadata from the description and derives blockedBy/blocking from Blocks links', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(
          issue('PROJ-2', {
            summary: 'Ticket',
            assignee: 'acct-7',
            description: descriptionWith('the body', { size: 'ticket', tddId: 5 }),
            issuelinks: [
              { type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-8' } },
              { type: { name: 'Blocks' }, inwardIssue: { key: 'PROJ-9' } },
              { type: { name: 'Relates' }, outwardIssue: { key: 'PROJ-10' } },
            ],
          }),
        )
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().getTicket('PROJ-2')

    expect(ticket.metadata).toEqual({ size: 'ticket', tddId: 5 })
    expect(ticket.body).toBe('the body')
    expect(ticket.assignee).toBe('acct-7')
    expect(ticket.blockedBy).toEqual(['PROJ-8'])
    expect(ticket.blocking).toEqual(['PROJ-9'])
  })
})

describe('JiraTaskTracker.linkTicketToEpic', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('no-ops when the ticket is already parented to the epic', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issue('PROJ-2', { parent: 'PROJ-1' }))
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().linkTicketToEpic('PROJ-2', 'PROJ-1')

    expect(request.mock.calls.some(([method]) => method === 'PUT')).toBe(false)
  })

  it('sets the parent when the ticket is unparented or parented elsewhere', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issue('PROJ-2', { parent: 'PROJ-99' }))
      if (method === 'PUT' && path === '/issue/PROJ-2') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().linkTicketToEpic('PROJ-2', 'PROJ-1')

    const put = request.mock.calls.find(([method]) => method === 'PUT')
    expect(put?.[2]).toEqual({ fields: { parent: { key: 'PROJ-1' } } })
  })
})
