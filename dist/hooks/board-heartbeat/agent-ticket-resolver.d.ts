import type { AgentTicketRecord, BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";
/** Where a sub-agent's files are, from whichever paths the hook input carries. */
export interface SubagentLocation {
    agentId: string;
    /** The Claude Code session the sub-agent runs in. */
    session: string;
    /** The session transcript; sub-agent files sit in `<transcript without .jsonl>/subagents/`. */
    transcriptPath?: string | undefined;
    /** The sub-agent's own transcript, which SubagentStop carries. */
    agentTranscriptPath?: string | undefined;
    agentType?: string | undefined;
}
export interface AgentTicketResolverProps {
    agents: BoardAgentStore;
    extractor?: TicketKeyExtractor;
}
/**
 * Works out, once per sub-agent, which Jira ticket it is working on. The
 * sub-agent's `meta.json` names the Agent call that started it, and the
 * dispatch hook recorded that call's ticket. Without a dispatch record the
 * meta description is read for a key, and without `meta.json` the first user
 * message of the sub-agent's transcript is. The answer, "no ticket"
 * included, is cached, so later tool calls cost one small file read.
 */
export declare class AgentTicketResolver {
    private readonly agents;
    private readonly extractor;
    constructor(props: AgentTicketResolverProps);
    /** The cached or freshly resolved record, or undefined while Claude Code has written nothing to read yet. */
    resolve(location: SubagentLocation): AgentTicketRecord | undefined;
    /**
     * A background Agent call returns the sub-agent's id at once, so its
     * PostToolUse can map the sub-agent to its dispatch before the sub-agent's
     * first tool call. A sub-agent that is already mapped is left alone.
     */
    bridge(agentId: string, toolUseId: string, session: string): void;
    /** A stable digest of a prompt, recorded at dispatch and matched against a transcript's first message. */
    digest(prompt: string): string;
    private fromMeta;
    private fromTranscript;
    private agentType;
    private subagentsDir;
    private readMeta;
    private firstUserMessage;
    private userText;
}
