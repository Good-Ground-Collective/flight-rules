import { spawn } from "node:child_process";
import { z } from "zod";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";

/** At most one liveness heartbeat a minute per session. */
export const heartbeatIntervalMs = 60_000;

/**
 * A skill heartbeat older than this is not kept alive: the run has gone quiet
 * long enough that Ariadne should show it stale (it does after 15 minutes).
 */
export const heartbeatMaxAgeMs = 60 * 60_000;

const PostToolUseInputSchema = z.looseObject({ session_id: z.string() });

export interface BoardHeartbeatHookProps {
  sessions: BoardSessionStore;
}

/**
 * The plugin's PostToolUse handler for Ariadne. A skill's `board post
 * heartbeat` records the session's ticket and step; on any later tool call
 * this decides whether that session is due a liveness heartbeat. No record
 * (nothing configured, no ticket in progress, a GitHub-tracked run) means
 * nothing to do.
 */
export class BoardHeartbeatHook {
  private readonly sessions: BoardSessionStore;

  constructor(props: BoardHeartbeatHookProps) {
    this.sessions = props.sessions;
  }

  /** The session to send a heartbeat for now, already claimed, or undefined. */
  due(payload: unknown): string | undefined {
    const parsed = PostToolUseInputSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    const claimed = this.sessions.claim(parsed.data.session_id, heartbeatIntervalMs, heartbeatMaxAgeMs);
    return claimed?.heartbeat.session;
  }
}

/**
 * Sends the heartbeat from a detached child process, so the tool call that
 * fired the hook never waits on the network (up to two 5-second attempts).
 */
export interface DetachedHeartbeatSenderProps {
  /** The node binary; defaults to this process's. */
  execPath?: string;
  /** The CLI bundle to re-run; defaults to this process's entry script. */
  entry?: string | undefined;
}

export class DetachedHeartbeatSender {
  private readonly execPath: string;
  private readonly entry: string | undefined;

  constructor(props: DetachedHeartbeatSenderProps = {}) {
    this.execPath = props.execPath ?? process.execPath;
    this.entry = "entry" in props ? props.entry : process.argv[1];
  }

  send(session: string): void {
    if (this.entry === undefined) return;
    const child = spawn(this.execPath, [this.entry, "hook", "board-heartbeat", "--send", session], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
  }
}
