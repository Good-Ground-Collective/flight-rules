import { z } from "zod";
import type { BoardStateFilesProps } from "./board-state-files.js";
declare const DispatchRecordSchema: z.ZodObject<{
    ticket: z.ZodNullable<z.ZodString>;
    description: z.ZodString;
    session: z.ZodString;
    promptDigest: z.ZodOptional<z.ZodString>;
    at: z.ZodNumber;
}, z.core.$strip>;
declare const AgentRecordSchema: z.ZodObject<{
    ticket: z.ZodNullable<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    agentType: z.ZodOptional<z.ZodString>;
    toolUseId: z.ZodOptional<z.ZodString>;
    session: z.ZodString;
    at: z.ZodNumber;
}, z.core.$strip>;
export type AgentDispatchRecord = z.infer<typeof DispatchRecordSchema>;
export type AgentTicketRecord = z.infer<typeof AgentRecordSchema>;
/**
 * Which Jira ticket each sub-agent works on, kept beside the board session
 * records: `dispatch/<tool_use_id>.json` is written when an Agent call is
 * made, and `agents/<agent_id>.json` caches what each sub-agent resolved to,
 * including "no ticket", so it is worked out once per sub-agent.
 * `agent-skills/<agent_id>.json` holds the skill it loaded. It is a separate
 * file because the parent's background-launch hook and the sub-agent's own
 * hooks write the mapping from different processes, and neither may undo the
 * other's skill.
 */
export declare class BoardAgentStore {
    private readonly files;
    constructor(props?: BoardStateFilesProps);
    now(): number;
    recordDispatch(toolUseId: string, record: AgentDispatchRecord): void;
    readDispatch(toolUseId: string): AgentDispatchRecord | undefined;
    /** The dispatch in `session` whose prompt has this digest; reads every dispatch file, so only a fallback uses it. */
    findDispatchByPrompt(session: string, promptDigest: string): AgentDispatchRecord | undefined;
    removeDispatch(toolUseId: string): void;
    recordAgent(agentId: string, record: AgentTicketRecord): void;
    readAgent(agentId: string): AgentTicketRecord | undefined;
    removeAgent(agentId: string): void;
    /** Remembers the skill a sub-agent just loaded; rewrites nothing when it is unchanged. */
    recordAgentSkill(agentId: string, skill: string): void;
    readAgentSkill(agentId: string): string | undefined;
    /** Deletes dispatch and sub-agent records untouched for `maxAgeMs`. */
    prune(maxAgeMs: number): void;
}
export {};
