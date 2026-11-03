import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";

export const SubagentHarnessSchema = z.enum(["claude-code", "codex"]);
export type SubagentHarness = z.infer<typeof SubagentHarnessSchema>;

export const SubagentStatusSchema = z.enum(["working", "done", "error"]);
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;

export const SubagentStatusRecordSchema = z.looseObject({
  v: z.literal(1),
  harness: SubagentHarnessSchema,
  hc_terminal: z.string().nullable(),
  session_id: z.string(),
  agent_id: z.string(),
  agent_type: z.string(),
  description: z.string(),
  ticket: z.string().nullable(),
  status: SubagentStatusSchema,
  cwd: z.string(),
  started_at: z.string(),
  updated_at: z.string(),
  ended_at: z.string().nullable(),
});
export type SubagentStatusRecord = z.infer<typeof SubagentStatusRecordSchema>;

/** Finished records, and working records nothing has refreshed, are deleted after a day. */
export const subagentStatusMaxAgeMs = 24 * 60 * 60_000;

/** A tool call refreshes `updated_at` at most this often, so busy sub-agents don't rewrite their file on every call. */
export const subagentTouchIntervalMs = 30_000;

const maxDescriptionLength = 120;
const transcriptHeadBytes = 64 * 1024;
const failedTaskStatuses: ReadonlySet<string> = new Set(["failed", "error", "errored"]);

const HookPayloadSchema = z.looseObject({
  hook_event_name: z.string().optional(),
  session_id: z.string().min(1),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  cwd: z.string().optional(),
  transcript_path: z.string().nullable().optional(),
  agent_transcript_path: z.string().nullable().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  status: z.string().optional(),
  error: z.unknown().optional(),
  background_tasks: z.array(z.looseObject({ id: z.string().optional(), status: z.string().optional(), description: z.string().optional() })).optional(),
});
type HookPayload = z.infer<typeof HookPayloadSchema>;

const ClaudeSubagentMetaSchema = z.looseObject({ agentType: z.string().optional(), description: z.string().optional() });

const TranscriptLineSchema = z.looseObject({
  type: z.string().optional(),
  message: z.looseObject({ role: z.string().optional(), content: z.unknown() }).optional(),
});

export interface SubagentStatusRecorderProps {
  env?: Record<string, string | undefined>;
  home?: string;
  now?: () => number;
  extractor?: TicketKeyExtractor;
  readBranch?: (cwd: string) => string | undefined;
}

/** Ids become one file name each, limited to `[A-Za-z0-9._-]`. */
export const SubagentFileNameSchema = z.string().transform((value) => value.replaceAll(/[^A-Za-z0-9._-]/g, "_"));

/**
 * Keeps one JSON file per sub-agent run under
 * `$XDG_STATE_HOME/flight-rules/agents/` (default
 * `~/.local/state/flight-rules/agents/`), so a terminal multiplexer can nest
 * in-process sub-agents under the terminal that runs them. Each hook event
 * from Claude Code or Codex maps to one transition; every write is atomic and
 * every call prunes stale records. Nothing here throws to the caller.
 */
export class SubagentStatusRecorder {
  private readonly env: Record<string, string | undefined>;
  private readonly home: string;
  private readonly now: () => number;
  private readonly extractor: TicketKeyExtractor;
  private readonly readBranch: (cwd: string) => string | undefined;

  constructor(props: SubagentStatusRecorderProps = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
    this.now = props.now ?? Date.now;
    this.extractor = props.extractor ?? new TicketKeyExtractor();
    this.readBranch = props.readBranch ?? ((cwd) => new GitHeadReader().branch(cwd));
  }

  folder(): string {
    const stateHome = this.env["XDG_STATE_HOME"];
    const base = stateHome !== undefined && stateHome !== "" ? stateHome : join(this.home, ".local", "state");
    return join(base, "flight-rules", "agents");
  }

  /** Routes a hook payload by its `hook_event_name`. */
  handle(harness: SubagentHarness, payload: unknown): void {
    const parsed = HookPayloadSchema.safeParse(payload);
    if (parsed.success) {
      const input = parsed.data;
      switch (input.hook_event_name) {
        case "SubagentStart":
          this.start(harness, input);
          break;
        case "SubagentStop":
          this.stop(harness, input, this.failed(input) ? "error" : "done");
          break;
        case "StopFailure":
          this.stop(harness, input, "error");
          break;
        case "PostToolUse":
        case "PostToolUseFailure":
          this.touch(harness, input);
          break;
        case "SessionEnd":
          this.endSession(harness, input.session_id);
          break;
      }
    }
    this.prune();
  }

  read(harness: SubagentHarness, session: string, agent: string): SubagentStatusRecord | undefined {
    return this.readPath(this.pathFor(harness, session, agent));
  }

  list(): SubagentStatusRecord[] {
    const records: SubagentStatusRecord[] = [];
    for (const name of this.entries()) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const record = this.readPath(join(this.folder(), name));
      if (record !== undefined) records.push(record);
    }
    return records;
  }

  prune(): void {
    const cutoff = this.now() - subagentStatusMaxAgeMs;
    for (const name of this.entries()) {
      const path = join(this.folder(), name);
      try {
        const record = name.endsWith(".json") && !name.startsWith(".") ? this.readPath(path) : undefined;
        const last = record === undefined ? statSync(path).mtimeMs : Date.parse(record.ended_at ?? record.updated_at);
        if (!Number.isFinite(last) || last < cutoff) rmSync(path, { force: true });
      } catch {
        continue;
      }
    }
  }

  private start(harness: SubagentHarness, input: HookPayload): void {
    if (input.agent_id === undefined) return;
    const path = this.pathFor(harness, input.session_id, input.agent_id);
    const existing = this.readPath(path);
    const at = this.timestamp();
    const base = existing ?? this.fresh(harness, input, input.agent_id, at);
    this.write(path, this.enrich({ ...base, status: "working", updated_at: at, ended_at: null }, input));
  }

  private stop(harness: SubagentHarness, input: HookPayload, status: SubagentStatus): void {
    if (input.agent_id === undefined) return;
    const path = this.pathFor(harness, input.session_id, input.agent_id);
    const existing = this.readPath(path);
    if (existing !== undefined && existing.status === "error") return;
    const at = this.timestamp();
    const base = existing ?? this.fresh(harness, input, input.agent_id, at);
    this.write(path, this.enrich({ ...base, status, updated_at: at, ended_at: at }, input));
  }

  private touch(harness: SubagentHarness, input: HookPayload): void {
    if (input.agent_id === undefined) return;
    const path = this.pathFor(harness, input.session_id, input.agent_id);
    const existing = this.readPath(path);
    if (existing !== undefined && existing.status !== "working") return;
    const recent = existing !== undefined && this.now() - Date.parse(existing.updated_at) < subagentTouchIntervalMs;
    if (recent && existing.description !== "" && existing.ticket !== null) return;
    const at = this.timestamp();
    const next = this.enrich({ ...(existing ?? this.fresh(harness, input, input.agent_id, at)), updated_at: at }, input);
    // Inside the interval a call writes only to add a description or ticket the start couldn't read yet.
    if (recent && next.description === existing.description && next.ticket === existing.ticket) return;
    // A stop may have landed while this call was reading; never resurrect a finished record.
    const latest = this.readPath(path);
    if (latest !== undefined && latest.status !== "working") return;
    this.write(path, next);
  }

  private endSession(harness: SubagentHarness, session: string): void {
    const at = this.timestamp();
    for (const name of this.entries()) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const path = join(this.folder(), name);
      const record = this.readPath(path);
      if (record === undefined || record.harness !== harness || record.session_id !== session || record.status !== "working") continue;
      this.write(path, { ...record, status: "done", updated_at: at, ended_at: at });
    }
  }

  private fresh(harness: SubagentHarness, input: HookPayload, agent: string, at: string): SubagentStatusRecord {
    const terminal = this.env["HC_TERMINAL_ID"];
    return {
      v: 1,
      harness,
      hc_terminal: terminal !== undefined && terminal !== "" ? terminal : null,
      session_id: input.session_id,
      agent_id: agent,
      agent_type: input.agent_type !== undefined && input.agent_type !== "" ? input.agent_type : "subagent",
      description: "",
      ticket: null,
      status: "working",
      cwd: input.cwd !== undefined && isAbsolute(input.cwd) ? input.cwd : process.cwd(),
      started_at: at,
      updated_at: at,
      ended_at: null,
    };
  }

  /**
   * Fills the description and ticket once the harness has written something
   * to read them from. A key in the description or prompt wins over one in
   * the branch, so a branch ticket found before the description is replaced.
   */
  private enrich(record: SubagentStatusRecord, input: HookPayload): SubagentStatusRecord {
    const next = { ...record };
    if (next.agent_type === "subagent" && input.agent_type !== undefined && input.agent_type !== "") next.agent_type = input.agent_type;
    if (next.description !== "" && next.ticket !== null) return next;
    const meta = this.claudeMeta(input, record.agent_id);
    if (next.agent_type === "subagent" && meta?.agentType !== undefined) next.agent_type = meta.agentType;
    if (next.description === "") {
      next.description = this.clip(
        input.description ?? meta?.description ?? input.background_tasks?.find((task) => task.id === record.agent_id)?.description ?? "",
      );
    }
    const fromText = this.extractor.fromDispatch(next.description, input.prompt ?? this.firstPrompt(input, record.agent_id));
    next.ticket = fromText ?? next.ticket ?? this.extractor.firstKey(this.readBranch(next.cwd)) ?? null;
    return next;
  }

  private failed(input: HookPayload): boolean {
    if (input.status !== undefined && failedTaskStatuses.has(input.status.toLowerCase())) return true;
    if (input.error !== undefined && input.error !== null && input.error !== false && input.error !== "") return true;
    const task = input.background_tasks?.find((entry) => entry.id === input.agent_id);
    return task?.status !== undefined && failedTaskStatuses.has(task.status.toLowerCase());
  }

  /** Claude Code keeps each sub-agent's sidecar beside the session transcript: `<transcript>/subagents/agent-<id>.meta.json`. */
  private claudeMeta(input: HookPayload, agent: string): z.infer<typeof ClaudeSubagentMetaSchema> | undefined {
    const dir = this.claudeSubagentsDir(input);
    if (dir === undefined) return undefined;
    try {
      const parsed = ClaudeSubagentMetaSchema.safeParse(JSON.parse(readFileSync(join(dir, `agent-${SubagentFileNameSchema.parse(agent)}.meta.json`), "utf-8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private firstPrompt(input: HookPayload, agent: string): string | undefined {
    const dir = this.claudeSubagentsDir(input);
    const path = input.agent_transcript_path ?? (dir !== undefined ? join(dir, `agent-${SubagentFileNameSchema.parse(agent)}.jsonl`) : undefined);
    if (path === undefined || path === null) return undefined;
    const head = this.readHead(path);
    if (head === undefined) return undefined;
    for (const line of head.split("\n")) {
      try {
        const parsed = TranscriptLineSchema.safeParse(JSON.parse(line));
        if (!parsed.success || parsed.data.message?.role !== "user") continue;
        const text = this.contentText(parsed.data.message.content);
        if (text !== undefined) return text;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private claudeSubagentsDir(input: HookPayload): string | undefined {
    if (input.agent_transcript_path !== undefined && input.agent_transcript_path !== null) return dirname(input.agent_transcript_path);
    const transcript = input.transcript_path;
    if (transcript === undefined || transcript === null || !transcript.endsWith(".jsonl")) return undefined;
    return join(transcript.slice(0, -".jsonl".length), "subagents");
  }

  private pathFor(harness: SubagentHarness, session: string, agent: string): string {
    return join(this.folder(), `${SubagentFileNameSchema.parse(`${harness}-${session}-${agent}`)}.json`);
  }

  private readPath(path: string): SubagentStatusRecord | undefined {
    try {
      const parsed = SubagentStatusRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private write(path: string, record: SubagentStatusRecord): void {
    const folder = this.folder();
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temp = join(folder, `.${randomBytes(6).toString("hex")}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  private entries(): string[] {
    try {
      return readdirSync(this.folder());
    } catch {
      return [];
    }
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  private clip(text: string): string {
    const flat = text.replaceAll(/\s+/g, " ").trim();
    return flat.length > maxDescriptionLength ? flat.slice(0, maxDescriptionLength) : flat;
  }

  private contentText(content: unknown): string | undefined {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return undefined;
    const parts = content.flatMap((part: unknown) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? [part.text] : [],
    );
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  /** The transcript's first bytes only, so the read never grows with the transcript. */
  private readHead(path: string): string | undefined {
    let fd: number | undefined;
    try {
      fd = openSync(path, "r");
      const buffer = Buffer.alloc(transcriptHeadBytes);
      const read = readSync(fd, buffer, 0, transcriptHeadBytes, 0);
      return buffer.subarray(0, read).toString("utf-8");
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}

/** Reads the checked-out branch from `.git/HEAD` without starting git, following a worktree's `gitdir:` pointer. */
export class GitHeadReader {
  branch(cwd: string): string | undefined {
    let dir = resolve(cwd);
    for (;;) {
      const dotGit = join(dir, ".git");
      const isDirectory = this.isDirectory(dotGit);
      if (isDirectory !== undefined) return this.headBranch(dir, dotGit, isDirectory);
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }

  private isDirectory(path: string): boolean | undefined {
    try {
      return statSync(path).isDirectory();
    } catch {
      return undefined;
    }
  }

  private headBranch(dir: string, dotGit: string, isDirectory: boolean): string | undefined {
    try {
      const pointer = isDirectory ? undefined : /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf-8"))?.[1]?.trim();
      const gitDir = isDirectory ? dotGit : pointer !== undefined ? resolve(dir, pointer) : undefined;
      if (gitDir === undefined) return undefined;
      return /^ref:\s*refs\/heads\/(.+)$/m.exec(readFileSync(join(gitDir, "HEAD"), "utf-8"))?.[1]?.trim();
    } catch {
      return undefined;
    }
  }
}
