import { z } from "zod";
import type { AgentTransport } from "./agent-transport.js";
export declare const HandoffWaiterPropsSchema: z.ZodObject<{
    transport: z.ZodCustom<AgentTransport, AgentTransport>;
    resetSlackMs: z.ZodDefault<z.ZodNumber>;
    sleepChunkMs: z.ZodDefault<z.ZodNumber>;
    handbackPollMs: z.ZodDefault<z.ZodNumber>;
    maxHandbackWaits: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type HandoffWaiterProps = z.input<typeof HandoffWaiterPropsSchema>;
export declare const HandoffWaitRequestSchema: z.ZodObject<{
    origin: z.ZodString;
    standIn: z.ZodOptional<z.ZodString>;
    resetsAt: z.ZodNumber;
    handback: z.ZodOptional<z.ZodString>;
    harness: z.ZodEnum<{
        codex: "codex";
        "claude-code": "claude-code";
    }>;
}, z.core.$strip>;
export type HandoffWaitRequest = z.infer<typeof HandoffWaitRequestSchema>;
/**
 * Runs in its own `hc` terminal so it outlives the agent's window. It sleeps
 * until the usage window resets. With a stand-in agent it asks that agent for
 * a handback, waits for it to finish, and sends the handback to the original
 * terminal; without one it just tells the original agent to continue.
 */
export declare class HandoffWaiter {
    private readonly transport;
    private readonly resetSlackMs;
    private readonly sleepChunkMs;
    private readonly handbackPollMs;
    private readonly maxHandbackWaits;
    constructor(props: HandoffWaiterProps);
    run(request: HandoffWaitRequest): Promise<void>;
    private collectHandback;
    private sleep;
}
