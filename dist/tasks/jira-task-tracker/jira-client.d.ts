export interface JiraClientConfig {
    host: string;
    email: string;
    token: string;
}
export declare class JiraClient {
    private readonly baseUrl;
    private readonly authHeader;
    constructor(config: JiraClientConfig);
    request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number>): Promise<T>;
    /**
     * Uploads files as a multipart attachment. Jira's attachment endpoint demands the
     * `X-Atlassian-Token: no-check` XSRF opt-out, and `Content-Type` is left unset so undici
     * writes the multipart boundary itself — setting it by hand would drop the boundary.
     */
    upload<T>(path: string, files: File[]): Promise<T>;
    /**
     * Resolves the `Location` a Jira redirect points at without following it. undici surfaces the
     * real 3xx (not an opaque redirect) under `redirect: 'manual'`, so the status and header are
     * readable; a 3xx leaves `res.ok` false, hence the explicit redirect-status allowance.
     */
    locationFor(path: string): Promise<string>;
    private fetchWithRetry;
    private throwApiError;
}
