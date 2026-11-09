import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const jiraRequest = vi.hoisted(() => vi.fn())
const confluenceRequest = vi.hoisted(() => vi.fn())
const confluenceUpload = vi.hoisted(() => vi.fn())
vi.mock('../jira-client.js', () => ({
  JiraClient: class {
    request = jiraRequest
  },
}))
vi.mock('../confluence-client.js', () => ({
  ConfluenceClient: class {
    request = confluenceRequest
    upload = confluenceUpload
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
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/properties')
        return Promise.resolve({
          results: [{ id: 'prop-1', key: 'flight-rules-metadata', value: { epicId: 'PROJ-1', notes: 'ctx' }, version: { number: 3 } }],
        })
      if (method === 'GET' && path === '/pages/111/footer-comments') return Promise.resolve({ results: [] })
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

const commentAdf = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Consider this' }] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
          ],
        },
      ],
    },
  ],
}

describe('JiraTaskTracker.getTechnicalDesign footer comments', () => {
  beforeEach(() => {
    confluenceRequest.mockReset()
  })

  const footerComment = (id: string, authorId: string, createdAt: string, adf: unknown) => ({
    id,
    version: { number: 1, createdAt, authorId },
    body: { atlas_doc_format: { value: JSON.stringify(adf) } },
  })

  it('includes nested replies and paginates children depth-first', async () => {
    const text = (t: string): Record<string, unknown> => ({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })
    const childParams: Array<Record<string, unknown> | undefined> = []
    confluenceRequest.mockImplementation((method: string, path: string, _b?: unknown, params?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/pages/111')
        return Promise.resolve({ ...page, body: { atlas_doc_format: { value: JSON.stringify({ type: 'doc', version: 1, content: [] }) } } })
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/footer-comments')
        return Promise.resolve({ results: [footerComment('root', 'a', '2026-07-11T00:00:00.000Z', text('root'))] })
      if (method === 'GET' && path === '/footer-comments/root/children') {
        childParams.push(params)
        if (params?.['cursor'] === undefined)
          return Promise.resolve({
            results: [footerComment('r1', 'b', '2026-07-12T00:00:00.000Z', text('blocking reply'))],
            _links: { next: '/wiki/api/v2/footer-comments/root/children?cursor=kid2&limit=250' },
          })
        return Promise.resolve({ results: [footerComment('r2', 'c', '2026-07-13T00:00:00.000Z', text('second reply'))] })
      }
      if (method === 'GET' && path === '/footer-comments/r1/children')
        return Promise.resolve({ results: [footerComment('n1', 'd', '2026-07-14T00:00:00.000Z', text('nested reply'))] })
      if (method === 'GET' && path.endsWith('/children')) return Promise.resolve({ results: [] })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    const { comments } = await makeTracker().getTechnicalDesign('111')

    expect(comments.map((c) => c.id)).toEqual(['root', 'r1', 'n1', 'r2'])
    expect(comments[1]?.body).toContain('blocking reply')
    expect(childParams[0]?.['body-format']).toBe('atlas_doc_format')
    expect(childParams[1]?.['cursor']).toBe('kid2')
  })

  it('caps in-flight children requests across siblings and keeps depth-first order', async () => {
    const text = (t: string): Record<string, unknown> => ({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`)
    let inFlight = 0
    let peak = 0
    confluenceRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111')
        return { ...page, body: { atlas_doc_format: { value: JSON.stringify({ type: 'doc', version: 1, content: [] }) } } }
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/properties') return { results: [] }
      if (method === 'GET' && path === '/pages/111/footer-comments')
        return { results: ids.map((id) => footerComment(id, 'a', '2026-07-11T00:00:00.000Z', text(id))) }
      if (method === 'GET' && path.endsWith('/children')) {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        const parent = path.split('/')[2] ?? ''
        return {
          results: parent.startsWith('c') && !parent.includes('r')
            ? [footerComment(`${parent}r`, 'b', '2026-07-12T00:00:00.000Z', text('reply'))]
            : [],
        }
      }
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    const { comments } = await makeTracker().getTechnicalDesign('111')

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
    expect(comments.map((c) => c.id)).toEqual(ids.flatMap((id) => [id, `${id}r`]))
  })

  it('reads every page of footer comments as markdown with author and timestamps', async () => {
    const footerParams: Array<Record<string, unknown> | undefined> = []
    confluenceRequest.mockImplementation((method: string, path: string, _b?: unknown, params?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/pages/111')
        return Promise.resolve({ ...page, body: { atlas_doc_format: { value: JSON.stringify({ type: 'doc', version: 1, content: [] }) } } })
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'GET' && path.endsWith('/children')) return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/footer-comments') {
        footerParams.push(params)
        if (params?.['cursor'] === undefined)
          return Promise.resolve({
            results: [footerComment('c1', 'acct-1', '2026-07-11T00:00:00.000Z', commentAdf)],
            _links: { next: '/wiki/api/v2/pages/111/footer-comments?body-format=atlas_doc_format&cursor=abc123&limit=250' },
          })
        return Promise.resolve({
          results: [
            footerComment('c2', 'acct-2', '2026-07-12T00:00:00.000Z', {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second page' }] }],
            }),
          ],
        })
      }
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    const { comments } = await makeTracker().getTechnicalDesign('111')

    expect(footerParams).toHaveLength(2)
    expect(footerParams[0]?.['body-format']).toBe('atlas_doc_format')
    expect(footerParams[1]?.['cursor']).toBe('abc123')
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(comments[0]).toMatchObject({
      author: 'acct-1',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    })
    expect(comments[0]?.body).toContain('Consider this')
    expect(comments[0]?.body).toContain('```ts')
    expect(comments[0]?.body).toContain('const x = 1')
    expect(comments[0]?.body).toContain('| a | b |')
    expect(comments[1]?.body).toContain('second page')
  })
})

describe('JiraTaskTracker.addTechnicalDesignComment', () => {
  beforeEach(() => {
    confluenceRequest.mockReset()
  })

  it('posts an ADF footer comment on the page and returns the Comment', async () => {
    confluenceRequest.mockResolvedValue({
      id: '9001',
      version: { number: 1, createdAt: '2026-07-13T00:00:00.000Z', authorId: 'acct-9' },
    })
    const body = 'Note\n\n```ts\nconst x = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'

    const comment = await makeTracker().addTechnicalDesignComment('111', body)

    const posted = confluenceCall('POST', '/footer-comments')?.[2] as {
      pageId: string
      body: { representation: string; value: string }
    }
    expect(posted.pageId).toBe('111')
    expect(posted.body.representation).toBe('atlas_doc_format')
    const doc = JSON.parse(posted.body.value) as { type: string; content: Array<{ type: string }> }
    expect(doc.type).toBe('doc')
    expect(doc.content.map((n) => n.type)).toEqual(expect.arrayContaining(['codeBlock', 'table']))
    expect(comment).toEqual({
      id: '9001',
      body,
      author: 'acct-9',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    })
  })
})

describe('JiraTaskTracker.updateTddMetadata', () => {
  beforeEach(() => {
    confluenceRequest.mockReset()
  })

  it('merges the patch and PUTs the property with the next version number', async () => {
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
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
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
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
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/footer-comments') return Promise.resolve({ results: [] })
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
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/footer-comments') return Promise.resolve({ results: [] })
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

describe('JiraTaskTracker technical design attachments', () => {
  const imageAttachment = { id: '900', title: 'flow.png', mediaType: 'image/png', fileSize: 42, fileId: 'file-uuid-1' }
  const emptyDoc = JSON.stringify({ type: 'doc', version: 1, content: [] })

  beforeEach(() => {
    jiraRequest.mockReset()
    confluenceRequest.mockReset()
    confluenceUpload.mockReset()
  })

  const stub = (attachments: unknown[], adf: string = emptyDoc) =>
    confluenceRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/pages/111')
        return Promise.resolve({ ...page, body: { atlas_doc_format: { value: adf } } })
      if (method === 'PUT' && path === '/pages/111') return Promise.resolve({})
      if (method === 'GET' && path === '/pages/111/attachments') return Promise.resolve({ results: attachments })
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/footer-comments') return Promise.resolve({ results: [] })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

  it('uploads through the v1 child-attachment path (PUT upsert) and returns the fileId as the media id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tdd-upload-'))
    const file = join(dir, 'flow.png')
    writeFileSync(file, 'png-bytes')
    confluenceUpload.mockResolvedValue({
      results: [{ id: 'att900', title: 'flow.png', extensions: { mediaType: 'image/png', fileSize: 9, fileId: 'file-uuid-1' } }],
    })

    try {
      const attachment = await makeTracker().addTechnicalDesignAttachment('111', file)
      expect(attachment).toEqual({ id: 'att900', filename: 'flow.png', mimeType: 'image/png', size: 9, mediaUuid: 'file-uuid-1' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const [path, files] = confluenceUpload.mock.calls[0] as [string, File[]]
    expect(path).toBe('/content/111/child/attachment')
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe('flow.png')
    expect(files[0]?.type).toBe('image/png')
  })

  it('renders an attachment: reference as a media node in the page collection on edit', async () => {
    stub([imageAttachment])

    await makeTracker().updateTechnicalDesign('111', { body: 'Intro\n\n![the flow](attachment:flow.png)\n' })

    const put = confluenceCall('PUT', '/pages/111')?.[2] as { body: { value: string } }
    const doc = JSON.parse(put.body.value) as { content: Array<{ type: string; content?: Array<{ type: string; attrs: Record<string, unknown> }> }> }
    const single = doc.content.find((node) => node.type === 'mediaSingle')
    expect(single?.content?.[0]).toEqual({
      type: 'media',
      attrs: { type: 'file', id: 'file-uuid-1', collection: 'contentId-111', alt: 'the flow' },
    })
  })

  it('uses just-uploaded media ids when the attachments listing lags the upload', async () => {
    stub([])

    await makeTracker().updateTechnicalDesign(
      '111',
      { body: '![the flow](attachment:flow.png)' },
      { uploaded: [{ id: 'att900', filename: 'flow.png', mimeType: 'image/png', mediaUuid: 'file-uuid-9' }] },
    )

    const put = confluenceCall('PUT', '/pages/111')?.[2] as { body: { value: string } }
    const doc = JSON.parse(put.body.value) as { content: Array<{ type: string; content?: Array<{ type: string; attrs: Record<string, unknown> }> }> }
    const single = doc.content.find((node) => node.type === 'mediaSingle')
    expect(single?.content?.[0]).toEqual({
      type: 'media',
      attrs: { type: 'file', id: 'file-uuid-9', collection: 'contentId-111', alt: 'the flow' },
    })
  })

  it('also resolves a ./filename reference', async () => {
    stub([imageAttachment])
    await makeTracker().updateTechnicalDesign('111', { body: '![x](./flow.png)' })
    const put = confluenceCall('PUT', '/pages/111')?.[2] as { body: { value: string } }
    expect(put.body.value).toContain('"type":"mediaSingle"')
  })

  it('keeps images already on the page when the body is edited', async () => {
    stub([imageAttachment, { id: '901', title: 'hand-added.png', mediaType: 'image/png', fileSize: 5, fileId: 'file-uuid-2' }])

    await makeTracker().updateTechnicalDesign('111', {
      body: '![a](attachment:flow.png)\n\n![b](attachment:hand-added.png)',
    })

    const put = confluenceCall('PUT', '/pages/111')?.[2] as { body: { value: string } }
    expect(put.body.value).toContain('file-uuid-1')
    expect(put.body.value).toContain('file-uuid-2')
    expect(put.body.value).not.toContain('"type":"text","text":"![')
  })

  it('reads attachments and renders media back as the attachment: reference', async () => {
    const adf = JSON.stringify({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'mediaSingle',
          attrs: { layout: 'center' },
          content: [{ type: 'media', attrs: { type: 'file', id: 'file-uuid-1', collection: 'contentId-111', alt: 'the flow' } }],
        },
      ],
    })
    stub([imageAttachment], adf)

    const tdd = await makeTracker().getTechnicalDesign('111')

    expect(tdd.body).toBe('![the flow](attachment:flow.png)')
    expect(tdd.attachments).toEqual([
      { id: '900', filename: 'flow.png', mimeType: 'image/png', size: 42, mediaUuid: 'file-uuid-1' },
    ])
  })

  it('follows the attachments cursor so every attachment is read', async () => {
    const params: Array<Record<string, unknown> | undefined> = []
    confluenceRequest.mockImplementation((method: string, path: string, _b?: unknown, p?: Record<string, unknown>) => {
      if (method === 'GET' && path === '/pages/111')
        return Promise.resolve({ ...page, body: { atlas_doc_format: { value: emptyDoc } } })
      if (method === 'GET' && path === '/pages/111/attachments') {
        params.push(p)
        if (p?.['cursor'] === undefined)
          return Promise.resolve({ results: [imageAttachment], _links: { next: '/wiki/api/v2/pages/111/attachments?cursor=n2&limit=250' } })
        return Promise.resolve({ results: [{ id: '902', title: 'b.png', fileId: 'f2' }] })
      }
      if (method === 'GET' && path === '/pages/111/properties') return Promise.resolve({ results: [] })
      if (method === 'GET' && path === '/pages/111/footer-comments') return Promise.resolve({ results: [] })
      throw new Error(`unexpected confluence ${method} ${path}`)
    })

    const { attachments } = await makeTracker().getTechnicalDesign('111')

    expect(attachments.map((a) => a.filename)).toEqual(['flow.png', 'b.png'])
    expect(params[1]?.['cursor']).toBe('n2')
  })
})
