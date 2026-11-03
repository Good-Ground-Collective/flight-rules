import { z } from "zod";
export declare const UsageHarnessSchema: z.ZodEnum<{
    codex: "codex";
    "claude-code": "claude-code";
}>;
export type UsageHarness = z.infer<typeof UsageHarnessSchema>;
/** The harness that takes over when the given one runs out of usage. */
export declare const otherHarness: Record<UsageHarness, UsageHarness>;
export declare const harnessLabel: Record<UsageHarness, string>;
export declare const UsageWindowSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        session: "session";
        weekly: "weekly";
    }>;
    percent: z.ZodNumber;
    resetsAt: z.ZodNumber;
}, z.core.$strip>;
export type UsageWindow = z.infer<typeof UsageWindowSchema>;
/** The usage windows a plan reports at one moment. */
export declare class UsageSnapshot {
    readonly windows: readonly UsageWindow[];
    constructor(windows: readonly UsageWindow[]);
    /**
     * The window closest to its limit among those still open at `now`: that is
     * the one that will stop the agent, and its reset is when work can resume.
     */
    busiest(now: number): UsageWindow | undefined;
}
