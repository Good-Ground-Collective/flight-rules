export interface AriadneRequest {
    method: "GET" | "POST";
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
export declare class FetchAriadneTransport implements AriadneTransport {
    send(request: AriadneRequest): Promise<AriadneResponse>;
}
