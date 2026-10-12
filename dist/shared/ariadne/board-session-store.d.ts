import { z } from "zod";
import type { HeartbeatInput } from "./ariadne.schema.js";
declare const SessionRecordSchema: z.ZodObject<{
    heartbeat: z.ZodObject<{
        session: z.ZodString;
        step: z.ZodString;
        state: z.ZodEnum<{
            abort: "abort";
            nominal: "nominal";
            caution: "caution";
            hold: "hold";
        }>;
        ticket: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        detail: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    recordedAt: z.ZodNumber;
    sentAt: z.ZodNumber;
}, z.core.$strip>;
declare const InferredRecordSchema: z.ZodObject<{
    heartbeat: z.ZodObject<{
        session: z.ZodString;
        step: z.ZodString;
        state: z.ZodEnum<{
            abort: "abort";
            nominal: "nominal";
            caution: "caution";
            hold: "hold";
        }>;
        ticket: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        detail: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    sentAt: z.ZodNumber;
}, z.core.$strip>;
export type BoardSessionRecord = z.infer<typeof SessionRecordSchema>;
export type InferredSessionRecord = z.infer<typeof InferredRecordSchema>;
export interface BoardSessionStoreProps {
    env?: Record<string, string | undefined>;
    home?: string;
    now?: () => number;
}
/**
 * The board session for a ticket worked inside one Claude Code session:
 * `<session id>-<TICKET>`. Every agent on one ticket in one orchestrator
 * shares a row, and skill posts and hook heartbeats land in the same one.
 * The Claude session part is cut so the whole id fits the API's 80
 * characters; the ticket is never cut.
 */
export declare class TicketSessionKey {
    key(claudeSession: string, ticket: string): string | undefined;
}
export declare const ticketSessionKey: TicketSessionKey;
/**
 * What the board hooks remember between tool calls, kept outside every
 * repository in `$XDG_STATE_HOME/flight-rules/board` (default
 * `~/.local/state/flight-rules/board`). Holds no token.
 *
 * - `<session>.json`: the last heartbeat a skill posted, so the hook can keep
 *   the session alive without overwriting the step.
 * - `inferred/<session>.json`: the heartbeat the hook inferred for a
 *   sub-agent or a checkout no skill reported, and when it was last sent.
 * - `threads/<claude session>.json`: the board session a skill last posted
 *   to by default from that Claude Code session, and the main thread's
 *   branch-lookup throttle.
 */
export declare class BoardSessionStore {
    private readonly files;
    private readonly now;
    constructor(props?: BoardSessionStoreProps);
    dir(): string;
    read(session: string): BoardSessionRecord | undefined;
    /** Remembers a heartbeat a skill just sent. */
    record(heartbeat: HeartbeatInput): void;
    /**
     * Claims the next liveness heartbeat for a session: returns its record and
     * marks it sent, or returns undefined when there is nothing to keep alive.
     * That is when no skill has recorded one, the record is older than
     * `maxAgeMs`, the run aborted, or one was sent less than `intervalMs` ago.
     */
    claim(session: string, intervalMs: number, maxAgeMs: number): BoardSessionRecord | undefined;
    /** Whether a skill has posted to this session within `maxAgeMs`, whatever its state. */
    hasSkillRecord(session: string, maxAgeMs: number): boolean;
    /** Whether a skill record is one the hook keeps alive: not aborted and within `maxAgeMs`. */
    isLive(session: string, maxAgeMs: number): boolean;
    readInferred(session: string): InferredSessionRecord | undefined;
    /**
     * Claims a liveness heartbeat the hook inferred: stores it and returns true,
     * or returns false when one was sent for the session less than `intervalMs` ago.
     */
    claimInferred(heartbeat: HeartbeatInput, intervalMs: number): boolean;
    /** Remembers that a skill posted to `board` by default from this Claude Code session. */
    pointThread(claudeSession: string, board: string): void;
    /** The board session a skill last posted to by default from this Claude Code session. */
    threadSession(claudeSession: string): string | undefined;
    /** At most one main-thread branch lookup per `intervalMs` per Claude Code session. */
    claimBranchCheck(claudeSession: string, intervalMs: number): boolean;
    /** Deletes inferred heartbeats and thread records untouched for `maxAgeMs`. */
    prune(maxAgeMs: number): void;
    private thread;
    private compact;
}
export {};
