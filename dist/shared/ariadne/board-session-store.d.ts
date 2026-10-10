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
export type BoardSessionRecord = z.infer<typeof SessionRecordSchema>;
export interface BoardSessionStoreProps {
    env?: Record<string, string | undefined>;
    home?: string;
    now?: () => number;
}
/**
 * The last heartbeat a skill posted for each session, kept outside every
 * repository in `$XDG_STATE_HOME/flight-rules/board` (default
 * `~/.local/state/flight-rules/board`). It is how the heartbeat hook knows
 * which ticket and step a session is on, so it can keep the session alive
 * without overwriting the step, and how it throttles itself. Holds no token.
 */
export declare class BoardSessionStore {
    private readonly env;
    private readonly home;
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
    private write;
    private pathFor;
}
export {};
