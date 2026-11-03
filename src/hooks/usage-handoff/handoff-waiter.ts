import { existsSync, rmSync } from "node:fs";
import { z } from "zod";
import type { AgentTransport } from "./agent-transport.js";
import { UsageHarnessSchema, harnessLabel, otherHarness } from "./usage-snapshot.js";

export const HandoffWaiterPropsSchema = z.object({
  transport: z.custom<AgentTransport>(),
  resetSlackMs: z.number().min(0).default(30_000),
  sleepChunkMs: z.number().positive().default(60_000),
  handbackPollMs: z.number().positive().default(5_000),
  maxHandbackWaits: z.number().int().positive().default(60),
});
export type HandoffWaiterProps = z.input<typeof HandoffWaiterPropsSchema>;

export const HandoffWaitRequestSchema = z.object({
  origin: z.string().min(1),
  standIn: z.string().min(1).optional(),
  resetsAt: z.number(),
  handback: z.string().min(1).optional(),
  harness: UsageHarnessSchema,
});
export type HandoffWaitRequest = z.infer<typeof HandoffWaitRequestSchema>;

const resumeMessage = "Usage has reset. Continue the work you were doing before you stopped.";

/**
 * Runs in its own `hc` terminal so it outlives the agent's window. It sleeps
 * until the usage window resets. With a stand-in agent it asks that agent for
 * a handback, waits for it to finish, and sends the handback to the original
 * terminal; without one it just tells the original agent to continue.
 */
export class HandoffWaiter {
  private readonly transport: AgentTransport;
  private readonly resetSlackMs: number;
  private readonly sleepChunkMs: number;
  private readonly handbackPollMs: number;
  private readonly maxHandbackWaits: number;

  constructor(props: HandoffWaiterProps) {
    const valid = HandoffWaiterPropsSchema.parse(props);
    this.transport = valid.transport;
    this.resetSlackMs = valid.resetSlackMs;
    this.sleepChunkMs = valid.sleepChunkMs;
    this.handbackPollMs = valid.handbackPollMs;
    this.maxHandbackWaits = valid.maxHandbackWaits;
  }

  async run(request: HandoffWaitRequest): Promise<void> {
    const target = request.resetsAt + this.resetSlackMs;
    while (Date.now() < target) {
      await this.sleep(Math.min(this.sleepChunkMs, target - Date.now()));
    }

    if (request.standIn === undefined || request.handback === undefined) {
      await this.transport.send(request.origin, resumeMessage);
      return;
    }

    const handedBack = await this.collectHandback(request.standIn, request.handback);
    const standInName = harnessLabel[otherHarness[request.harness]];
    if (handedBack) {
      await this.transport.send(
        request.origin,
        `Usage has reset. A ${standInName} agent carried on from your handoff; read its handback at ${request.handback} and continue.`,
      );
    } else {
      await this.transport.send(
        request.origin,
        `Usage has reset. The ${standInName} agent in ${request.standIn} did not write a handback, so check what it did before continuing.`,
      );
    }
  }

  private async collectHandback(standIn: string, handback: string): Promise<boolean> {
    rmSync(handback, { force: true });
    try {
      await this.transport.send(
        standIn,
        `The original agent's usage has reset. Stop at a safe point and write a handback to ${handback}: what you finished, what is left, the state of the branch or PR, and anything the original agent needs to know. Then stop.`,
      );
    } catch {
      return false;
    }

    for (let attempt = 0; attempt < this.maxHandbackWaits; attempt++) {
      await this.sleep(this.handbackPollMs);
      try {
        await this.transport.waitUntilIdle(standIn, 600);
      } catch {
        return existsSync(handback);
      }
      if (existsSync(handback)) return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
