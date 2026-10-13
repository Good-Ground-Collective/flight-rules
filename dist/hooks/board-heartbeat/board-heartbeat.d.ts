import type { BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";
import type { AgentTicketResolver } from "./agent-ticket-resolver.js";
/** At most one liveness heartbeat a minute per session. */
export declare const heartbeatIntervalMs = 60000;
/**
 * A skill heartbeat older than this is not kept alive: the run has gone quiet
 * long enough that Ariadne should show it stale (it does after 15 minutes).
 */
export declare const heartbeatMaxAgeMs: number;
/** The step of a main thread that no skill reports, found on a ticket by its checkout. */
export declare const checkoutStep = "working";
/**
 * What the hook hands the detached child, if anything: `send` re-sends the
 * session's skill heartbeat or the one the hook inferred; `branch` reads the
 * main thread's branch for a ticket, then heartbeats it.
 */
export type HeartbeatDue = {
    kind: "send";
    session: string;
} | {
    kind: "branch";
    claudeSession: string;
    cwd: string;
};
/** One activity line for a sub-agent that finished. */
export interface FinishedReport {
    session: string;
    ticket: string;
    text: string;
    id: string;
}
export interface BoardHeartbeatHookProps {
    sessions: BoardSessionStore;
    /** Without it, sub-agents are never mapped to tickets and only skill sessions are kept alive. */
    agents?: BoardAgentStore;
    resolver?: AgentTicketResolver;
    extractor?: TicketKeyExtractor;
    /**
     * Whether Ariadne is enabled with a token. Checked before spawning a child
     * for anything a skill did not record, so an unconfigured machine never
     * starts one. Defaults to true.
     */
    reportable?: () => boolean;
}
/**
 * The plugin's PostToolUse and SubagentStop handler for Ariadne. On each
 * tool call it decides whether a board session is due a liveness heartbeat:
 *
 * - In a sub-agent mapped to a Jira ticket, the session is
 *   `<session id>-<TICKET>`. A skill's heartbeat for it is replayed; without
 *   one the hook infers a heartbeat whose step is the dispatch description.
 * - Otherwise a skill's heartbeat for the Claude Code session is replayed.
 * - On the main thread with no skill heartbeat, a Jira key in the working
 *   directory's name, or else the branch (read by the detached child), names
 *   the ticket.
 *
 * A skill's step is never overwritten by an inferred one, and each board
 * session gets at most one heartbeat a minute.
 */
export declare class BoardHeartbeatHook {
    private readonly sessions;
    private readonly agents;
    private readonly resolver;
    private readonly extractor;
    private readonly reportable;
    constructor(props: BoardHeartbeatHookProps);
    /** The heartbeat to send now, already claimed, or undefined. */
    due(payload: unknown): HeartbeatDue | undefined;
    /**
     * Run by the detached child for a main thread: `branch` is what git
     * printed. Returns the session to replay, already claimed, or undefined.
     */
    dueForBranch(claudeSession: string, branch: string): string | undefined;
    /**
     * A sub-agent stopped: forgets it, and returns the activity line to post
     * when it was working on a Jira ticket and Ariadne is configured.
     */
    stopped(payload: unknown): FinishedReport | undefined;
    /**
     * A skill's heartbeat replayed if a skill posted to the ticket's session
     * within a day (only while it is live), else a heartbeat the hook infers.
     */
    private dueForTicket;
    /**
     * The live skill session for this Claude Code session: one recorded under
     * the session id itself (an explicit `--session`, or an older CLI), else
     * the one a skill last posted to by default from it.
     */
    private skillThread;
    /** The skill a Skill tool call just loaded, when it is a name Ariadne accepts. */
    private invokedSkill;
    private bridgeBackgroundLaunch;
    private subagentHeartbeat;
    /** A main thread's heartbeat names the skill it last loaded, when it loaded one. */
    private checkoutHeartbeat;
    private send;
}
/**
 * Sends heartbeats and activity lines from a detached child process, so the
 * tool call that fired the hook never waits on the network (up to two
 * 5-second attempts).
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
    sendBranch(claudeSession: string, cwd: string): void;
    sendFinished(report: FinishedReport): void;
    private spawnHook;
}
