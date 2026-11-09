import { describe, it, expect, vi, beforeEach } from 'vitest'

const jiraRequest = vi.hoisted(() => vi.fn())
const confluenceRequest = vi.hoisted(() => vi.fn())
vi.mock('../jira-client.js', () => ({
  JiraClient: class {
    request = jiraRequest
  },
}))
vi.mock('../confluence-client.js', () => ({
  ConfluenceClient: class {
    request = confluenceRequest
    siteBaseUrl = 'https://acme.atlassian.net/wiki'
  },
}))

import { JiraTaskTracker } from '../jira-task-tracker.js'

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

const tddMarkdown = '# Payments — TDD\n\n## Problem\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n<details><summary>More</summary>\n\nhidden\n\n</details>\n'

const confluenceCall = (method: string, path: string) =>
  confluenceRequest.mock.calls.find(([m, p]) => m === method && p === path)

describe('JiraTaskTracker.createTechnicalDesign', () => {
  beforeEach(() => {
    jiraRequest.mockReset()
    confluenceRequest.mockReset()
  })

  it('creates an ADF page, stores metadata in a content property, stamps the epic, and assembles the URL', async () => {
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
      body: tddMarkdown,
      epicId: 'PROJ-1',
    })

    expect(tdd.id).toBe('111')
    expect(tdd.epicId).toBe('PROJ-1')
    expect(tdd.url).toBe('https://acme.atlassian.net/wiki/spaces/SD/pages/111/Payments+TDD')
    const posted = confluenceCall('POST', '/pages')?.[2] as { body: { representation: string; value: string }; title: string }
    expect(posted.body.representation).toBe('atlas_doc_format')
    const doc = JSON.parse(posted.body.value) as { type: string; content: Array<{ type: string; attrs?: Record<string, unknown> }> }
    expect(doc.type).toBe('doc')
    const types = doc.content.map((n) => n.type)
    expect(types).toEqual(expect.arrayContaining(['heading', 'table', 'codeBlock', 'expand']))
    expect(doc.content[0]?.type).toBe('heading')
    expect(doc.content[0]?.attrs?.['level']).toBe(2)
    expect(doc.content.find((n) => n.type === 'codeBlock')?.attrs?.['language']).toBe('ts')
    expect(tdd.body).toBe(tddMarkdown)
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

  const mockGet = (adfBody: unknown, storageBody?: unknown) =>
    confluenceRequest.mockImplementation((method: string, path: string, _b?: unknown, params?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/pages/111') {
        if (params?.['body-format'] === 'atlas_doc_format') return Promise.resolve({ ...page, body: adfBody })
        if (params?.['body-format'] === 'storage') return Promise.resolve({ ...page, body: storageBody })
        throw new Error(`unexpected body-format ${String(params?.['body-format'])}`)
      }
      if (method === 'GET' && path === '/pages/111/properties')
        return Promise.resolve({
          results: [{ id: 'prop-1', key: 'flight-rules-metadata', value: { epicId: 'PROJ-1', notes: 'ctx' }, version: { number: 3 } }],
        })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

  const pageGets = (): Array<unknown> =>
    confluenceRequest.mock.calls.filter(([m, p]) => m === 'GET' && p === '/pages/111').map(([, , , params]) => params)

  it('reads the ADF body back as markdown with epicId and url', async () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Problem' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'the design' }] },
      ],
    }
    mockGet({ atlas_doc_format: { value: JSON.stringify(adf) } })

    const tdd = await makeTracker().getTechnicalDesign('111')

    expect(tdd.epicId).toBe('PROJ-1')
    expect(tdd.body).toContain('## Problem')
    expect(tdd.body).toContain('the design')
    expect(tdd.url).toBe('https://acme.atlassian.net/wiki/spaces/SD/pages/111/Payments+TDD')
    expect(tdd.metadata).toEqual({ notes: 'ctx' })
    expect(pageGets()).toEqual([{ 'body-format': 'atlas_doc_format' }])
  })

  it('keeps an inlineCard Smart Link url when reading the ADF body', async () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            { type: 'inlineCard', attrs: { url: 'https://acme.atlassian.net/browse/PROJ-9' } },
          ],
        },
      ],
    }
    mockGet({ atlas_doc_format: { value: JSON.stringify(adf) } })
    expect((await makeTracker().getTechnicalDesign('111')).body).toContain('https://acme.atlassian.net/browse/PROJ-9')
  })

  it('keeps a blockCard url and a status label without a storage request', async () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'state ' }, { type: 'status', attrs: { text: 'BLOCKED', color: 'red' } }] },
        { type: 'blockCard', attrs: { url: 'https://acme.atlassian.net/wiki/spaces/X/pages/1' } },
      ],
    }
    mockGet({ atlas_doc_format: { value: JSON.stringify(adf) } })
    const { body } = await makeTracker().getTechnicalDesign('111')
    expect(body).toContain('[BLOCKED]')
    expect(body).toContain('https://acme.atlassian.net/wiki/spaces/X/pages/1')
    expect(pageGets()).toEqual([{ 'body-format': 'atlas_doc_format' }])
  })

  it('fetches the storage representation when the ADF body is missing', async () => {
    mockGet({}, { storage: { value: '<p>the design</p>' } })
    expect((await makeTracker().getTechnicalDesign('111')).body).toBe('<p>the design</p>')
    expect(pageGets()).toEqual([{ 'body-format': 'atlas_doc_format' }, { 'body-format': 'storage' }])
  })

  it('fetches the storage representation when the ADF body is unparseable', async () => {
    mockGet({ atlas_doc_format: { value: 'not json' } }, { storage: { value: '<p>old</p>' } })
    expect((await makeTracker().getTechnicalDesign('111')).body).toBe('<p>old</p>')
    expect(pageGets()).toEqual([{ 'body-format': 'atlas_doc_format' }, { 'body-format': 'storage' }])
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

describe('JiraTaskTracker.updateTechnicalDesign', () => {
  beforeEach(() => {
    jiraRequest.mockReset()
    confluenceRequest.mockReset()
  })

  const existingAdf = JSON.stringify({ type: 'doc', version: 1, content: [] })
  const stubConfluence = () =>
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111')
        return Promise.resolve({
          ...page,
          version: { number: 4, createdAt: '2026-07-10T00:00:00.000Z' },
          body: { atlas_doc_format: { value: existingAdf } },
        })
      if (method === 'PUT' && path === '/pages/111') return Promise.resolve({})
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

  it('PUTs ADF with the current title and the next version when the title is omitted', async () => {
    stubConfluence()

    await makeTracker().updateTechnicalDesign('111', { body: '## Problem\n\nNew text\n' })

    const put = confluenceCall('PUT', '/pages/111')?.[2] as {
      id: string
      status: string
      title: string
      body: { representation: string; value: string }
      version: { number: number }
    }
    expect(put.title).toBe('Payments — TDD')
    expect(put.status).toBe('current')
    expect(put.version.number).toBe(5)
    expect(put.body.representation).toBe('atlas_doc_format')
    const doc = JSON.parse(put.body.value) as { type: string; content: Array<{ type: string }> }
    expect(doc.content[0]?.type).toBe('heading')
  })

  it('uses the new title when given', async () => {
    stubConfluence()

    await makeTracker().updateTechnicalDesign('111', { title: 'Renamed', body: 'Text' })

    const put = confluenceCall('PUT', '/pages/111')?.[2] as { title: string; version: { number: number } }
    expect(put.title).toBe('Renamed')
    expect(put.version.number).toBe(5)
  })

  it('reports a partial write when the readback fails after the PUT', async () => {
    let gets = 0
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111') {
        gets += 1
        if (gets > 1) return Promise.reject(new Error('readback failed'))
        return Promise.resolve({ ...page, body: { atlas_doc_format: { value: existingAdf } } })
      }
      if (method === 'PUT' && path === '/pages/111') return Promise.resolve({})
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    await expect(makeTracker().updateTechnicalDesign('111', { title: 'Renamed' })).rejects.toMatchObject({
      name: 'TaskTrackerPartialWriteError',
      id: '111',
    })
    expect(confluenceCall('PUT', '/pages/111')).toBeDefined()
  })

  it('keeps the existing ADF body on a title-only edit', async () => {
    stubConfluence()

    await makeTracker().updateTechnicalDesign('111', { title: 'Renamed' })

    const put = confluenceCall('PUT', '/pages/111')?.[2] as { body: { value: string } }
    expect(put.body.value).toBe(existingAdf)
  })
})
