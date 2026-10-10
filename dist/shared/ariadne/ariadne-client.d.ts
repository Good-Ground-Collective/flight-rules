import type { ActivityInput, ActivityResponse, HeartbeatInput, HeartbeatResponse, ItemInput, ItemListResponse, ItemResponse } from "./ariadne.schema.js";
import type { AriadneTransport } from "./ariadne-transport.js";
/**
 * Why a call failed: the input broke the contract before anything was sent,
 * no response arrived after the retry, the API answered with an error status,
 * or it answered 2xx with a body this client cannot read.
 */
export type AriadneFailure = "invalid-input" | "network" | "http" | "bad-response";
export interface AriadneErrorProps {
    failure: AriadneFailure;
    message: string;
    status?: number;
    /** The API's `error` code, such as `session_not_found`; branch on this. */
    code?: string;
    cause?: unknown;
}
export declare class AriadneError extends Error {
    readonly failure: AriadneFailure;
    readonly status: number | undefined;
    readonly code: string | undefined;
    constructor(props: AriadneErrorProps);
}
/** Each attempt's timeout. */
export declare const ariadneTimeoutMs = 5000;
/** One try and one retry. */
export declare const ariadneAttempts = 2;
export interface AriadneClientProps {
    baseUrl: string;
    /** Sent as `Authorization: Bearer <token>`; omitted when undefined. */
    token?: string | undefined;
    transport?: AriadneTransport;
    /** Per attempt. Defaults to 5 seconds. */
    timeoutMs?: number;
}
/**
 * Ariadne's Agents API, contract version 1. Each request times out after
 * `timeoutMs` and is retried once when no response arrived or the server
 * answered 5xx. Retrying is safe: heartbeats are upserts, and items and
 * activity are keyed by session and id (or their natural key without one).
 */
export declare class AriadneClient {
    private readonly baseUrl;
    private readonly token;
    private readonly transport;
    private readonly timeoutMs;
    constructor(props: AriadneClientProps);
    /** POST /v1/agents/heartbeat: creates or updates the session. */
    heartbeat(input: HeartbeatInput): Promise<HeartbeatResponse>;
    /** POST /v1/agents/items: 404 `session_not_found` until the session has a heartbeat. */
    postItem(input: ItemInput): Promise<ItemResponse>;
    /** POST /v1/agents/activity: 404 `session_not_found` until the session has a heartbeat. */
    postActivity(input: ActivityInput): Promise<ActivityResponse>;
    /** GET /v1/agents/items?session=…: every item of the session, open and resolved, oldest first. */
    listItems(session: string): Promise<ItemListResponse>;
    private validate;
    private request;
    private send;
    private describeNetworkError;
    private httpError;
}
