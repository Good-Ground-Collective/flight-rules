import { randomUUID } from "node:crypto";
import type { ConfigScope } from "../config-store.js";
import { AriadneClient, AriadneError } from "./ariadne-client.js";
import type { AriadneTransport } from "./ariadne-transport.js";
import { AriadneUrlSchema, defaultAriadneUrl } from "./ariadne.schema.js";
import type { BoardConfigLayer } from "./ariadne-board.js";
import type { AriadneTokenStore } from "./ariadne-token-store.js";
import { packetIdGenerator } from "./packet-id-generator.js";
import type { Packet, ReviewerListResponse } from "./review-packet.schema.js";

/** A packet call that failed; the message is one line that ends in the next step. */
export class AriadnePacketError extends Error {
  override name = "AriadnePacketError";
}

export interface AriadnePacketsProps {
  /** The flight-rules config layers, lowest precedence first; `ariadne.url` is read from the person's own. */
  readLayers: () => readonly BoardConfigLayer[];
  tokens: AriadneTokenStore;
  transport?: AriadneTransport;
  timeoutMs?: number;
}

export interface PacketUpdate {
  /** Untrusted file content; the client validates it strictly before sending. */
  packet: unknown;
  expectedRevision: number;
  /** Generated when omitted; pass one to replay a specific update. */
  operationId?: string;
}

const personalScopes: ReadonlySet<ConfigScope> = new Set(["user", "local"]);
const urlKey = "ariadne.url";

/**
 * Publishes and revises Review Packets as the author. Unlike the agent board,
 * nothing here is skipped: a missing token, a bad `ariadne.url` or any API
 * error throws an `AriadnePacketError` naming what to do next. A packet is
 * published even when `ariadne.enabled` is false, which only switches off hook reporting.
 */
export class AriadnePackets {
  private readonly readLayers: () => readonly BoardConfigLayer[];
  private readonly tokens: AriadneTokenStore;
  private readonly transport: AriadneTransport | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(props: AriadnePacketsProps) {
    this.readLayers = props.readLayers;
    this.tokens = props.tokens;
    this.transport = props.transport;
    this.timeoutMs = props.timeoutMs;
  }

  /**
   * Publishes a packet, generating its id from the title when the file has none.
   * When another author already holds the id (409 `packet_id_taken`) the random
   * suffix is regenerated and the create is retried once.
   */
  async create(packet: unknown): Promise<Packet> {
    const first = this.withId(packet);
    return this.call(async (client) => {
      try {
        return await client.createPacket(first.packet);
      } catch (err) {
        if (!(err instanceof AriadneError) || err.code !== "packet_id_taken") throw err;
      }

      const retryId = packetIdGenerator.regenerate(first.id);
      try {
        return await client.createPacket(Object.assign({}, first.packet, { id: retryId }));
      } catch (err) {
        if (err instanceof AriadneError && err.code === "packet_id_taken") {
          throw new AriadnePacketError(
            `the packet id is taken by another author (409 packet_id_taken; tried ${first.id} and ${retryId}); change the title in the packet file or run \`flight-rules packet new-id --title <title>\` and set its id, then retry`,
            { cause: err },
          );
        }
        throw err;
      }
    });
  }

  async update(id: string, input: PacketUpdate): Promise<Packet> {
    const operationId = input.operationId ?? randomUUID().replaceAll("-", "");
    return this.call((client) =>
      client.updatePacket(id, { expectedRevision: input.expectedRevision, operationId, packet: input.packet }),
    );
  }

  async get(id: string): Promise<Packet> {
    return this.call((client) => client.getPacket(id));
  }

  async reviewers(): Promise<ReviewerListResponse> {
    return this.call((client) => client.listReviewers());
  }

  /** The packet carrying an id: the file's own, or one generated from its title. Anything else is left for validation to reject. */
  private withId(packet: unknown): { packet: unknown; id: string } {
    if (typeof packet !== "object" || packet === null || Array.isArray(packet)) return { packet, id: "" };
    const fields: Record<string, unknown> = { ...packet };
    if (typeof fields["id"] === "string") return { packet: fields, id: fields["id"] };
    if (fields["id"] === undefined && typeof fields["title"] === "string") {
      const id = packetIdGenerator.generate(fields["title"]);
      return { packet: { ...fields, id }, id };
    }
    return { packet: fields, id: "" };
  }

  /**
   * `ariadne.url` (default: production) read only from the user and local
   * layers, local winning. A URL that is not https (or http on localhost)
   * throws, so the token never goes to it.
   */
  private url(): string {
    let raw: unknown;
    for (const layer of this.readLayers()) {
      if (!personalScopes.has(layer.scope)) continue;
      const value = layer.values[urlKey];
      if (value !== undefined && value !== null && value !== "") raw = value;
    }
    if (raw === undefined) return defaultAriadneUrl;
    const parsed = AriadneUrlSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new AriadnePacketError(
      `ariadne.url is invalid (${parsed.error.issues.map((i) => i.message).join("; ")}); fix it with \`flight-rules config set ariadne.url <https url> --scope user\``,
    );
  }

  private token(): string {
    const resolved = this.tokens.resolve();
    if (resolved !== undefined) return resolved.token;
    throw new AriadnePacketError(
      "no Ariadne token; set ARIADNE_AGENT_TOKEN, or run `flight-rules board login` with an agent token from Ariadne › Settings › Connections",
    );
  }

  private async call<T>(run: (client: AriadneClient) => Promise<T>): Promise<T> {
    const url = this.url();
    const token = this.token();
    const client = new AriadneClient({
      baseUrl: url,
      token,
      ...(this.transport !== undefined ? { transport: this.transport } : {}),
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });
    try {
      return await run(client);
    } catch (err) {
      throw new AriadnePacketError(this.redact(this.describe(err, url), token), { cause: err });
    }
  }

  private describe(err: unknown, url: string): string {
    if (!(err instanceof AriadneError)) return err instanceof Error ? err.message : String(err);
    if (err.failure === "invalid-input") return `${err.message}; fix the packet file and retry, nothing was sent`;
    if (err.failure === "network") {
      return `could not reach Ariadne at ${url}: ${err.message}; check the network and \`ariadne.url\`, then retry`;
    }
    if (err.status === 401 && err.code === "agent_token_expired") {
      return "Ariadne agent token expired (401 agent_token_expired); create a new one in Ariadne › Settings › Connections and run `flight-rules board login`";
    }
    if (err.status === 401) {
      return "Ariadne did not accept the token (401 unauthorized); it may be revoked or mistyped. Create a new one in Ariadne › Settings › Connections and set ARIADNE_AGENT_TOKEN or run `flight-rules board login`";
    }
    if (err.code === "agents_opt_in_required") {
      return "Agents access is off for you (403 agents_opt_in_required); turn on Agents in Ariadne › Settings › Connections and retry";
    }
    if (err.code === "revision_conflict") {
      return "the packet changed since you read it (409 revision_conflict); re-read with `flight-rules packet get <id>` and retry";
    }
    if (err.code === "packet_exists") {
      return "a packet with this id already exists with different content (409 packet_exists); use `flight-rules packet update <id>` to revise it, or choose a new id";
    }
    if (err.code === "packet_id_taken") {
      return "the packet id is taken by another author (409 packet_id_taken); choose a different id, or get one with `flight-rules packet new-id --title <title>`";
    }
    if (err.code === "reviewer_not_found") {
      return `a reviewer is not an active Ariadne member with a linked GitHub login (422 reviewer_not_found): ${err.message}; list valid logins with \`flight-rules packet reviewers\``;
    }
    if (err.failure === "http") return `Ariadne returned ${err.message}; check the packet and retry`;
    return `Ariadne request failed: ${err.message}`;
  }

  /** Belt and braces: no message may ever carry the token. */
  private redact(message: string, token: string): string {
    return token === "" ? message : message.split(token).join("[redacted]");
  }
}
