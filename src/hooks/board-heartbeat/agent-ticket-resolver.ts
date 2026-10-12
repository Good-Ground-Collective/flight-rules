import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { AgentTicketRecord, BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import { stateIdPattern } from "../../shared/ariadne/board-state-files.js";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";

/** Claude Code's sidecar for a sub-agent; its layout is undocumented, so every field is optional. */
const SubagentMetaSchema = z.looseObject({
  agentType: z.string().optional(),
  description: z.string().optional(),
  toolUseId: z.string().optional(),
});

const TranscriptLineSchema = z.looseObject({
  type: z.string().optional(),
  message: z
    .looseObject({
      role: z.string().optional(),
      content: z.union([z.string(), z.array(z.looseObject({ type: z.string().optional(), text: z.string().optional() }))]),
    })
    .optional(),
});

/** Enough of a transcript to hold its first user message; the read never grows with the transcript. */
const transcriptHeadBytes = 256 * 1024;

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
export class AgentTicketResolver {
  private readonly agents: BoardAgentStore;
  private readonly extractor: TicketKeyExtractor;

  constructor(props: AgentTicketResolverProps) {
    this.agents = props.agents;
    this.extractor = props.extractor ?? new TicketKeyExtractor();
  }

  /** The cached or freshly resolved record, or undefined while Claude Code has written nothing to read yet. */
  resolve(location: SubagentLocation): AgentTicketRecord | undefined {
    if (!stateIdPattern.test(location.agentId)) return undefined;
    const cached = this.agents.readAgent(location.agentId);
    if (cached !== undefined) return cached;
    const dir = this.subagentsDir(location);
    if (dir === undefined) return undefined;

    const meta = this.readMeta(join(dir, `agent-${location.agentId}.meta.json`));
    const resolved =
      meta !== undefined ? this.fromMeta(location, meta) : this.fromTranscript(location, join(dir, `agent-${location.agentId}.jsonl`));
    if (resolved !== undefined) this.agents.recordAgent(location.agentId, resolved);
    return resolved;
  }

  /**
   * A background Agent call returns the sub-agent's id at once, so its
   * PostToolUse can map the sub-agent to its dispatch before the sub-agent's
   * first tool call. A sub-agent that is already mapped is left alone.
   */
  bridge(agentId: string, toolUseId: string, session: string): void {
    if (!stateIdPattern.test(agentId) || this.agents.readAgent(agentId) !== undefined) return;
    const dispatch = this.agents.readDispatch(toolUseId);
    if (dispatch === undefined) return;
    this.agents.recordAgent(agentId, {
      ticket: dispatch.ticket,
      description: dispatch.description,
      toolUseId,
      session,
      at: this.agents.now(),
    });
  }

  /** A stable digest of a prompt, recorded at dispatch and matched against a transcript's first message. */
  digest(prompt: string): string {
    return createHash("sha256").update(prompt.trim()).digest("hex").slice(0, 32);
  }

  private fromMeta(location: SubagentLocation, meta: z.infer<typeof SubagentMetaSchema>): AgentTicketRecord {
    const dispatch = meta.toolUseId !== undefined ? this.agents.readDispatch(meta.toolUseId) : undefined;
    const description = dispatch?.description ?? meta.description;
    return {
      ticket: dispatch !== undefined ? dispatch.ticket : (this.extractor.firstKey(meta.description) ?? null),
      ...(description !== undefined ? { description } : {}),
      ...this.agentType(meta.agentType ?? location.agentType),
      ...(meta.toolUseId !== undefined ? { toolUseId: meta.toolUseId } : {}),
      session: location.session,
      at: this.agents.now(),
    };
  }

  private fromTranscript(location: SubagentLocation, path: string): AgentTicketRecord | undefined {
    const prompt = this.firstUserMessage(path);
    if (prompt === undefined) return undefined;
    const dispatch = this.agents.findDispatchByPrompt(location.session, this.digest(prompt));
    return {
      ticket: dispatch !== undefined ? dispatch.ticket : (this.extractor.fromPrompt(prompt) ?? null),
      ...(dispatch !== undefined ? { description: dispatch.description } : {}),
      ...this.agentType(location.agentType),
      session: location.session,
      at: this.agents.now(),
    };
  }

  private agentType(value: string | undefined): { agentType?: string } {
    return value !== undefined && value !== "" ? { agentType: value } : {};
  }

  private subagentsDir(location: SubagentLocation): string | undefined {
    if (location.agentTranscriptPath !== undefined && location.agentTranscriptPath !== "") {
      return dirname(location.agentTranscriptPath);
    }
    const transcript = location.transcriptPath;
    if (transcript === undefined || !transcript.endsWith(".jsonl")) return undefined;
    return join(dirname(transcript), basename(transcript, ".jsonl"), "subagents");
  }

  private readMeta(path: string): z.infer<typeof SubagentMetaSchema> | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const parsed = SubagentMetaSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private firstUserMessage(path: string): string | undefined {
    if (!existsSync(path)) return undefined;
    let head: string;
    try {
      const fd = openSync(path, "r");
      try {
        const buffer = Buffer.alloc(transcriptHeadBytes);
        head = buffer.subarray(0, readSync(fd, buffer, 0, transcriptHeadBytes, 0)).toString("utf-8");
      } finally {
        closeSync(fd);
      }
    } catch {
      return undefined;
    }
    for (const line of head.split("\n")) {
      const text = this.userText(line);
      if (text !== undefined) return text;
    }
    return undefined;
  }

  private userText(line: string): string | undefined {
    let parsed: z.infer<typeof TranscriptLineSchema>;
    try {
      const result = TranscriptLineSchema.safeParse(JSON.parse(line));
      if (!result.success) return undefined;
      parsed = result.data;
    } catch {
      return undefined;
    }
    if (parsed.type !== "user" || parsed.message === undefined) return undefined;
    const content = parsed.message.content;
    if (typeof content === "string") return content;
    const text = content
      .filter((part) => part.type === "text" && part.text !== undefined)
      .map((part) => part.text)
      .join("\n");
    return text === "" ? undefined : text;
  }
}
