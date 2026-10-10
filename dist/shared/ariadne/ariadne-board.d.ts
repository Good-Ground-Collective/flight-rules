import type { AriadneTransport } from "./ariadne-transport.js";
import type { ActivityInput, ActivityResponse, HeartbeatInput, HeartbeatResponse, ItemInput, ItemListResponse, ItemResponse } from "./ariadne.schema.js";
import type { AriadneTokenStore } from "./ariadne-token-store.js";
/** A board call whose `session` falls back to the Claude Code session id. */
export type BoardInput<T extends {
    session: string;
}> = Omit<T, "session"> & {
    session?: string | undefined;
};
export interface BoardCallOptions {
    /**
     * Off (the default), a missing token is a silent skip. On, the request is
     * sent without one, so the API's own answer (401) surfaces as a failure.
     * Callers map a failure to exit 1 only under strict.
     */
    strict?: boolean;
}
export type BoardOutcome<T> = {
    status: "skipped";
    reason: "disabled" | "no-token";
} | {
    status: "posted";
    value: T;
} | {
    status: "failed";
    message: string;
};
export interface AriadneBoardSettings {
    url: string;
    enabled: boolean;
}
export interface AriadneBoardProps {
    /** The merged flight-rules config values, valid or not; `ariadne.*` keys are read from them. */
    readConfig: () => Record<string, unknown>;
    tokens: AriadneTokenStore;
    env?: Record<string, string | undefined>;
    transport?: AriadneTransport;
    timeoutMs?: number;
}
/** Claude Code exports the session id to every Bash tool call it runs. */
export declare const claudeSessionEnv = "CLAUDE_CODE_SESSION_ID";
/** The step a session gets when an item or activity line is its first report. */
export declare const bootstrapStep = "started";
/**
 * Reports a flight-rules run to Ariadne's Agents page. Opt-in and quiet: with
 * `ariadne.enabled` false, or no token, every call is skipped; every other
 * problem comes back as a one-line failure instead of a throw, so a hook or
 * skill can never fail because of Ariadne.
 */
export declare class AriadneBoard {
    private readonly readConfig;
    private readonly tokens;
    private readonly env;
    private readonly transport;
    private readonly timeoutMs;
    constructor(props: AriadneBoardProps);
    /** `ariadne.url` (default: production) and `ariadne.enabled` (default: true). */
    settings(): AriadneBoardSettings;
    /** The Claude Code session id, when this process runs inside a session. */
    defaultSession(): string | undefined;
    heartbeat(input: BoardInput<HeartbeatInput>, options?: BoardCallOptions): Promise<BoardOutcome<HeartbeatResponse>>;
    /**
     * Posts an item. A session that has never sent a heartbeat (or has aged
     * out) gets one first, with step `started` and state `nominal`, and the item
     * is posted again. A live session's step is never overwritten this way.
     */
    item(input: BoardInput<ItemInput>, options?: BoardCallOptions): Promise<BoardOutcome<ItemResponse>>;
    /** Posts one activity line, creating the session first as `item` does. */
    activity(input: BoardInput<ActivityInput>, options?: BoardCallOptions): Promise<BoardOutcome<ActivityResponse>>;
    /** Every item of one of the caller's sessions, open and resolved, with any chosen option. */
    items(session: string | undefined, options?: BoardCallOptions): Promise<BoardOutcome<ItemListResponse>>;
    private withSession;
    private call;
    private describe;
    /** Belt and braces: no message may ever carry the token. */
    private redact;
}
