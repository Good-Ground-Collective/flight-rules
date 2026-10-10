import type { ConfigScope } from "../config-store.js";
import type { AriadneTransport } from "./ariadne-transport.js";
import type { ActivityInput, ActivityResponse, HeartbeatInput, HeartbeatResponse, ItemInput, ItemListResponse, ItemResponse } from "./ariadne.schema.js";
import type { AriadneTokenStore } from "./ariadne-token-store.js";
import type { BoardSessionStore } from "./board-session-store.js";
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
/**
 * `notices` name config the board ignored. They are diagnostics: callers
 * print them only when asked to be loud (`--strict`, `board items`).
 */
export type BoardSkipReason = "disabled" | "no-token" | "invalid-url" | "not-jira-ticket" | "nothing-recorded";
export type BoardOutcome<T> = ({
    status: "skipped";
    reason: BoardSkipReason;
} | {
    status: "posted";
    value: T;
} | {
    status: "failed";
    message: string;
}) & {
    notices?: string[];
};
export interface AriadneBoardSettings {
    /** Undefined when the configured URL failed validation: the board is then not configured. */
    url: string | undefined;
    enabled: boolean;
    notices: string[];
}
/** One config layer, as `ConfigStore.layers()` returns it. */
export interface BoardConfigLayer {
    scope: ConfigScope;
    values: Record<string, unknown>;
}
export interface AriadneBoardProps {
    /** The flight-rules config layers, lowest precedence first; `ariadne.*` keys are read from the person's own. */
    readLayers: () => readonly BoardConfigLayer[];
    tokens: AriadneTokenStore;
    env?: Record<string, string | undefined>;
    transport?: AriadneTransport;
    timeoutMs?: number;
    /** Where skill heartbeats are remembered for the heartbeat hook; none means nothing is remembered. */
    sessions?: BoardSessionStore;
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
    private readonly readLayers;
    private readonly tokens;
    private readonly env;
    private readonly transport;
    private readonly timeoutMs;
    private readonly sessions;
    constructor(props: AriadneBoardProps);
    /**
     * `ariadne.url` (default: production) and `ariadne.enabled` (default:
     * true), read only from the user and local layers, local winning. Project
     * and file layers are ignored with a notice. A URL that is not https (or
     * http on localhost) leaves `url` undefined, so nothing is ever sent to it.
     */
    settings(): AriadneBoardSettings;
    /** The Claude Code session id, when this process runs inside a session. */
    defaultSession(): string | undefined;
    /**
     * Posts a heartbeat and remembers it for the session, so the heartbeat
     * hook can keep the session alive with the same ticket and step.
     */
    heartbeat(input: BoardInput<HeartbeatInput>, options?: BoardCallOptions): Promise<BoardOutcome<HeartbeatResponse>>;
    /**
     * Re-sends the last heartbeat a skill posted for `session`, without
     * refreshing when it was recorded. The heartbeat hook's liveness ping.
     */
    replay(session: string, options?: BoardCallOptions): Promise<BoardOutcome<HeartbeatResponse>>;
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
    /** Remembering is best effort: a full disk must not fail a report. */
    private remember;
    private withSession;
    private call;
    private describe;
    /** Belt and braces: no message may ever carry the token. */
    private redact;
}
