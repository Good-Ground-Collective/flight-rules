import type { AriadneTransport } from "./ariadne-transport.js";
import type { BoardConfigLayer } from "./ariadne-board.js";
import type { AriadneTokenStore } from "./ariadne-token-store.js";
import type { Packet, ReviewerListResponse } from "./review-packet.schema.js";
/** A packet call that failed; the message is one line that ends in the next step. */
export declare class AriadnePacketError extends Error {
    name: string;
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
/**
 * Publishes and revises Review Packets as the author. Unlike the agent board,
 * nothing here is skipped: a missing token, a bad `ariadne.url` or any API
 * error throws an `AriadnePacketError` naming what to do next. A packet is
 * published even when `ariadne.enabled` is false, which only switches off hook reporting.
 */
export declare class AriadnePackets {
    private readonly readLayers;
    private readonly tokens;
    private readonly transport;
    private readonly timeoutMs;
    constructor(props: AriadnePacketsProps);
    /**
     * Publishes a packet, generating its id from the title when the file has none.
     */
    create(packet: unknown): Promise<Packet>;
    update(id: string, input: PacketUpdate): Promise<Packet>;
    get(id: string): Promise<Packet>;
    reviewers(): Promise<ReviewerListResponse>;
    /** The packet carrying an id: the file's own, or one generated from its title. Anything else is left for validation to reject. */
    private withId;
    /**
     * `ariadne.url` (default: production) read only from the user and local
     * layers, local winning. A URL that is not https (or http on localhost)
     * throws, so the token never goes to it.
     */
    private url;
    private token;
    private call;
    private describe;
    /** Belt and braces: no message may ever carry the token. */
    private redact;
}
