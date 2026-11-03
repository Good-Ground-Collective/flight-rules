import { z } from "zod";
import { type AgentTransport } from "./agent-transport.js";
import { HandoffStore } from "./handoff-store.js";
import { type UsageReader } from "./usage-reader.js";
import { type UsageHarness } from "./usage-snapshot.js";
export declare const UsageHandoffSettingsSchema: z.ZodObject<{
    usageHandoffThreshold: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    usageHandoffMinResetMinutes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type UsageHandoffSettings = z.infer<typeof UsageHandoffSettingsSchema>;
/** The Stop-hook reply shared by Claude Code and Codex: `block` keeps the agent going, `systemMessage` tells the user. */
export type StopHookOutput = {
    decision: "block";
    reason: string;
} | {
    systemMessage: string;
};
export declare const UsageHandoffHookPropsSchema: z.ZodObject<{
    readers: z.ZodOptional<z.ZodCustom<Record<"codex" | "claude-code", UsageReader>, Record<"codex" | "claude-code", UsageReader>>>;
    transport: z.ZodOptional<z.ZodCustom<AgentTransport, AgentTransport>>;
    store: z.ZodOptional<z.ZodInstanceOf<HandoffStore>>;
    settings: z.ZodOptional<z.ZodObject<{
        usageHandoffThreshold: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        usageHandoffMinResetMinutes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>>;
}, z.core.$strip>;
export type UsageHandoffHookProps = z.input<typeof UsageHandoffHookPropsSchema>;
/**
 * Passes a session's unfinished work to the other harness when its plan's
 * usage window is nearly used up, and brings the work back when the window
 * resets. At the end of the first turn over the threshold the agent is kept
 * going once to write a handoff note; on the next Stop the note is delivered
 * to an idle agent of the other harness in the same Herdr space (or a new
 * one), and a waiter terminal returns the stand-in's handback at the reset.
 * When the reset is close the work is not moved, and the waiter only tells the
 * original agent to continue. A window gets one handoff per session, and no
 * failure here ever stops the session from ending.
 */
export declare class UsageHandoffHook {
    private readonly readers;
    private readonly transport;
    private readonly store;
    private readonly settings;
    private readonly env;
    constructor(props?: UsageHandoffHookProps);
    /** Handles one Stop payload; resolves to the hook's reply, or nothing to let Stop proceed. */
    handle(harness: UsageHarness, payload: unknown): Promise<StopHookOutput | undefined>;
    private requestHandoff;
    private deliver;
    private deliverThroughHc;
    private waitForReset;
    private loadSettings;
    private iso;
    private clock;
}
