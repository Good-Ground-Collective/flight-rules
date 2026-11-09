export interface ConfluenceClientConfig {
    host: string;
    email: string;
    token: string;
}
/**
 * Confluence Cloud REST API v2 client. Shares the classic Atlassian API token
 * and Basic-auth scheme with {@link JiraClient}, but targets the `/wiki` host
 * and v2 base path. {@link siteBaseUrl} is exposed so callers can assemble a
 * page's human URL from its relative `_links.webui`.
 */
export declare class ConfluenceClient {
    readonly siteBaseUrl: string;
    private readonly baseUrl;
    private readonly legacyBaseUrl;
    private readonly authHeader;
    constructor(config: ConfluenceClientConfig);
    request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number>): Promise<T>;
    /**
     * Uploads files as page attachments. v2 has no upload endpoint, so this targets the v1
     * `/rest/api` path, which demands the `X-Atlassian-Token: no-check` XSRF opt-out; `Content-Type`
     * is left unset so undici writes the multipart boundary itself.
     */
    upload<T>(path: string, files: File[]): Promise<T>;
    private fetchWithRetry;
    private throwApiError;
}
