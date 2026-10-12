import { z } from "zod";
import type { BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";
import type { AgentTicketResolver } from "./agent-ticket-resolver.js";

/** Dispatch records, sub-agent mappings and inferred heartbeats are dropped after a day. */
export const boardStateMaxAgeMs = 24 * 60 * 60_000;

/** A dispatch description is kept only as long as a heartbeat step or activity line can use it. */
const maxDescriptionLength = 200;

const AgentDispatchInputSchema = z.looseObject({
  session_id: z.string(),
  tool_use_id: z.string(),
  tool_input: z.looseObject({
    description: z.string().optional(),
    prompt: z.string().optional(),
  }),
  /** Present when a sub-agent dispatches its own sub-agent. */
  agent_id: z.string().optional(),
});

export interface AgentDispatchHookProps {
  agents: BoardAgentStore;
  sessions: BoardSessionStore;
  resolver: AgentTicketResolver;
  extractor?: TicketKeyExtractor;
}

/**
 * The plugin's PreToolUse(Agent) handler for Ariadne. It records which Jira
 * ticket each Agent call names, keyed by the call's `tool_use_id`, so the
 * heartbeat hook can tell which ticket a sub-agent is working on. Local only:
 * no network, no output, and the Agent call is never blocked or changed.
 */
export class AgentDispatchHook {
  private readonly agents: BoardAgentStore;
  private readonly sessions: BoardSessionStore;
  private readonly resolver: AgentTicketResolver;
  private readonly extractor: TicketKeyExtractor;

  constructor(props: AgentDispatchHookProps) {
    this.agents = props.agents;
    this.sessions = props.sessions;
    this.resolver = props.resolver;
    this.extractor = props.extractor ?? new TicketKeyExtractor();
  }

  record(payload: unknown): void {
    const parsed = AgentDispatchInputSchema.safeParse(payload);
    if (!parsed.success) return;
    const { session_id: session, tool_use_id: toolUseId, tool_input: input, agent_id: parentAgent } = parsed.data;
    const description = (input.description ?? "").trim().slice(0, maxDescriptionLength);
    // A sub-agent's own sub-agents work on its ticket unless they name another.
    const ticket =
      this.extractor.fromDispatch(input.description, input.prompt) ??
      (parentAgent !== undefined ? this.agents.readAgent(parentAgent)?.ticket : undefined) ??
      null;
    this.agents.recordDispatch(toolUseId, {
      ticket,
      description,
      session,
      ...(input.prompt !== undefined ? { promptDigest: this.resolver.digest(input.prompt) } : {}),
      at: this.agents.now(),
    });
    this.agents.prune(boardStateMaxAgeMs);
    this.sessions.prune(boardStateMaxAgeMs);
  }
}
