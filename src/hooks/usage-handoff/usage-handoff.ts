import { existsSync } from "node:fs";
import { z } from "zod";
import { ConfigStore } from "../../shared/config-store.js";
import { usageHandoffMinResetMinutesSchema, usageHandoffThresholdSchema } from "../../shared/config.js";
import { HcAgentTransport, type AgentTransport } from "./agent-transport.js";
import { HandoffStore, type HandoffRecord } from "./handoff-store.js";
import {
  CachedUsageReader,
  ClaudeCodeUsageReader,
  CodexUsageReader,
  type UsageReader,
} from "./usage-reader.js";
import {
  harnessLabel,
  otherHarness,
  type UsageHarness,
  type UsageWindow,
} from "./usage-snapshot.js";

export const UsageHandoffSettingsSchema = z.object({
  usageHandoffThreshold: usageHandoffThresholdSchema.default(95),
  usageHandoffMinResetMinutes: usageHandoffMinResetMinutesSchema.default(10),
});
export type UsageHandoffSettings = z.infer<typeof UsageHandoffSettingsSchema>;

/** The Stop-hook reply shared by Claude Code and Codex: `block` keeps the agent going, `systemMessage` tells the user. */
export type StopHookOutput = { decision: "block"; reason: string } | { systemMessage: string };

const StopPayloadSchema = z.looseObject({ session_id: z.string().min(1), cwd: z.string().optional() });

export const UsageHandoffHookPropsSchema = z.object({
  readers: z.custom<Record<UsageHarness, UsageReader>>().optional(),
  transport: z.custom<AgentTransport>().optional(),
  store: z.instanceof(HandoffStore).optional(),
  settings: UsageHandoffSettingsSchema.optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
});
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
export class UsageHandoffHook {
  private readonly readers: Record<UsageHarness, UsageReader>;
  private readonly transport: AgentTransport;
  private readonly store: HandoffStore;
  private readonly settings: UsageHandoffSettings | undefined;
  private readonly env: Record<string, string | undefined>;

  constructor(props: UsageHandoffHookProps = {}) {
    const valid = UsageHandoffHookPropsSchema.parse(props);
    this.env = valid.env ?? process.env;
    this.store = valid.store ?? new HandoffStore({ env: this.env });
    this.transport = valid.transport ?? new HcAgentTransport();
    this.settings = valid.settings;
    this.readers = valid.readers ?? {
      "claude-code": new CachedUsageReader({
        harness: "claude-code",
        reader: new ClaudeCodeUsageReader(),
        folder: this.store.usageFolder(),
      }),
      codex: new CachedUsageReader({
        harness: "codex",
        reader: new CodexUsageReader(),
        folder: this.store.usageFolder(),
      }),
    };
  }

  /** Handles one Stop payload; resolves to the hook's reply, or nothing to let Stop proceed. */
  async handle(harness: UsageHarness, payload: unknown): Promise<StopHookOutput | undefined> {
    const parsed = StopPayloadSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    const sessionId = parsed.data.session_id;
    const cwd = parsed.data.cwd ?? process.cwd();

    const record = this.store.read(harness, sessionId);
    if (record !== undefined && record.resetsAt > Date.now()) {
      return record.phase === "requested" ? this.deliver(record) : undefined;
    }

    const settings = this.settings ?? this.loadSettings(harness, cwd);
    const snapshot = await this.readers[harness].read();
    const busiest = snapshot?.busiest(Date.now());
    if (busiest === undefined || busiest.percent < settings.usageHandoffThreshold) return undefined;

    const minutesLeft = (busiest.resetsAt - Date.now()) / 60_000;
    if (minutesLeft < settings.usageHandoffMinResetMinutes) return this.waitForReset({ harness, sessionId, cwd }, busiest);
    return this.requestHandoff({ harness, sessionId, cwd }, busiest, settings);
  }

  private async requestHandoff(
    session: { harness: UsageHarness; sessionId: string; cwd: string },
    window: UsageWindow,
    settings: UsageHandoffSettings,
  ): Promise<StopHookOutput> {
    const other = otherHarness[session.harness];
    const otherBusiest = (await this.readers[other].read())?.busiest(Date.now());
    if (otherBusiest !== undefined && otherBusiest.percent >= settings.usageHandoffThreshold) {
      this.store.write({ ...session, resetsAt: window.resetsAt, phase: "declined", standIn: null, waiter: null });
      return {
        systemMessage: `${harnessLabel[session.harness]} is at ${Math.round(window.percent)}% of its ${window.kind} usage and ${harnessLabel[other]} is at ${Math.round(otherBusiest.percent)}% of its ${otherBusiest.kind} usage, so the work was not handed off. ${harnessLabel[session.harness]} resets at ${this.clock(window.resetsAt)}.`,
      };
    }

    this.store.write({ ...session, resetsAt: window.resetsAt, phase: "requested", standIn: null, waiter: null });
    const path = this.store.handoffPath(session.harness, session.sessionId);
    return {
      decision: "block",
      reason: `${harnessLabel[session.harness]} is at ${Math.round(window.percent)}% of its ${window.kind} usage, which resets at ${this.iso(window.resetsAt)}. Before you stop, write a handoff note to ${path} so another agent can carry on from it: the remaining tasks, the branch, the ticket or PR, the current state of the work (what is done, what is half-done, what to run next), the working directory ${session.cwd}, and the reset time ${this.iso(window.resetsAt)}. Then stop without starting anything else.`,
    };
  }

  private async deliver(record: HandoffRecord): Promise<StopHookOutput | undefined> {
    const path = this.store.handoffPath(record.harness, record.sessionId);
    const terminal = this.env["HC_TERMINAL_ID"];
    if (!existsSync(path)) {
      this.store.write({ ...record, phase: "declined" });
      return undefined;
    }
    if (terminal === undefined || terminal === "") {
      this.store.write({ ...record, phase: "written" });
      return { systemMessage: `Usage is nearly used up and not inside hc, so the handoff was not delivered. The handoff note is at ${path}.` };
    }

    try {
      return await this.deliverThroughHc(record, terminal, path);
    } catch {
      this.store.write({ ...record, phase: "written" });
      return { systemMessage: `The handoff could not be delivered through hc. The handoff note is at ${path}.` };
    }
  }

  private async deliverThroughHc(record: HandoffRecord, terminal: string, path: string): Promise<StopHookOutput> {
    const other = otherHarness[record.harness];
    const handback = this.store.handbackPath(record.harness, record.sessionId);
    const space = await this.transport.spaceOf(terminal);
    const prompt = `A ${harnessLabel[record.harness]} session ran out of usage. Read ${path} and continue its remaining work in ${record.cwd}. When asked for a handback, write it to ${handback}.`;

    const idle = space === undefined ? undefined : await this.transport.findIdleAgent(space, other, terminal);
    let standIn: string;
    if (idle !== undefined) {
      await this.transport.send(idle, prompt);
      standIn = idle;
    } else if (space !== undefined) {
      standIn = await this.transport.startAgent({ harness: other, space, cwd: record.cwd, prompt });
    } else {
      throw new Error("The terminal is not in a Herdr space");
    }

    const waiter = await this.transport.startWaiter(space, record.cwd, [
      "handoff",
      "wait",
      "--origin",
      terminal,
      "--stand-in",
      standIn,
      "--at",
      String(record.resetsAt),
      "--handback",
      handback,
      "--harness",
      record.harness,
    ]);
    this.store.write({ ...record, phase: "delivered", standIn, waiter });
    return {
      systemMessage: `Handed the work to ${harnessLabel[other]} in ${standIn}. The handback returns here when usage resets at ${this.clock(record.resetsAt)}. Handoff note: ${path}.`,
    };
  }

  private async waitForReset(
    session: { harness: UsageHarness; sessionId: string; cwd: string },
    window: UsageWindow,
  ): Promise<StopHookOutput | undefined> {
    const terminal = this.env["HC_TERMINAL_ID"];
    const record = { ...session, resetsAt: window.resetsAt, standIn: null, waiter: null };
    if (terminal === undefined || terminal === "") {
      this.store.write({ ...record, phase: "declined" });
      return undefined;
    }

    try {
      const space = await this.transport.spaceOf(terminal);
      const waiter = await this.transport.startWaiter(space, session.cwd, [
        "handoff",
        "wait",
        "--origin",
        terminal,
        "--at",
        String(window.resetsAt),
        "--harness",
        session.harness,
      ]);
      this.store.write({ ...record, phase: "waiting", waiter });
      return { systemMessage: `Usage resets at ${this.clock(window.resetsAt)}; the agent will be told to continue then.` };
    } catch {
      this.store.write({ ...record, phase: "declined" });
      return undefined;
    }
  }

  private loadSettings(harness: UsageHarness, cwd: string): UsageHandoffSettings {
    try {
      const store = new ConfigStore({ cwd, env: this.env, host: harness === "codex" ? "codex" : "claude" });
      const parsed = UsageHandoffSettingsSchema.safeParse(store.inspect().values);
      if (parsed.success) return parsed.data;
    } catch {
      return UsageHandoffSettingsSchema.parse({});
    }
    return UsageHandoffSettingsSchema.parse({});
  }

  private iso(epochMs: number): string {
    return new Date(epochMs).toISOString();
  }

  private clock(epochMs: number): string {
    return new Date(epochMs).toLocaleString();
  }
}
