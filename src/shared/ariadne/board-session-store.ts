import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agentStates } from "./ariadne.schema.js";
import type { HeartbeatInput } from "./ariadne.schema.js";

const SessionRecordSchema = z.object({
  heartbeat: z.object({
    session: z.string(),
    step: z.string(),
    state: z.enum(agentStates),
    ticket: z.string().optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
    skill: z.string().optional(),
    detail: z.string().optional(),
  }),
  /** When a skill last posted this heartbeat. */
  recordedAt: z.number(),
  /** When any heartbeat for the session was last sent, by a skill or the hook. */
  sentAt: z.number(),
});

export type BoardSessionRecord = z.infer<typeof SessionRecordSchema>;

export interface BoardSessionStoreProps {
  env?: Record<string, string | undefined>;
  home?: string;
  now?: () => number;
}

/** Session ids become file names, so only the API's own session alphabet is accepted. */
const sessionFilePattern = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * The last heartbeat a skill posted for each session, kept outside every
 * repository in `$XDG_STATE_HOME/flight-rules/board` (default
 * `~/.local/state/flight-rules/board`). It is how the heartbeat hook knows
 * which ticket and step a session is on, so it can keep the session alive
 * without overwriting the step, and how it throttles itself. Holds no token.
 */
export class BoardSessionStore {
  private readonly env: Record<string, string | undefined>;
  private readonly home: string;
  private readonly now: () => number;

  constructor(props: BoardSessionStoreProps = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
    this.now = props.now ?? Date.now;
  }

  dir(): string {
    const stateHome = this.env["XDG_STATE_HOME"];
    const base = stateHome !== undefined && stateHome !== "" ? stateHome : join(this.home, ".local", "state");
    return join(base, "flight-rules", "board");
  }

  read(session: string): BoardSessionRecord | undefined {
    const path = this.pathFor(session);
    if (path === undefined || !existsSync(path)) return undefined;
    try {
      const parsed = SessionRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** Remembers a heartbeat a skill just sent. */
  record(heartbeat: HeartbeatInput): void {
    const now = this.now();
    const { session, step, state } = heartbeat;
    const optional = Object.fromEntries(
      (["ticket", "repo", "branch", "skill", "detail"] as const)
        .map((key) => [key, heartbeat[key]] as const)
        .filter(([, value]) => value !== undefined && value !== ""),
    );
    this.write({ heartbeat: { session, step, state, ...optional }, recordedAt: now, sentAt: now });
  }

  /**
   * Claims the next liveness heartbeat for a session: returns its record and
   * marks it sent, or returns undefined when there is nothing to keep alive.
   * That is when no skill has recorded one, the record is older than
   * `maxAgeMs`, the run aborted, or one was sent less than `intervalMs` ago.
   */
  claim(session: string, intervalMs: number, maxAgeMs: number): BoardSessionRecord | undefined {
    const record = this.read(session);
    if (record === undefined) return undefined;
    const now = this.now();
    if (record.heartbeat.state === "abort") return undefined;
    if (now - record.recordedAt > maxAgeMs) return undefined;
    if (now - record.sentAt < intervalMs) return undefined;
    const claimed = { ...record, sentAt: now };
    this.write(claimed);
    return claimed;
  }

  private write(record: BoardSessionRecord): void {
    const path = this.pathFor(record.heartbeat.session);
    if (path === undefined) return;
    mkdirSync(this.dir(), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
  }

  private pathFor(session: string): string | undefined {
    return sessionFilePattern.test(session) ? join(this.dir(), `${session}.json`) : undefined;
  }
}
