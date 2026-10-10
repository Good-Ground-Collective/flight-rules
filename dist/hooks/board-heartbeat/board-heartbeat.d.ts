import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
/** At most one liveness heartbeat a minute per session. */
export declare const heartbeatIntervalMs = 60000;
/**
 * A skill heartbeat older than this is not kept alive: the run has gone quiet
 * long enough that Ariadne should show it stale (it does after 15 minutes).
 */
export declare const heartbeatMaxAgeMs: number;
export interface BoardHeartbeatHookProps {
    sessions: BoardSessionStore;
}
/**
 * The plugin's PostToolUse handler for Ariadne. A skill's `board post
 * heartbeat` records the session's ticket and step; on any later tool call
 * this decides whether that session is due a liveness heartbeat. No record
 * (nothing configured, no ticket in progress, a GitHub-tracked run) means
 * nothing to do.
 */
export declare class BoardHeartbeatHook {
    private readonly sessions;
    constructor(props: BoardHeartbeatHookProps);
    /** The session to send a heartbeat for now, already claimed, or undefined. */
    due(payload: unknown): string | undefined;
}
/**
 * Sends the heartbeat from a detached child process, so the tool call that
 * fired the hook never waits on the network (up to two 5-second attempts).
 */
export interface DetachedHeartbeatSenderProps {
    /** The node binary; defaults to this process's. */
    execPath?: string;
    /** The CLI bundle to re-run; defaults to this process's entry script. */
    entry?: string | undefined;
}
export declare class DetachedHeartbeatSender {
    private readonly execPath;
    private readonly entry;
    constructor(props?: DetachedHeartbeatSenderProps);
    send(session: string): void;
}
