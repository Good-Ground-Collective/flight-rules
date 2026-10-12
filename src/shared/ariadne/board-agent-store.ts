import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BoardStateFiles } from "./board-state-files.js";
import type { BoardStateFilesProps } from "./board-state-files.js";

const DispatchRecordSchema = z.object({
  /** The Jira key the dispatch named, or null when it named none. */
  ticket: z.string().nullable(),
  description: z.string(),
  /** The dispatching Claude Code session. */
  session: z.string(),
  /** A digest of the prompt, so a sub-agent found only through its transcript still finds its dispatch. */
  promptDigest: z.string().optional(),
  at: z.number(),
});

const AgentRecordSchema = z.object({
  /** The Jira key the sub-agent works on, or null once resolved to none. */
  ticket: z.string().nullable(),
  description: z.string().optional(),
  agentType: z.string().optional(),
  toolUseId: z.string().optional(),
  /** The Claude Code session the sub-agent runs in. */
  session: z.string(),
  at: z.number(),
});

/** The skill a sub-agent last loaded through the Skill tool; reported in place of its agent type. */
const AgentSkillRecordSchema = z.object({ skill: z.string() });

export type AgentDispatchRecord = z.infer<typeof DispatchRecordSchema>;
export type AgentTicketRecord = z.infer<typeof AgentRecordSchema>;

const dispatchFolder = "dispatch";
const agentsFolder = "agents";
const agentSkillsFolder = "agent-skills";

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
export class BoardAgentStore {
  private readonly files: BoardStateFiles;

  constructor(props: BoardStateFilesProps = {}) {
    this.files = new BoardStateFiles(props);
  }

  now(): number {
    return this.files.now();
  }

  recordDispatch(toolUseId: string, record: AgentDispatchRecord): void {
    this.files.write(dispatchFolder, toolUseId, record);
  }

  readDispatch(toolUseId: string): AgentDispatchRecord | undefined {
    return this.files.read(dispatchFolder, toolUseId, DispatchRecordSchema);
  }

  /** The dispatch in `session` whose prompt has this digest; reads every dispatch file, so only a fallback uses it. */
  findDispatchByPrompt(session: string, promptDigest: string): AgentDispatchRecord | undefined {
    const dir = join(this.files.root(), dispatchFolder);
    if (!existsSync(dir)) return undefined;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const record = this.readDispatch(name.slice(0, -".json".length));
      if (record?.session === session && record.promptDigest === promptDigest) return record;
    }
    return undefined;
  }

  removeDispatch(toolUseId: string): void {
    this.files.remove(dispatchFolder, toolUseId);
  }

  recordAgent(agentId: string, record: AgentTicketRecord): void {
    this.files.write(agentsFolder, agentId, record);
  }

  readAgent(agentId: string): AgentTicketRecord | undefined {
    return this.files.read(agentsFolder, agentId, AgentRecordSchema);
  }

  removeAgent(agentId: string): void {
    this.files.remove(agentsFolder, agentId);
    this.files.remove(agentSkillsFolder, agentId);
  }

  /** Remembers the skill a sub-agent just loaded; rewrites nothing when it is unchanged. */
  recordAgentSkill(agentId: string, skill: string): void {
    if (this.readAgentSkill(agentId) === skill) return;
    this.files.write(agentSkillsFolder, agentId, { skill });
  }

  readAgentSkill(agentId: string): string | undefined {
    return this.files.read(agentSkillsFolder, agentId, AgentSkillRecordSchema)?.skill;
  }

  /** Deletes dispatch and sub-agent records untouched for `maxAgeMs`. */
  prune(maxAgeMs: number): void {
    this.files.prune(dispatchFolder, maxAgeMs);
    this.files.prune(agentsFolder, maxAgeMs);
    this.files.prune(agentSkillsFolder, maxAgeMs);
  }
}
