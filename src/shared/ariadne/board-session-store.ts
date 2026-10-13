import { z } from "zod";
import { agentStates } from "./ariadne.schema.js";
import type { HeartbeatInput } from "./ariadne.schema.js";
import { BoardStateFiles } from "./board-state-files.js";

const HeartbeatRecordSchema = z.object({
  session: z.string(),
  step: z.string(),
  state: z.enum(agentStates),
  ticket: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  skill: z.string().optional(),
  detail: z.string().optional(),
});

const SessionRecordSchema = z.object({
  heartbeat: HeartbeatRecordSchema,
  /** When a skill last posted this heartbeat. */
  recordedAt: z.number(),
  /** When any heartbeat for the session was last sent, by a skill or the hook. */
  sentAt: z.number(),
});

const InferredRecordSchema = z.object({
  heartbeat: HeartbeatRecordSchema,
  /** When the hook last sent this inferred heartbeat. */
  sentAt: z.number(),
});

const ThreadRecordSchema = z.object({
  /** The board session a skill last posted to by default from this Claude Code session. */
  board: z.string().optional(),
  /** When the hook last spawned a branch lookup for this Claude Code session's main thread. */
  branchCheckedAt: z.number().optional(),
});

/** The skill a Claude Code session's main thread last loaded through the Skill tool. */
const ThreadSkillRecordSchema = z.object({ skill: z.string() });

export type BoardSessionRecord = z.infer<typeof SessionRecordSchema>;
export type InferredSessionRecord = z.infer<typeof InferredRecordSchema>;
type ThreadRecord = z.infer<typeof ThreadRecordSchema>;

export interface BoardSessionStoreProps {
  env?: Record<string, string | undefined>;
  home?: string;
  now?: () => number;
}

const inferredFolder = "inferred";
const threadsFolder = "threads";
const threadSkillsFolder = "thread-skills";

/** Letters, digits, underscores and hyphens only; every other character becomes an underscore. */
const unsafeSessionCharacters = /[^A-Za-z0-9_-]/g;
const maxSessionLength = 80;

/**
 * The board session for a ticket worked inside one Claude Code session:
 * `<session id>-<TICKET>`. Every agent on one ticket in one orchestrator
 * shares a row, and skill posts and hook heartbeats land in the same one.
 * The Claude session part is cut so the whole id fits the API's 80
 * characters; the ticket is never cut.
 */
export class TicketSessionKey {
  key(claudeSession: string, ticket: string): string | undefined {
    const prefix = claudeSession.trim().replace(unsafeSessionCharacters, "_");
    if (prefix === "" || ticket === "") return undefined;
    return `${prefix.slice(0, Math.max(0, maxSessionLength - ticket.length - 1))}-${ticket}`;
  }
}

export const ticketSessionKey = new TicketSessionKey();

/**
 * What the board hooks remember between tool calls, kept outside every
 * repository in `$XDG_STATE_HOME/flight-rules/board` (default
 * `~/.local/state/flight-rules/board`). Holds no token.
 *
 * - `<session>.json`: the last heartbeat a skill posted, so the hook can keep
 *   the session alive without overwriting the step.
 * - `inferred/<session>.json`: the heartbeat the hook inferred for a
 *   sub-agent or a checkout no skill reported, and when it was last sent.
 * - `threads/<claude session>.json`: the board session a skill last posted
 *   to by default from that Claude Code session, and the main thread's
 *   branch-lookup throttle.
 * - `thread-skills/<claude session>.json`: the skill the main thread last
 *   loaded. It is a separate file so a Skill call and a skill's post, which
 *   can land at the same moment from different processes, never undo each other.
 */
export class BoardSessionStore {
  private readonly files: BoardStateFiles;
  private readonly now: () => number;

  constructor(props: BoardSessionStoreProps = {}) {
    this.files = new BoardStateFiles(props);
    this.now = this.files.now;
  }

  dir(): string {
    return this.files.root();
  }

  read(session: string): BoardSessionRecord | undefined {
    return this.files.read(undefined, session, SessionRecordSchema);
  }

  /** Remembers a heartbeat a skill just sent. */
  record(heartbeat: HeartbeatInput): void {
    const now = this.now();
    this.files.write(undefined, heartbeat.session, { heartbeat: this.compact(heartbeat), recordedAt: now, sentAt: now });
  }

  /**
   * The skill heartbeat a skill recorded for the session within `maxAgeMs`,
   * whatever its state; an older record counts as none.
   */
  recent(session: string, maxAgeMs: number): HeartbeatInput | undefined {
    const record = this.read(session);
    return record !== undefined && this.now() - record.recordedAt <= maxAgeMs ? record.heartbeat : undefined;
  }

  /**
   * Remembers a placeholder heartbeat only where no skill has recorded a
   * recent one: a fresh record is never replaced, and a missing file is
   * created atomically, so a skill's own heartbeat landing at the same
   * moment from another process wins. Returns whether it was remembered.
   */
  recordIfAbsent(heartbeat: HeartbeatInput, maxAgeMs: number): boolean {
    if (this.recent(heartbeat.session, maxAgeMs) !== undefined) return false;
    const now = this.now();
    const record = { heartbeat: this.compact(heartbeat), recordedAt: now, sentAt: now };
    if (this.read(heartbeat.session) === undefined) return this.files.create(undefined, heartbeat.session, record);
    this.files.write(undefined, heartbeat.session, record);
    return true;
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
    this.files.write(undefined, session, claimed);
    return claimed;
  }

  /** Whether a skill has posted to this session within `maxAgeMs`, whatever its state. */
  hasSkillRecord(session: string, maxAgeMs: number): boolean {
    const record = this.read(session);
    return record !== undefined && this.now() - record.recordedAt <= maxAgeMs;
  }

  /** Whether a skill record is one the hook keeps alive: not aborted and within `maxAgeMs`. */
  isLive(session: string, maxAgeMs: number): boolean {
    const record = this.read(session);
    return record !== undefined && record.heartbeat.state !== "abort" && this.now() - record.recordedAt <= maxAgeMs;
  }

  readInferred(session: string): InferredSessionRecord | undefined {
    return this.files.read(inferredFolder, session, InferredRecordSchema);
  }

  /**
   * Claims a liveness heartbeat the hook inferred: stores it and returns true,
   * or returns false when one was sent for the session less than `intervalMs` ago.
   */
  claimInferred(heartbeat: HeartbeatInput, intervalMs: number): boolean {
    const now = this.now();
    const previous = this.readInferred(heartbeat.session);
    if (previous !== undefined && now - previous.sentAt < intervalMs) return false;
    this.files.write(inferredFolder, heartbeat.session, { heartbeat: this.compact(heartbeat), sentAt: now });
    return true;
  }

  /** Remembers that a skill posted to `board` by default from this Claude Code session. */
  pointThread(claudeSession: string, board: string): void {
    this.files.write(threadsFolder, claudeSession, { ...this.thread(claudeSession), board });
  }

  /** The board session a skill last posted to by default from this Claude Code session. */
  threadSession(claudeSession: string): string | undefined {
    return this.thread(claudeSession)?.board;
  }

  /** At most one main-thread branch lookup per `intervalMs` per Claude Code session. */
  claimBranchCheck(claudeSession: string, intervalMs: number): boolean {
    const now = this.now();
    const thread = this.thread(claudeSession);
    if (thread?.branchCheckedAt !== undefined && now - thread.branchCheckedAt < intervalMs) return false;
    this.files.write(threadsFolder, claudeSession, { ...thread, branchCheckedAt: now });
    return true;
  }

  /** Remembers the skill this Claude Code session's main thread just loaded. */
  recordThreadSkill(claudeSession: string, skill: string): void {
    if (this.threadSkill(claudeSession) === skill) return;
    this.files.write(threadSkillsFolder, claudeSession, { skill });
  }

  /** The skill this Claude Code session's main thread last loaded, if any. */
  threadSkill(claudeSession: string): string | undefined {
    return this.files.read(threadSkillsFolder, claudeSession, ThreadSkillRecordSchema)?.skill;
  }

  /** Deletes inferred heartbeats and thread records untouched for `maxAgeMs`. */
  prune(maxAgeMs: number): void {
    this.files.prune(inferredFolder, maxAgeMs);
    this.files.prune(threadsFolder, maxAgeMs);
    this.files.prune(threadSkillsFolder, maxAgeMs);
  }

  private thread(claudeSession: string): ThreadRecord | undefined {
    return this.files.read(threadsFolder, claudeSession, ThreadRecordSchema);
  }

  private compact(heartbeat: HeartbeatInput): z.infer<typeof HeartbeatRecordSchema> {
    const { session, step, state } = heartbeat;
    const optional = Object.fromEntries(
      (["ticket", "repo", "branch", "skill", "detail"] as const)
        .map((key) => [key, heartbeat[key]] as const)
        .filter(([, value]) => value !== undefined && value !== ""),
    );
    return { session, step, state, ...optional };
  }
}
