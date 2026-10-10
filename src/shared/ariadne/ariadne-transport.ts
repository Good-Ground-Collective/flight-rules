export interface AriadneRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface AriadneResponse {
  status: number;
  body: string;
}

/**
 * Sends one HTTP request. Rejects only when no response arrived (network
 * failure or timeout); any HTTP status resolves. Tests inject a fake so they
 * need no network.
 */
export interface AriadneTransport {
  send(request: AriadneRequest): Promise<AriadneResponse>;
}

/** Node's global fetch, aborted after the request's timeout. */
export class FetchAriadneTransport implements AriadneTransport {
  async send(request: AriadneRequest): Promise<AriadneResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    return { status: response.status, body: await response.text() };
  }
}
