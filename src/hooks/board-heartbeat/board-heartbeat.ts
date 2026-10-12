import { spawn } from "node:child_process";
import { basename } from "node:path";
import { z } from "zod";
import { HeartbeatInputSchema } from "../../shared/ariadne/ariadne.schema.js";
import type { HeartbeatInput } from "../../shared/ariadne/ariadne.schema.js";
import type { BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import { ticketSessionKey } from "../../shared/ariadne/board-session-store.js";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";
import { boardStateMaxAgeMs } from "./agent-dispatch-hook.js";
import type { AgentTicketResolver } from "./agent-ticket-resolver.js";

/** At most one liveness heartbeat a minute per session. */
export const heartbeatIntervalMs = 60_000;

/**
 * A skill heartbeat older than this is not kept alive: the run has gone quiet
 * long enough that Ariadne should show it stale (it does after 15 minutes).
 */
export const heartbeatMaxAgeMs = 60 * 60_000;

/** The step of a main thread that no skill reports, found on a ticket by its checkout. */
export const checkoutStep = "working";

/** The step of a sub-agent whose dispatch had no description. */
const subagentStep = "sub-agent";

const PostToolUseInputSchema = z.looseObject({
  session_id: z.string(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_response: z.unknown().optional(),
});

/** A Skill tool call names the skill it loads, such as `flight-rules:execute-work`. */
const SkillCallSchema = z.looseObject({ skill: z.string() });

/** A background Agent call answers at once with the sub-agent's id. */
const AsyncLaunchSchema = z.looseObject({ status: z.literal("async_launched"), agentId: z.string() });

const SubagentStopInputSchema = z.looseObject({
  session_id: z.string(),
  agent_id: z.string(),
  agent_type: z.string().optional(),
  transcript_path: z.string().optional(),
  agent_transcript_path: z.string().optional(),
});

const SkillNameSchema = HeartbeatInputSchema.shape.skill;
const StepSchema = HeartbeatInputSchema.shape.step;

/**
 * What the hook hands the detached child, if anything: `send` re-sends the
 * session's skill heartbeat or the one the hook inferred; `branch` reads the
 * main thread's branch for a ticket, then heartbeats it.
 */
export type HeartbeatDue = { kind: "send"; session: string } | { kind: "branch"; claudeSession: string; cwd: string };

/** One activity line for a sub-agent that finished. */
export interface FinishedReport {
  session: string;
  ticket: string;
  text: string;
  id: string;
}

export interface BoardHeartbeatHookProps {
  sessions: BoardSessionStore;
  /** Without it, sub-agents are never mapped to tickets and only skill sessions are kept alive. */
  agents?: BoardAgentStore;
  resolver?: AgentTicketResolver;
  extractor?: TicketKeyExtractor;
  /**
   * Whether Ariadne is enabled with a token. Checked before spawning a child
   * for anything a skill did not record, so an unconfigured machine never
   * starts one. Defaults to true.
   */
  reportable?: () => boolean;
}

/**
 * The plugin's PostToolUse and SubagentStop handler for Ariadne. On each
 * tool call it decides whether a board session is due a liveness heartbeat:
 *
 * - In a sub-agent mapped to a Jira ticket, the session is
 *   `<session id>-<TICKET>`. A skill's heartbeat for it is replayed; without
 *   one the hook infers a heartbeat whose step is the dispatch description.
 * - Otherwise a skill's heartbeat for the Claude Code session is replayed.
 * - On the main thread with no skill heartbeat, a Jira key in the working
 *   directory's name, or else the branch (read by the detached child), names
 *   the ticket.
 *
 * A skill's step is never overwritten by an inferred one, and each board
 * session gets at most one heartbeat a minute.
 */
export class BoardHeartbeatHook {
  private readonly sessions: BoardSessionStore;
  private readonly agents: BoardAgentStore | undefined;
  private readonly resolver: AgentTicketResolver | undefined;
  private readonly extractor: TicketKeyExtractor;
  private readonly reportable: () => boolean;

  constructor(props: BoardHeartbeatHookProps) {
    this.sessions = props.sessions;
    this.agents = props.agents;
    this.resolver = props.resolver;
    this.extractor = props.extractor ?? new TicketKeyExtractor();
    this.reportable = props.reportable ?? (() => true);
  }

  /** The heartbeat to send now, already claimed, or undefined. */
  due(payload: unknown): HeartbeatDue | undefined {
    const parsed = PostToolUseInputSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    const input = parsed.data;
    const claudeSession = input.session_id;
    this.bridgeBackgroundLaunch(input);
    const invoked = this.invokedSkill(input);

    if (input.agent_id !== undefined) {
      if (invoked !== undefined) this.agents?.recordAgentSkill(input.agent_id, invoked);
      const mapping = this.resolver?.resolve({
        agentId: input.agent_id,
        session: claudeSession,
        transcriptPath: input.transcript_path,
        agentType: input.agent_type,
      });
      if (mapping !== undefined && mapping.ticket !== null) {
        const ticket = mapping.ticket;
        // A sub-agent mapped from its background launch has no agent type yet; its own tool calls carry one.
        const skill = this.agents?.readAgentSkill(input.agent_id) ?? mapping.agentType ?? input.agent_type;
        return this.dueForTicket(claudeSession, ticket, (session) =>
          this.subagentHeartbeat(session, ticket, mapping.description, skill),
        );
      }
    } else if (invoked !== undefined) {
      this.sessions.recordThreadSkill(claudeSession, invoked);
    }

    const skill = this.skillThread(claudeSession);
    if (skill !== undefined) return this.send(this.sessions.claim(skill, heartbeatIntervalMs, heartbeatMaxAgeMs)?.heartbeat.session);
    if (input.agent_id !== undefined || input.cwd === undefined) return undefined;

    const fromCheckout = this.extractor.firstKey(basename(input.cwd));
    if (fromCheckout !== undefined) {
      return this.dueForTicket(claudeSession, fromCheckout, (session) => this.checkoutHeartbeat(claudeSession, session, fromCheckout));
    }
    if (!this.sessions.claimBranchCheck(claudeSession, heartbeatIntervalMs) || !this.reportable()) return undefined;
    return { kind: "branch", claudeSession, cwd: input.cwd };
  }

  /**
   * Run by the detached child for a main thread: `branch` is what git
   * printed. Returns the session to replay, already claimed, or undefined.
   */
  dueForBranch(claudeSession: string, branch: string): string | undefined {
    const ticket = this.extractor.firstKey(branch);
    if (ticket === undefined) return undefined;
    const due = this.dueForTicket(claudeSession, ticket, (session) => this.checkoutHeartbeat(claudeSession, session, ticket, branch));
    return due?.kind === "send" ? due.session : undefined;
  }

  /**
   * A sub-agent stopped: forgets it, and returns the activity line to post
   * when it was working on a Jira ticket and Ariadne is configured.
   */
  stopped(payload: unknown): FinishedReport | undefined {
    const parsed = SubagentStopInputSchema.safeParse(payload);
    if (!parsed.success || this.agents === undefined) return undefined;
    const input = parsed.data;
    const mapping = this.resolver?.resolve({
      agentId: input.agent_id,
      session: input.session_id,
      transcriptPath: input.transcript_path,
      agentTranscriptPath: input.agent_transcript_path,
      agentType: input.agent_type,
    });
    this.agents.removeAgent(input.agent_id);
    if (mapping?.toolUseId !== undefined) this.agents.removeDispatch(mapping.toolUseId);
    if (mapping === undefined || mapping.ticket === null) return undefined;
    const session = ticketSessionKey.key(input.session_id, mapping.ticket);
    if (session === undefined || !this.reportable()) return undefined;
    const what =
      mapping.description !== undefined && mapping.description !== ""
        ? mapping.description
        : (mapping.agentType ?? input.agent_type ?? subagentStep);
    return { session, ticket: mapping.ticket, text: `Finished: ${what}`, id: `finished-${input.agent_id}` };
  }

  /**
   * A skill's heartbeat replayed if a skill posted to the ticket's session
   * within a day (only while it is live), else a heartbeat the hook infers.
   */
  private dueForTicket(claudeSession: string, ticket: string, infer: (session: string) => HeartbeatInput): HeartbeatDue | undefined {
    const session = ticketSessionKey.key(claudeSession, ticket);
    if (session === undefined) return undefined;
    if (this.sessions.hasSkillRecord(session, boardStateMaxAgeMs)) {
      return this.send(this.sessions.claim(session, heartbeatIntervalMs, heartbeatMaxAgeMs)?.heartbeat.session);
    }
    if (!this.sessions.claimInferred(infer(session), heartbeatIntervalMs) || !this.reportable()) return undefined;
    return { kind: "send", session };
  }

  /**
   * The live skill session for this Claude Code session: one recorded under
   * the session id itself (an explicit `--session`, or an older CLI), else
   * the one a skill last posted to by default from it.
   */
  private skillThread(claudeSession: string): string | undefined {
    if (this.sessions.isLive(claudeSession, heartbeatMaxAgeMs)) return claudeSession;
    const pointed = this.sessions.threadSession(claudeSession);
    return pointed !== undefined && this.sessions.isLive(pointed, heartbeatMaxAgeMs) ? pointed : undefined;
  }

  /** The skill a Skill tool call just loaded, when it is a name Ariadne accepts. */
  private invokedSkill(input: z.infer<typeof PostToolUseInputSchema>): string | undefined {
    if (input.tool_name !== "Skill") return undefined;
    const call = SkillCallSchema.safeParse(input.tool_input);
    if (!call.success) return undefined;
    const skill = SkillNameSchema.safeParse(call.data.skill);
    return skill.success ? skill.data : undefined;
  }

  private bridgeBackgroundLaunch(input: z.infer<typeof PostToolUseInputSchema>): void {
    if (input.tool_name !== "Agent" || input.tool_use_id === undefined) return;
    const launch = AsyncLaunchSchema.safeParse(input.tool_response);
    if (launch.success) this.resolver?.bridge(launch.data.agentId, input.tool_use_id, input.session_id);
  }

  private subagentHeartbeat(session: string, ticket: string, description: string | undefined, skillName: string | undefined): HeartbeatInput {
    const step = StepSchema.safeParse(description ?? "");
    const skill = SkillNameSchema.safeParse(skillName);
    return {
      session,
      ticket,
      step: step.success ? step.data : subagentStep,
      state: "nominal",
      ...(skill.success && skill.data !== undefined ? { skill: skill.data } : {}),
    };
  }

  /** A main thread's heartbeat names the skill it last loaded, when it loaded one. */
  private checkoutHeartbeat(claudeSession: string, session: string, ticket: string, branch?: string): HeartbeatInput {
    const skill = this.sessions.threadSkill(claudeSession);
    return {
      session,
      ticket,
      step: checkoutStep,
      state: "nominal",
      ...(branch !== undefined ? { branch } : {}),
      ...(skill !== undefined ? { skill } : {}),
    };
  }

  private send(session: string | undefined): HeartbeatDue | undefined {
    return session === undefined ? undefined : { kind: "send", session };
  }
}

/**
 * Sends heartbeats and activity lines from a detached child process, so the
 * tool call that fired the hook never waits on the network (up to two
 * 5-second attempts).
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
    this.spawnHook(["board-heartbeat", "--send", session]);
  }

  sendBranch(claudeSession: string, cwd: string): void {
    this.spawnHook(["board-heartbeat", "--branch", claudeSession, "--cwd", cwd]);
  }

  sendFinished(report: FinishedReport): void {
    this.spawnHook(["agent-stop", "--send", report.session, "--ticket", report.ticket, "--text", report.text, "--id", report.id]);
  }

  private spawnHook(args: string[]): void {
    if (this.entry === undefined) return;
    const child = spawn(this.execPath, [this.entry, "hook", ...args], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  }
}
