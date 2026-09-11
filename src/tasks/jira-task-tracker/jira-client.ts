import { z } from 'zod'

import { JiraApiError } from './jira-api-error.js'

const maxRetries = 4
const defaultRetryAfterSeconds = 2
const maxBackoffMs = 30_000
const attachmentXsrfHeader = 'no-check'
const redirectStatuses = new Set([301, 302, 303, 307, 308])

const JiraErrorBodySchema = z.object({
  errorMessages: z.array(z.string()).optional(),
  // Caught per-field so an off-contract `errors` map cannot discard a valid sibling `errorMessages`.
  errors: z.record(z.string(), z.string()).optional().catch(undefined),
  message: z.string().optional(),
})

export interface JiraClientConfig {
  host: string
  email: string
  token: string
}

export class JiraClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(config: JiraClientConfig) {
    this.baseUrl = `https://${config.host}/rest/api/3`
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

  /**
   * Uploads files as a multipart attachment. Jira's attachment endpoint demands the
   * `X-Atlassian-Token: no-check` XSRF opt-out, and `Content-Type` is left unset so undici
   * writes the multipart boundary itself — setting it by hand would drop the boundary.
   */
  async upload<T>(path: string, files: File[]): Promise<T> {
    const form = new FormData()
    files.forEach((file) => form.append('file', file, file.name))

    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'X-Atlassian-Token': attachmentXsrfHeader,
      },
      body: form,
    })

    if (!res.ok) await this.throwApiError(res)
    const text = await res.text()
    // JSON.parse is lib-typed `any` (assignable to T without an assertion, which
    // the repo's eslint bans); undici's res.json() is `unknown` and would not be.
    const data: T = text.length > 0 ? JSON.parse(text) : undefined
    return data
  }

  /**
   * Resolves the `Location` a Jira redirect points at without following it. undici surfaces the
   * real 3xx (not an opaque redirect) under `redirect: 'manual'`, so the status and header are
   * readable; a 3xx leaves `res.ok` false, hence the explicit redirect-status allowance.
   */
  async locationFor(path: string): Promise<string> {
    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader },
      redirect: 'manual',
    })

    if (!res.ok && !redirectStatuses.has(res.status)) await this.throwApiError(res)

    const location = res.headers.get('location')
    if (location === null) {
      throw new JiraApiError(res.status, [`Jira returned no Location header for ${path}`], {})
    }
    return location
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
    const body = JiraErrorBodySchema.catch({}).parse(parsed)
    const messages = body.errorMessages ?? (body.message ? [body.message] : [])
    const fieldErrors = body.errors ?? {}
    throw new JiraApiError(res.status, messages, fieldErrors)
  }
}
