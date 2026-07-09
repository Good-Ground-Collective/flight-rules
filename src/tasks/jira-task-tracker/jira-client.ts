const MAX_RETRIES = 4
const DEFAULT_RETRY_AFTER_SECONDS = 2
const MAX_BACKOFF_MS = 30_000

export interface JiraClientConfig {
  host: string
  email: string
  token: string
}

export class JiraApiError extends Error {
  readonly status: number
  readonly messages: string[]
  readonly fieldErrors: Record<string, string>

  constructor(status: number, messages: string[], fieldErrors: Record<string, string>) {
    super(messages[0] ?? `Jira API error (status ${status})`)
    this.name = 'JiraApiError'
    this.status = status
    this.messages = messages
    this.fieldErrors = fieldErrors
  }
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
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

    const res = await this.fetchWithRetry(url.toString(), {
      method,
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    if (!res.ok) await this.throwApiError(res)
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  private async fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
    const res = await fetch(url, init)
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = res.headers.get('Retry-After')
      const parsedRetryAfter = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : DEFAULT_RETRY_AFTER_SECONDS
      const jitter = 0.7 + Math.random() * 0.6
      const delayMs = Math.min(retryAfterSeconds * 1000 * jitter, MAX_BACKOFF_MS)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return this.fetchWithRetry(url, init, attempt + 1)
    }
    return res
  }

  private async throwApiError(res: Response): Promise<never> {
    const parsed: unknown = await res.json().catch(() => undefined)
    const body = (parsed ?? {}) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string }
    const messages = body.errorMessages ?? (body.message ? [body.message] : [])
    const fieldErrors = body.errors ?? {}
    throw new JiraApiError(res.status, messages, fieldErrors)
  }
}

export interface AdfTextNode {
  type: 'text'
  text: string
}

export interface AdfParagraphNode {
  type: 'paragraph'
  content: AdfTextNode[]
}

export interface AdfDocNode {
  version: 1
  type: 'doc'
  content: AdfParagraphNode[]
}

export interface AdfExpandNode {
  type: 'expand'
  attrs: { title: string }
  content: unknown[]
}

export interface AdfBuilder {
  doc(text: string): AdfDocNode
  expand(title: string, child: unknown): AdfExpandNode
}

export class DefaultAdfBuilder implements AdfBuilder {
  doc(text: string): AdfDocNode {
    return {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
  }

  expand(title: string, child: unknown): AdfExpandNode {
    return {
      type: 'expand',
      attrs: { title },
      content: [child],
    }
  }
}

export const adfBuilder: AdfBuilder = new DefaultAdfBuilder()
