import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { UsageHarnessSchema, type UsageHarness } from "./usage-snapshot.js";

export const HandoffPhaseSchema = z.enum(["requested", "delivering", "delivered", "written", "waiting", "declined"]);

/** What the hook has done for one session in one usage window. */
export const HandoffRecordSchema = z.object({
  harness: UsageHarnessSchema,
  sessionId: z.string(),
  resetsAt: z.number(),
  phase: HandoffPhaseSchema,
  cwd: z.string(),
  standIn: z.string().nullable().default(null),
  waiter: z.string().nullable().default(null),
});
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
export class HandoffStore {
  private readonly root: string;

  constructor(props: HandoffStoreProps = {}) {
    const env = props.env ?? process.env;
    const stateHome = env["XDG_STATE_HOME"];
    const base = stateHome !== undefined && stateHome !== "" ? stateHome : join(props.home ?? homedir(), ".local", "state");
    this.root = join(base, "flight-rules");
  }

  usageFolder(): string {
    return join(this.root, "usage");
  }

  handoffsFolder(): string {
    return join(this.root, "handoffs");
  }

  handoffPath(harness: UsageHarness, sessionId: string): string {
    return join(this.handoffsFolder(), `${this.stem(harness, sessionId)}.md`);
  }

  handbackPath(harness: UsageHarness, sessionId: string): string {
    return join(this.handoffsFolder(), `${this.stem(harness, sessionId)}.handback.md`);
  }

  read(harness: UsageHarness, sessionId: string): HandoffRecord | undefined {
    try {
      return HandoffRecordSchema.parse(JSON.parse(readFileSync(this.recordPath(harness, sessionId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  write(record: HandoffRecord): void {
    mkdirSync(this.handoffsFolder(), { recursive: true });
    const path = this.recordPath(record.harness, record.sessionId);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n");
    renameSync(temporary, path);
  }

  private recordPath(harness: UsageHarness, sessionId: string): string {
    return join(this.handoffsFolder(), `${this.stem(harness, sessionId)}.json`);
  }

  private stem(harness: UsageHarness, sessionId: string): string {
    return `${harness}-${sessionId.replaceAll(/[^A-Za-z0-9._-]/g, "_")}`;
  }
}
