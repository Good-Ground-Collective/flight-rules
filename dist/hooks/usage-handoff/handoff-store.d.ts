import { z } from "zod";
import { type UsageHarness } from "./usage-snapshot.js";
export declare const HandoffPhaseSchema: z.ZodEnum<{
    waiting: "waiting";
    requested: "requested";
    delivering: "delivering";
    delivered: "delivered";
    written: "written";
    declined: "declined";
}>;
/** What the hook has done for one session in one usage window. */
export declare const HandoffRecordSchema: z.ZodObject<{
    harness: z.ZodEnum<{
        codex: "codex";
        "claude-code": "claude-code";
    }>;
    sessionId: z.ZodString;
    resetsAt: z.ZodNumber;
    phase: z.ZodEnum<{
        waiting: "waiting";
        requested: "requested";
        delivering: "delivering";
        delivered: "delivered";
        written: "written";
        declined: "declined";
    }>;
    cwd: z.ZodString;
    standIn: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    waiter: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type HandoffRecord = z.infer<typeof HandoffRecordSchema>;
export interface HandoffStoreProps {
    env?: Record<string, string | undefined>;
    home?: string;
}
/**
 * The files a handoff leaves under `$XDG_STATE_HOME/flight-rules/` (default
 * `~/.local/state/flight-rules/`): the handoff and handback notes in
 * `handoffs/`, the per-session record that keeps a window to one handoff, and
 * the usage cache in `usage/`.
 */
export declare class HandoffStore {
    private readonly root;
    constructor(props?: HandoffStoreProps);
    usageFolder(): string;
    handoffsFolder(): string;
    handoffPath(harness: UsageHarness, sessionId: string): string;
    handbackPath(harness: UsageHarness, sessionId: string): string;
    read(harness: UsageHarness, sessionId: string): HandoffRecord | undefined;
    write(record: HandoffRecord): void;
    private recordPath;
    private stem;
}
