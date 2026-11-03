import { z } from "zod";

export const UsageHarnessSchema = z.enum(["claude-code", "codex"]);
export type UsageHarness = z.infer<typeof UsageHarnessSchema>;

/** The harness that takes over when the given one runs out of usage. */
export const otherHarness: Record<UsageHarness, UsageHarness> = { "claude-code": "codex", codex: "claude-code" };

export const harnessLabel: Record<UsageHarness, string> = { "claude-code": "Claude Code", codex: "Codex" };

export const UsageWindowSchema = z.object({
  kind: z.enum(["session", "weekly"]),
  percent: z.number().min(0),
  resetsAt: z.number().describe("Epoch milliseconds"),
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

/** The usage windows a plan reports at one moment. */
export class UsageSnapshot {
  constructor(readonly windows: readonly UsageWindow[]) {}

  /**
   * The window closest to its limit among those still open at `now`: that is
   * the one that will stop the agent, and its reset is when work can resume.
   */
  busiest(now: number): UsageWindow | undefined {
    const open = this.windows.filter((window) => window.resetsAt > now);
    return open.reduce<UsageWindow | undefined>(
      (best, window) => (best === undefined || window.percent > best.percent ? window : best),
      undefined,
    );
  }
}
