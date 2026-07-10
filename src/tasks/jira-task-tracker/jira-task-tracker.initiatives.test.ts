import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adfBuilder } from './adf.js'

const request = vi.hoisted(() => vi.fn())
vi.mock('./jira-client.js', () => ({
  JiraClient: class {
    request = request
  },
}))

import { JiraTaskTracker } from './jira-task-tracker.js'

const makeTracker = (jpdProject: string | null = 'DISC') =>
  new JiraTaskTracker({ token: 'tok', host: 'acme.atlassian.net', email: 'me@acme.com', project: 'PROJ', ...(jpdProject !== null ? { jpdProject } : {}) })

const deliveryType = 'Polaris work item link'
const deliveryLinkTypes = {
  issueLinkTypes: [{ id: '900', name: deliveryType, inward: 'is implemented by', outward: 'implements' }],
}
const discoveryProject = { projectTypeKey: 'product_discovery' }

const postIssueBody = (): { fields: Record<string, unknown> } => {
  const call = request.mock.calls.find(([method, path]) => method === 'POST' && path === '/issue')
  return call?.[2] as { fields: Record<string, unknown> }
}

const postLinkBody = (): Record<string, unknown> => {
  const call = request.mock.calls.find(([method, path]) => method === 'POST' && path === '/issueLink')
  return call?.[2] as Record<string, unknown>
}

describe('JiraTaskTracker.createInitiative', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('creates an Idea-typed issue in the configured JPD project', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/project/DISC') return Promise.resolve(discoveryProject)
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(deliveryLinkTypes)
      if (method === 'POST' && path === '/issue') return Promise.resolve({ id: 'id-DISC-1', key: 'DISC-1' })
      if (method === 'GET' && path === '/issue/DISC-1')
        return Promise.resolve({ id: 'id-DISC-1', key: 'DISC-1', fields: { summary: 'My Idea', description: adfBuilder.doc('idea body'), issuelinks: [] } })
      throw new Error(`unexpected ${method} ${path}`)
    })

    const initiative = await makeTracker().createInitiative({ title: 'My Idea', body: 'idea body' })

    expect(initiative.id).toBe('DISC-1')
    expect(initiative.title).toBe('My Idea')
    expect(initiative.body).toBe('idea body')
    expect(initiative.epics).toEqual([])

    const body = postIssueBody()
    expect(body.fields['project']).toEqual({ key: 'DISC' })
    expect(body.fields['issuetype']).toEqual({ name: 'Idea' })
  })

  it('rejects when no JPD project is configured', async () => {
    request.mockImplementation((method: string, path: string) => {
      throw new Error(`unexpected ${method} ${path}`)
    })

    await expect(makeTracker(null).createInitiative({ title: 'x', body: 'b' })).rejects.toThrow(/JPD project/)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects when the configured project is not a product_discovery project', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/project/DISC') return Promise.resolve({ projectTypeKey: 'software' })
      throw new Error(`unexpected ${method} ${path}`)
    })

    await expect(makeTracker().createInitiative({ title: 'x', body: 'b' })).rejects.toThrow(/product_discovery/)
  })
})

describe('JiraTaskTracker.getInitiative', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('reconstructs linked epics from Polaris issue links, ignoring other link types', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(deliveryLinkTypes)
      if (method === 'GET' && path === '/issue/DISC-1')
        return Promise.resolve({
          id: 'id-DISC-1',
          key: 'DISC-1',
          fields: {
            summary: 'Idea',
            description: adfBuilder.doc('idea body'),
            issuelinks: [
              { type: { name: deliveryType }, outwardIssue: { key: 'PROJ-10' } },
              { type: { name: deliveryType }, inwardIssue: { key: 'PROJ-11' } },
              { type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-99' } },
            ],
          },
        })
      if (method === 'GET' && path === '/issue/PROJ-10')
        return Promise.resolve({ id: 'id-10', key: 'PROJ-10', fields: { summary: 'Epic Ten' } })
      if (method === 'GET' && path === '/issue/PROJ-11')
        return Promise.resolve({ id: 'id-11', key: 'PROJ-11', fields: { summary: 'Epic Eleven' } })
      throw new Error(`unexpected ${method} ${path}`)
    })

    const initiative = await makeTracker().getInitiative('DISC-1')

    expect(initiative.id).toBe('DISC-1')
    expect(initiative.body).toBe('idea body')
    expect(initiative.epics).toEqual([
      { id: 'PROJ-10', title: 'Epic Ten' },
      { id: 'PROJ-11', title: 'Epic Eleven' },
    ])
  })
})

describe('JiraTaskTracker.linkEpicToInitiative', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('creates a Polaris delivery link with the idea inward and the epic outward', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(deliveryLinkTypes)
      if (method === 'GET' && path === '/issue/DISC-1')
        return Promise.resolve({ id: 'id-DISC-1', key: 'DISC-1', fields: { issuelinks: [] } })
      if (method === 'POST' && path === '/issueLink') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().linkEpicToInitiative('PROJ-10', 'DISC-1')

    expect(postLinkBody()).toEqual({
      type: { name: deliveryType },
      inwardIssue: { key: 'DISC-1' },
      outwardIssue: { key: 'PROJ-10' },
    })
  })

  it('no-ops when the epic is already delivery-linked to the idea', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(deliveryLinkTypes)
      if (method === 'GET' && path === '/issue/DISC-1')
        return Promise.resolve({
          id: 'id-DISC-1',
          key: 'DISC-1',
          fields: { issuelinks: [{ type: { name: deliveryType }, outwardIssue: { key: 'PROJ-10' } }] },
        })
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().linkEpicToInitiative('PROJ-10', 'DISC-1')

    expect(request.mock.calls.some(([method]) => method === 'POST')).toBe(false)
  })
})
