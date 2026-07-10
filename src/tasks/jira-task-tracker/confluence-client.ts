import { z } from 'zod'

const maxRetries = 4
const defaultRetryAfterSeconds = 2
const maxBackoffMs = 30_000

const ConfluenceErrorBodySchema = z.object({
  errors: z
    .array(z.object({ title: z.string().optional(), detail: z.string().optional() }))
    .optional()
    .catch(undefined),
  message: z.string().optional(),
})

export interface ConfluenceClientConfig {
  host: string
  email: string
  token: string
}

/**
 * Confluence Cloud REST API v2 client. Shares the classic Atlassian API token
 * and Basic-auth scheme with {@link JiraClient}, but targets the `/wiki` host
 * and v2 base path. {@link siteBaseUrl} is exposed so callers can assemble a
 * page's human URL from its relative `_links.webui`.
 */
export class ConfluenceClient {
  readonly siteBaseUrl: string
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(config: ConfluenceClientConfig) {
    this.siteBaseUrl = `https://${config.host}/wiki`
    this.baseUrl = `${this.siteBaseUrl}/api/v2`
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

    const res = await this.fetchWithRetry(url.toString(), {
      method,
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    if (!res.ok) await this.throwApiError(res)
    const text = await res.text()
    // JSON.parse is lib-typed `any` (assignable to T without an assertion, which
    // the repo's eslint bans); undici's res.json() is `unknown` and would not be.
    const data: T = text.length > 0 ? JSON.parse(text) : undefined
    return data
  }

  private async fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
    const res = await fetch(url, init)
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfterHeader = res.headers.get('Retry-After')
      const parsedRetryAfter = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : defaultRetryAfterSeconds
      const jitter = 0.7 + Math.random() * 0.6
      const delayMs = Math.min(retryAfterSeconds * 1000 * jitter, maxBackoffMs)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return this.fetchWithRetry(url, init, attempt + 1)
    }
    return res
  }

  private async throwApiError(res: Response): Promise<never> {
    const parsed: unknown = await res.json().catch(() => undefined)
    const body = ConfluenceErrorBodySchema.catch({}).parse(parsed)
    const detail = body.errors?.map((e) => e.detail ?? e.title).filter(Boolean).join('; ') ?? body.message ?? ''
    throw new Error(`Confluence API ${res.status}${detail ? `: ${detail}` : ''}`)
  }
}
