import { describe, it, expect, vi, beforeEach } from 'vitest'

const jiraRequest = vi.hoisted(() => vi.fn())
const confluenceRequest = vi.hoisted(() => vi.fn())
vi.mock('./jira-client.js', () => ({
  JiraClient: class {
    request = jiraRequest
  },
}))
vi.mock('./confluence-client.js', () => ({
  ConfluenceClient: class {
    request = confluenceRequest
    siteBaseUrl = 'https://acme.atlassian.net/wiki'
  },
}))

import { JiraTaskTracker } from './jira-task-tracker.js'

const makeTracker = (confluenceSpaceKey: string | null = 'SD') =>
  new JiraTaskTracker({
    token: 'tok',
    host: 'acme.atlassian.net',
    email: 'me@acme.com',
    project: 'PROJ',
    ...(confluenceSpaceKey !== null ? { confluenceSpaceKey } : {}),
  })

const spaces = { results: [{ id: '163842', key: 'SD' }] }
const page = {
  id: '111',
  title: 'Payments — TDD',
  version: { number: 1, createdAt: '2026-07-10T00:00:00.000Z' },
  _links: { webui: '/spaces/SD/pages/111/Payments+TDD' },
}

const confluenceCall = (method: string, path: string) =>
  confluenceRequest.mock.calls.find(([m, p]) => m === method && p === path)

describe('JiraTaskTracker.createTechnicalDesign', () => {
  beforeEach(() => {
    jiraRequest.mockReset()
    confluenceRequest.mockReset()
  })

  it('creates a storage page, stores metadata in a content property, stamps the epic, and assembles the URL', async () => {
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/spaces') return Promise.resolve(spaces)
      if (method === 'POST' && path === '/pages') return Promise.resolve(page)
      if (method === 'POST' && path === '/pages/111/properties') return Promise.resolve({})
      throw new Error(`unexpected confluence ${method} ${path}`)
    })
    jiraRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-1')
        return Promise.resolve({ key: 'PROJ-1', fields: { description: null } })
      if (method === 'PUT' && path === '/issue/PROJ-1') return Promise.resolve(undefined)
      throw new Error(`unexpected jira ${method} ${path}`)
    })

    const tdd = await makeTracker().createTechnicalDesign({
      title: 'Payments — TDD',
      body: '<h2>Problem</h2><p>...</p>',
      epicId: 'PROJ-1',
    })

    expect(tdd.id).toBe('111')
    expect(tdd.epicId).toBe('PROJ-1')
    expect(tdd.url).toBe('https://acme.atlassian.net/wiki/spaces/SD/pages/111/Payments+TDD')
    expect(tdd.body).toBe('<h2>Problem</h2><p>...</p>')

    expect(confluenceCall('POST', '/pages')?.[2]).toEqual({
      spaceId: '163842',
      status: 'current',
      title: 'Payments — TDD',
      body: { representation: 'storage', value: '<h2>Problem</h2><p>...</p>' },
    })
    expect(confluenceCall('POST', '/pages/111/properties')?.[2]).toEqual({
      key: 'flight-rules-metadata',
      value: { epicId: 'PROJ-1' },
    })
    // the Confluence page id is stamped onto the epic as a numeric tddId
    const put = jiraRequest.mock.calls.find(([m, p]) => m === 'PUT' && p === '/issue/PROJ-1')
    expect(put).toBeDefined()
  })

  it('rejects when no Confluence space is configured', async () => {
    await expect(
      makeTracker(null).createTechnicalDesign({ title: 't', body: 'b', epicId: 'PROJ-1' }),
    ).rejects.toThrow(/Confluence space/)
    expect(confluenceRequest).not.toHaveBeenCalled()
  })
})

describe('JiraTaskTracker.getTechnicalDesign', () => {
  beforeEach(() => {
    confluenceRequest.mockReset()
  })

  it('fetches the storage page and content property, returning epicId and url', async () => {
    confluenceRequest.mockImplementation((method: string, path: string, _body?: unknown, params?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/pages/111') {
        expect(params?.['body-format']).toBe('storage')
        return Promise.resolve({ ...page, body: { storage: { value: '<p>the design</p>' } } })
      }
      if (method === 'GET' && path === '/pages/111/properties')
        return Promise.resolve({
          results: [{ id: 'prop-1', key: 'flight-rules-metadata', value: { epicId: 'PROJ-1', notes: 'ctx' }, version: { number: 3 } }],
        })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    const tdd = await makeTracker().getTechnicalDesign('111')

    expect(tdd.epicId).toBe('PROJ-1')
    expect(tdd.body).toBe('<p>the design</p>')
    expect(tdd.url).toBe('https://acme.atlassian.net/wiki/spaces/SD/pages/111/Payments+TDD')
    expect(tdd.metadata).toEqual({ notes: 'ctx' })
  })
})

describe('JiraTaskTracker.updateTddMetadata', () => {
  beforeEach(() => {
    confluenceRequest.mockReset()
  })

  it('merges the patch and PUTs the property with the next version number', async () => {
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111/properties')
        return Promise.resolve({
          results: [{ id: 'prop-1', key: 'flight-rules-metadata', value: { epicId: 'PROJ-1', notes: 'old' }, version: { number: 3 } }],
        })
      if (method === 'PUT' && path === '/pages/111/properties/prop-1') return Promise.resolve({})
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    await makeTracker().updateTddMetadata('111', { notes: 'new', tddId: undefined })

    const put = confluenceCall('PUT', '/pages/111/properties/prop-1')
    expect(put?.[2]).toEqual({
      key: 'flight-rules-metadata',
      value: { epicId: 'PROJ-1', notes: 'new' },
      version: { number: 4 },
    })
  })

  it('creates the property when none exists yet', async () => {
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'POST' && path === '/pages/111/properties') return Promise.resolve({})
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    await makeTracker().updateTddMetadata('111', { notes: 'first' })

    expect(confluenceCall('POST', '/pages/111/properties')?.[2]).toEqual({
      key: 'flight-rules-metadata',
      value: { notes: 'first' },
    })
  })
})
