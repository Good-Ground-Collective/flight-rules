import { Command } from "commander";
import { z } from "zod";
import { HcAgentTransport, type AgentTransport } from "../../usage-handoff/agent-transport.js";
import { HandoffWaiter, HandoffWaitRequestSchema } from "../../usage-handoff/handoff-waiter.js";

const WaitOptionsSchema = z
  .object({
    origin: z.string(),
    standIn: z.string().optional(),
    at: z.coerce.number(),
    handback: z.string().optional(),
    harness: z.string(),
  })
  .transform((options) =>
    HandoffWaitRequestSchema.parse({
      origin: options.origin,
      standIn: options.standIn,
      resetsAt: options.at,
      handback: options.handback,
      harness: options.harness,
    }),
  );

export function createHandoffCommand(getTransport: () => AgentTransport = () => new HcAgentTransport()): Command {
  const handoff = new Command("handoff").description("finish a usage handoff between Claude Code and Codex");

  handoff
    .command("wait")
    .description(
      "wait for a usage window to reset, then collect the stand-in agent's handback and send it to the original terminal, or tell the original agent to continue; runs in an hc terminal started by `hook usage-handoff`",
    )
    .requiredOption("--origin <terminal>", "the hc terminal of the agent that ran out of usage")
    .option("--stand-in <terminal>", "the hc terminal of the agent that took the work over")
    .requiredOption("--at <epoch-ms>", "when the usage window resets, in epoch milliseconds")
    .option("--handback <path>", "where the stand-in writes its handback")
    .option("--harness <harness>", "the harness that ran out of usage: claude-code or codex", "claude-code")
    .exitOverride()
    .action(async (opts: Record<string, string | undefined>) => {
      try {
        const request = WaitOptionsSchema.parse(opts);
        await new HandoffWaiter({ transport: getTransport() }).run(request);
      } catch {
        // The waiter has nobody to report to, so a failure simply ends it.
        return;
      }
    });

  return handoff;
}
