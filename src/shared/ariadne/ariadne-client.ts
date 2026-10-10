import type { z } from "zod";
import { appVersion } from "../../version.js";
import {
  ActivityInputSchema,
  ActivityResponseSchema,
  AgentErrorBodySchema,
  AgentSessionIdSchema,
  HeartbeatInputSchema,
  HeartbeatResponseSchema,
  ItemInputSchema,
  ItemListResponseSchema,
  ItemResponseSchema,
} from "./ariadne.schema.js";
import type {
  ActivityInput,
  ActivityResponse,
  HeartbeatInput,
  HeartbeatResponse,
  ItemInput,
  ItemListResponse,
  ItemResponse,
} from "./ariadne.schema.js";
import {
  PacketIdSchema,
  PacketInputSchema,
  PacketSchema,
  PacketUpdateSchema,
  ReviewerListResponseSchema,
} from "./review-packet.schema.js";
import type { Packet, ReviewerListResponse } from "./review-packet.schema.js";
import { FetchAriadneTransport } from "./ariadne-transport.js";
import type { AriadneRequest, AriadneResponse, AriadneTransport } from "./ariadne-transport.js";

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

export class AriadneError extends Error {
  readonly failure: AriadneFailure;
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(props: AriadneErrorProps) {
    super(props.message, props.cause === undefined ? undefined : { cause: props.cause });
    this.name = "AriadneError";
    this.failure = props.failure;
    this.status = props.status;
    this.code = props.code;
  }
}

/** Each attempt's timeout. */
export const ariadneTimeoutMs = 5000;
/** One try and one retry. */
export const ariadneAttempts = 2;

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
 * answered 5xx. Retrying is safe: heartbeats are upserts, items and
 * activity are keyed by session and id (or their natural key without one),
 * packet creates are keyed by the packet id, and packet updates carry an
 * `operationId` the server replays.
 */
export class AriadneClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly transport: AriadneTransport;
  private readonly timeoutMs: number;

  constructor(props: AriadneClientProps) {
    this.baseUrl = props.baseUrl.replace(/\/+$/, "");
    this.token = props.token;
    this.transport = props.transport ?? new FetchAriadneTransport();
    this.timeoutMs = props.timeoutMs ?? ariadneTimeoutMs;
  }

  /** POST /v1/agents/heartbeat: creates or updates the session. */
  async heartbeat(input: HeartbeatInput): Promise<HeartbeatResponse> {
    const body = this.validate(HeartbeatInputSchema, input, "heartbeat");
    return this.request("POST", "/v1/agents/heartbeat", HeartbeatResponseSchema, body);
  }

  /** POST /v1/agents/items: 404 `session_not_found` until the session has a heartbeat. */
  async postItem(input: ItemInput): Promise<ItemResponse> {
    const body = this.validate(ItemInputSchema, input, "item");
    return this.request("POST", "/v1/agents/items", ItemResponseSchema, body);
  }

  /** POST /v1/agents/activity: 404 `session_not_found` until the session has a heartbeat. */
  async postActivity(input: ActivityInput): Promise<ActivityResponse> {
    const body = this.validate(ActivityInputSchema, input, "activity");
    return this.request("POST", "/v1/agents/activity", ActivityResponseSchema, body);
  }

  /** GET /v1/agents/items?session=…: every item of the session, open and resolved, oldest first. */
  async listItems(session: string): Promise<ItemListResponse> {
    const id = this.validate(AgentSessionIdSchema, session, "session");
    return this.request("GET", `/v1/agents/items?session=${encodeURIComponent(id)}`, ItemListResponseSchema);
  }

  /** POST /v1/review-packets: idempotent on the packet id; the same id with a different body is 409 `packet_exists`. */
  async createPacket(input: unknown): Promise<Packet> {
    const body = this.validate(PacketInputSchema, input, "packet");
    return this.request("POST", "/v1/review-packets", PacketSchema, body);
  }

  /** PUT /v1/review-packets/{id}: a stale `expectedRevision` is 409 `revision_conflict`; a repeated `operationId` is replayed. */
  async updatePacket(id: string, input: unknown): Promise<Packet> {
    const packetId = this.validate(PacketIdSchema, id, "packet id");
    const body = this.validate(PacketUpdateSchema, input, "packet update");
    return this.request("PUT", `/v1/review-packets/${encodeURIComponent(packetId)}`, PacketSchema, body);
  }

  /** GET /v1/review-packets/{id}. */
  async getPacket(id: string): Promise<Packet> {
    const packetId = this.validate(PacketIdSchema, id, "packet id");
    return this.request("GET", `/v1/review-packets/${encodeURIComponent(packetId)}`, PacketSchema);
  }

  /** GET /v1/review-packets/reviewers: active members with a linked GitHub login. */
  async listReviewers(): Promise<ReviewerListResponse> {
    return this.request("GET", "/v1/review-packets/reviewers", ReviewerListResponseSchema);
  }

  private validate<S extends z.ZodType>(schema: S, input: unknown, what: string): z.output<S> {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    const detail = result.error.issues.map((issue) => `${issue.path.join(".") || what}: ${issue.message}`).join("; ");
    throw new AriadneError({ failure: "invalid-input", message: `invalid ${what}: ${detail}` });
  }

  private async request<S extends z.ZodType>(
    method: AriadneRequest["method"],
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    const request: AriadneRequest = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        Accept: "application/json",
        "User-Agent": `flight-rules/${appVersion}`,
        ...(this.token !== undefined ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      timeoutMs: this.timeoutMs,
    };
    const response = await this.send(request);
    if (response.status < 200 || response.status > 299) throw this.httpError(response);
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch (err) {
      throw new AriadneError({ failure: "bad-response", message: `${method} ${path} returned a body that is not JSON`, cause: err });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AriadneError({
        failure: "bad-response",
        message: `${method} ${path} returned an unexpected shape: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      });
    }
    return parsed.data;
  }

  private async send(request: AriadneRequest): Promise<AriadneResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= ariadneAttempts; attempt++) {
      try {
        const response = await this.transport.send(request);
        if (response.status < 500 || attempt === ariadneAttempts) return response;
      } catch (err) {
        lastError = err;
      }
    }
    throw new AriadneError({
      failure: "network",
      message: `no response from ${this.baseUrl} after ${ariadneAttempts} attempts (${this.describeNetworkError(lastError)})`,
      cause: lastError,
    });
  }

  private describeNetworkError(err: unknown): string {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return `timed out after ${this.timeoutMs / 1000} s`;
    }
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    return err instanceof Error ? `${err.message}${cause}` : String(err);
  }

  private httpError(response: AriadneResponse): AriadneError {
    let parsed: z.infer<typeof AgentErrorBodySchema> | undefined;
    try {
      const result = AgentErrorBodySchema.safeParse(JSON.parse(response.body));
      parsed = result.success ? result.data : undefined;
    } catch {
      parsed = undefined;
    }
    const code = parsed?.error;
    const reason = parsed?.message ?? (code === undefined ? "no error body" : "");
    return new AriadneError({
      failure: "http",
      status: response.status,
      ...(code !== undefined ? { code } : {}),
      message: [`${response.status}`, code, reason].filter((part) => part !== undefined && part !== "").join(" "),
    });
  }
}
