import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adfBuilder, type AdfDocNode } from '../adf.js'
import { jiraAdfMetadataService } from '../adf-metadata.js'
import type { EntityMetadata } from '../../task-tracker/task-tracker.js'

const request = vi.hoisted(() => vi.fn())
vi.mock('../jira-client.js', () => ({
  JiraClient: class {
    request = request
  },
}))

import { JiraTaskTracker } from '../jira-task-tracker.js'

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
    reporter?: string
    issuetype?: string
    attachment?: unknown[]
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
    ...(fields.reporter !== undefined ? { reporter: { accountId: fields.reporter } } : {}),
    ...(fields.issuetype !== undefined ? { issuetype: { name: fields.issuetype } } : {}),
    ...(fields.attachment !== undefined ? { attachment: fields.attachment } : {}),
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
        return Promise.resolve(issue('PROJ-1', { summary: 'My Epic', description: descriptionWith('Epic body', { notes: 'ctx' }) }))
      if (method === 'GET' && path === '/search/jql') return Promise.resolve({ issues: [] })
      throw new Error(`unexpected ${method} ${path}`)
    })

    const epic = await makeTracker().createEpic({ title: 'My Epic', body: 'Epic body', labels: [], metadata: { notes: 'ctx' } })

    expect(epic.id).toBe('PROJ-1')
    expect(epic.title).toBe('My Epic')
    expect(epic.size).toBe('epic')
    expect(epic.metadata).toEqual({ notes: 'ctx' })
    expect(epic.childIssues).toEqual([])

    const body = postCallBody()
    expect(body.fields['issuetype']).toEqual({ name: 'Epic' })
    expect(body.fields['project']).toEqual({ key: 'PROJ' })
    expect(jiraAdfMetadataService.parse(body.fields['description'] as AdfDocNode)).toEqual({ notes: 'ctx' })
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

  it('omits parent entirely when no epicId is given', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (path.startsWith('/issue/createmeta')) return Promise.resolve(createMeta)
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'POST' && path === '/issue') return Promise.resolve({ id: 'id-PROJ-3', key: 'PROJ-3' })
      if (method === 'GET' && path === '/issue/PROJ-3')
        return Promise.resolve(issue('PROJ-3', { summary: 'Standalone' }))
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().createTicket({ title: 'Standalone', body: 'do the thing', labels: [] })

    expect(ticket.id).toBe('PROJ-3')
    expect(ticket.size).toBe('ticket')

    const body = postCallBody()
    expect(body.fields['issuetype']).toEqual({ name: 'Story' })
    // Jira rejects `parent: {}`, so the key has to be absent rather than undefined.
    expect(body.fields).not.toHaveProperty('parent')
  })
})

describe('JiraTaskTracker markdown ⇄ ADF descriptions', () => {
  beforeEach(() => {
    request.mockReset()
  })

  const layeredBody = [
    '## Problem Statement',
    '',
    'Markdown renders raw in Jira.',
    '',
    '- [ ] renders formatted',
    '',
    '<details><summary>Guided Walkthrough</summary>',
    '',
    '```sh',
    'npm test',
    '```',
    '',
    '</details>',
  ].join('\n')

  it('stores structured ADF on create and returns the original markdown on get', async () => {
    let storedDescription: AdfDocNode | undefined
    request.mockImplementation((method: string, path: string, body?: unknown) => {
      if (path.startsWith('/issue/createmeta')) return Promise.resolve(createMeta)
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'POST' && path === '/issue') {
        storedDescription = (body as { fields: { description: AdfDocNode } }).fields.description
        return Promise.resolve({ id: 'id-PROJ-4', key: 'PROJ-4' })
      }
      if (method === 'GET' && path === '/issue/PROJ-4')
        return Promise.resolve(
          issue('PROJ-4', {
            summary: 'Structured',
            ...(storedDescription !== undefined ? { description: storedDescription } : {}),
          }),
        )
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().createTicket({
      title: 'Structured',
      body: layeredBody,
      epicId: 'PROJ-1',
      labels: [],
      metadata: { notes: 'ctx' },
    })

    const types = (storedDescription?.content ?? []).map((node) => node.type)
    expect(types).toContain('heading')
    expect(types).toContain('taskList')
    expect(types).toContain('expand')
    expect(types.filter((t) => t === 'paragraph').length).toBeGreaterThan(0)

    expect(ticket.body).toBe(layeredBody)
    expect(ticket.metadata).toEqual({ notes: 'ctx' })
  })

  it('folds a body-borne LLM Context details block into the single metadata expand', async () => {
    const bodyWithMetadataBlock = `intro\n\n<details>\n<summary>LLM Context</summary>\n\n\`\`\`yaml\nnotes: from-body\n\`\`\`\n\n</details>`
    let storedDescription: AdfDocNode | undefined
    request.mockImplementation((method: string, path: string, body?: unknown) => {
      if (path.startsWith('/issue/createmeta')) return Promise.resolve(createMeta)
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'POST' && path === '/issue') {
        storedDescription = (body as { fields: { description: AdfDocNode } }).fields.description
        return Promise.resolve({ id: 'id-PROJ-5', key: 'PROJ-5' })
      }
      if (method === 'GET' && path === '/issue/PROJ-5')
        return Promise.resolve(
          issue('PROJ-5', { ...(storedDescription !== undefined ? { description: storedDescription } : {}) }),
        )
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().createTicket({
      title: 'T',
      body: bodyWithMetadataBlock,
      epicId: 'PROJ-1',
      labels: [],
    })

    const expands = (storedDescription?.content ?? []).filter((node) => node.type === 'expand')
    expect(expands).toHaveLength(1)
    expect(ticket.metadata).toEqual({ notes: 'from-body' })
    expect(ticket.body).toBe('intro')
  })
})

describe('JiraTaskTracker.updateTicketDescription', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('rewrites the body, preserves the existing metadata, and sets summary + labels', async () => {
    let stored = descriptionWith('old body', { tddId: 5 })
    request.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(issue('PROJ-2', { summary: 'New Title', description: stored, labels: ['x'] }))
      if (method === 'PUT' && path === '/issue/PROJ-2') {
        stored = (body as { fields: { description: AdfDocNode } }).fields.description
        return Promise.resolve(undefined)
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().updateTicketDescription('PROJ-2', {
      body: 'new body',
      title: 'New Title',
      labels: ['x'],
    })

    const put = request.mock.calls.find(([method, path]) => method === 'PUT' && path === '/issue/PROJ-2')
    const fields = (put?.[2] as { fields: Record<string, unknown> }).fields
    expect(fields['summary']).toBe('New Title')
    expect(fields['labels']).toEqual(['x'])
    expect(jiraAdfMetadataService.parse(fields['description'] as AdfDocNode)).toEqual({ tddId: 5 })
    expect(ticket.body).toBe('new body')
    expect(ticket.metadata).toEqual({ tddId: 5 })
  })

  it('omits summary and labels from the update when title/labels are not supplied', async () => {
    let stored = descriptionWith('old body', { tddId: 5 })
    request.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issue('PROJ-2', { description: stored }))
      if (method === 'PUT' && path === '/issue/PROJ-2') {
        stored = (body as { fields: { description: AdfDocNode } }).fields.description
        return Promise.resolve(undefined)
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().updateTicketDescription('PROJ-2', { body: 'new body' })

    const put = request.mock.calls.find(([method, path]) => method === 'PUT' && path === '/issue/PROJ-2')
    const fields = (put?.[2] as { fields: Record<string, unknown> }).fields
    expect(fields).not.toHaveProperty('summary')
    expect(fields).not.toHaveProperty('labels')
  })
})

describe('JiraTaskTracker.updateEpicDescription', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('rewrites the epic body while preserving its metadata block', async () => {
    let stored = descriptionWith('old body', { notes: 'keep me' })
    request.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-1')
        return Promise.resolve(issue('PROJ-1', { summary: 'Epic', description: stored }))
      if (method === 'GET' && path === '/search/jql') return Promise.resolve({ issues: [] })
      if (method === 'PUT' && path === '/issue/PROJ-1') {
        stored = (body as { fields: { description: AdfDocNode } }).fields.description
        return Promise.resolve(undefined)
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    const epic = await makeTracker().updateEpicDescription('PROJ-1', { body: 'brand new epic body' })

    const put = request.mock.calls.find(([method, path]) => method === 'PUT' && path === '/issue/PROJ-1')
    const fields = (put?.[2] as { fields: Record<string, unknown> }).fields
    expect(jiraAdfMetadataService.parse(fields['description'] as AdfDocNode)).toEqual({ notes: 'keep me' })
    expect(epic.body).toBe('brand new epic body')
    expect(epic.metadata).toEqual({ notes: 'keep me' })
  })
})

describe('JiraTaskTracker.updateInitiativeDescription', () => {
  beforeEach(() => {
    request.mockReset()
  })

  const linkTypes = {
    issueLinkTypes: [
      { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      { id: '2', name: 'Polaris issue link', inward: 'is implemented by', outward: 'implements' },
    ],
  }

  it('writes the body straight through (no metadata block) and sets the summary', async () => {
    let stored = jiraAdfMetadataService.splice(adfBuilder.doc('old idea'), {})
    request.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes)
      if (method === 'GET' && path === '/issue/PROJ-7')
        return Promise.resolve({ ...issue('PROJ-7', { summary: 'Idea', description: stored }) })
      if (method === 'PUT' && path === '/issue/PROJ-7') {
        stored = (body as { fields: { description: AdfDocNode } }).fields.description
        return Promise.resolve(undefined)
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    const initiative = await makeTracker().updateInitiativeDescription('PROJ-7', {
      body: 'new idea body',
      title: 'New Idea',
    })

    const put = request.mock.calls.find(([method, path]) => method === 'PUT' && path === '/issue/PROJ-7')
    const fields = (put?.[2] as { fields: Record<string, unknown> }).fields
    expect(fields['summary']).toBe('New Idea')
    const description = fields['description'] as AdfDocNode
    expect(description.content.some((node) => node.type === 'expand')).toBe(false)
    expect(initiative.body).toBe('new idea body')
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
        return Promise.resolve(issue('PROJ-1', { summary: 'Epic', description: descriptionWith('body', {}) }))
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

  it('carries attachments, reporter, and issueType on children while the epic request stays lean', async () => {
    const child = issue('PROJ-3', {
      reporter: 'acct-42',
      issuetype: 'Story',
      attachment: [{ id: '200', filename: 'log.txt', mimeType: 'text/plain' }],
    })
    request.mockImplementation((method: string, path: string, _body?: unknown, params?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-1')
        return Promise.resolve(issue('PROJ-1', { summary: 'Epic', description: descriptionWith('body', {}) }))
      if (method === 'GET' && path === '/search/jql') {
        expect(params?.['fields']).toContain('attachment,reporter,issuetype')
        return Promise.resolve({ issues: [child], total: 1, startAt: 0, maxResults: 100 })
      }
      throw new Error(`unexpected ${method} ${path}`)
    })

    const epic = await makeTracker().getEpic('PROJ-1')

    const [c] = epic.childIssues
    expect(c?.reporter).toBe('acct-42')
    expect(c?.issueType).toBe('Story')
    expect(c?.attachments).toEqual([{ id: '200', filename: 'log.txt', mimeType: 'text/plain' }])

    const epicGet = request.mock.calls.find(([method, path]) => method === 'GET' && path === '/issue/PROJ-1')
    const epicParams = epicGet?.[3] as { fields: string }
    expect(epicParams.fields).not.toContain('attachment')
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
            description: descriptionWith('the body', { tddId: 5 }),
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

    expect(ticket.size).toBe('ticket')
    expect(ticket.metadata).toEqual({ tddId: 5 })
    expect(ticket.body).toBe('the body')
    expect(ticket.assignee).toBe('acct-7')
    expect(ticket.blockedBy).toEqual(['PROJ-8'])
    expect(ticket.blocking).toEqual(['PROJ-9'])
  })

  it('maps attachments, reporter accountId, and issue type name, and requests the extra fields', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(
          issue('PROJ-2', {
            reporter: 'acct-42',
            issuetype: 'Bug',
            attachment: [
              { id: '100', filename: 'shot.png', mimeType: 'image/png', size: 2048 },
              { id: '101' },
            ],
          }),
        )
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().getTicket('PROJ-2')

    expect(ticket.reporter).toBe('acct-42')
    expect(ticket.issueType).toBe('Bug')
    expect(ticket.attachments).toEqual([
      { id: '100', filename: 'shot.png', mimeType: 'image/png', size: 2048 },
      { id: '101', filename: '', mimeType: 'application/octet-stream' },
    ])

    const get = request.mock.calls.find(([method, path]) => method === 'GET' && path === '/issue/PROJ-2')
    const params = get?.[3] as { fields: string }
    expect(params.fields).toContain('attachment,reporter,issuetype')
  })

  it('defaults reporter to null and issueType to "unknown" when the fields are absent', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(blocksLinkTypes)
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issue('PROJ-2', {}))
      throw new Error(`unexpected ${method} ${path}`)
    })

    const ticket = await makeTracker().getTicket('PROJ-2')

    expect(ticket.reporter).toBeNull()
    expect(ticket.issueType).toBe('unknown')
    expect(ticket.attachments).toEqual([])
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

describe('JiraTaskTracker.transitionTicket', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('resolves the transition whose target status matches (case-insensitively) and POSTs its id', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-1/transitions') {
        return Promise.resolve({
          transitions: [
            { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
            { id: '31', name: 'In Review', to: { name: 'In Review' } },
          ],
        })
      }
      return Promise.resolve(undefined)
    })

    await makeTracker().transitionTicket('PROJ-1', 'in review')

    const post = request.mock.calls.find(([method, path]) => method === 'POST' && path === '/issue/PROJ-1/transitions')
    expect(post?.[2]).toEqual({ transition: { id: '31' } })
  })

  it('throws with the available targets when no transition reaches the requested status', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-1/transitions') {
        return Promise.resolve({ transitions: [{ id: '21', name: 'In Progress', to: { name: 'In Progress' } }] })
      }
      return Promise.resolve(undefined)
    })

    await expect(makeTracker().transitionTicket('PROJ-1', 'Done')).rejects.toThrow(/available: In Progress/)
    expect(request.mock.calls.some(([method]) => method === 'POST')).toBe(false)
  })
})
