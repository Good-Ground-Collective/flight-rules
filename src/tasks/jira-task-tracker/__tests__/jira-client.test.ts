import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adfBuilder } from '../adf.js'
import { JiraApiError } from '../jira-api-error.js'
import { JiraClient } from '../jira-client.js'

const makeClient = () => new JiraClient({ host: 'acme.atlassian.net', email: 'me@acme.com', token: 'tok' })

const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, ...(init.headers ? { headers: init.headers } : {}) })

describe('JiraClient construction', () => {
  it('builds the base URL and Basic auth header from host/email/token', async () => {
    const client = makeClient()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await client.request('GET', '/issue/FOO-1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue/FOO-1')
    const expectedAuth = `Basic ${Buffer.from('me@acme.com:tok').toString('base64')}`
    expect((init.headers as Record<string, string>)['Authorization']).toBe(expectedAuth)

    vi.unstubAllGlobals()
  })
})

describe('JiraClient.request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends method/body/params and parses a successful JSON response', async () => {
    const client = makeClient()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ key: 'FOO-1', fields: { summary: 'hi' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await client.request<{ key: string }>('POST', '/issue', { fields: { summary: 'hi' } }, { foo: 1 })

    expect(result).toEqual({ key: 'FOO-1', fields: { summary: 'hi' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue?foo=1')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ fields: { summary: 'hi' } }))
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json')
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from('me@acme.com:tok').toString('base64')}`)
  })

  it('returns undefined on a 204 No Content response', async () => {
    const client = makeClient()
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await client.request('DELETE', '/issue/FOO-1')

    expect(result).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue/FOO-1')
    expect(init.method).toBe('DELETE')
  })

  it('normalizes the {errorMessages, errors} Atlassian error shape into a JiraApiError', async () => {
    const client = makeClient()
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { errorMessages: ['You do not have permission'], errors: { summary: 'is required' } },
        { status: 400 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const err = await client.request('GET', '/issue/FOO-1').then(
      () => undefined,
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(JiraApiError)
    const apiErr = err as JiraApiError
    expect(apiErr.status).toBe(400)
    expect(apiErr.messages).toEqual(['You do not have permission'])
    expect(apiErr.fieldErrors).toEqual({ summary: 'is required' })
  })

  it('normalizes the {message} Atlassian error shape into a JiraApiError', async () => {
    const client = makeClient()
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const err = await client.request('GET', '/issue/MISSING-1').then(
      () => undefined,
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(JiraApiError)
    const apiErr = err as JiraApiError
    expect(apiErr.status).toBe(404)
    expect(apiErr.messages).toEqual(['Not found'])
    expect(apiErr.fieldErrors).toEqual({})
  })

  it('retries a 429 honoring Retry-After and succeeds on the second attempt', async () => {
    const client = makeClient()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errorMessages: ['slow down'], errors: {} }, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ key: 'FOO-2' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await client.request<{ key: string }>('GET', '/issue/FOO-2')

    expect(result).toEqual({ key: 'FOO-2' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(firstUrl).toBe('https://acme.atlassian.net/rest/api/3/issue/FOO-2')
    expect(secondUrl).toBe(firstUrl)
    expect(firstInit.method).toBe('GET')
    expect(secondInit.method).toBe('GET')
  }, 10000)
})

describe('AdfBuilder', () => {
  it('doc builds a doc/paragraph node from plain text', () => {
    expect(adfBuilder.doc('hello world')).toEqual({
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
    })
  })

  it('expand wraps a child node in a collapsible expand node with a title', () => {
    const child = { type: 'paragraph', content: [{ type: 'text', text: 'details' }] }
    expect(adfBuilder.expand('Metadata', child)).toEqual({
      type: 'expand',
      attrs: { title: 'Metadata' },
      content: [child],
    })
  })
})
