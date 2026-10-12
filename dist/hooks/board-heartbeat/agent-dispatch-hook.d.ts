import type { BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";
import type { AgentTicketResolver } from "./agent-ticket-resolver.js";
/** Dispatch records, sub-agent mappings and inferred heartbeats are dropped after a day. */
export declare const boardStateMaxAgeMs: number;
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
export declare class AgentDispatchHook {
    private readonly agents;
    private readonly sessions;
    private readonly resolver;
    private readonly extractor;
    constructor(props: AgentDispatchHookProps);
    record(payload: unknown): void;
}
