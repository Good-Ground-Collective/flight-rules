import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConfluenceClient } from '../confluence-client.js'

const makeClient = () => new ConfluenceClient({ host: 'acme.atlassian.net', email: 'me@acme.com', token: 'tok' })

describe('ConfluenceClient.upload', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts multipart to the v1 content path with the XSRF header and no Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: '1' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().upload('/content/111/child/attachment', [
      new File([Buffer.from('png')], 'flow.png', { type: 'image/png' }),
    ])

    expect(result).toEqual({ results: [{ id: '1' }] })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://acme.atlassian.net/wiki/rest/api/content/111/child/attachment')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Atlassian-Token']).toBe('no-check')
    expect(headers['Content-Type']).toBeUndefined()
    const part = (init.body as FormData).get('file')
    expect(part).toBeInstanceOf(File)
    expect((part as File).name).toBe('flow.png')
  })

  it('throws a Confluence API error on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'too big' }), { status: 413 })))
    await expect(makeClient().upload('/content/111/child/attachment', [])).rejects.toThrow('Confluence API 413: too big')
  })

  it('retries a 429 before succeeding', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = makeClient().upload('/content/111/child/attachment', [])
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toEqual({ results: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
