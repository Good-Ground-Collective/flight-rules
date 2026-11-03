import { z } from "zod";
import { TicketKeyExtractor } from "../../shared/ariadne/ticket-key-extractor.js";
export declare const SubagentHarnessSchema: z.ZodEnum<{
    codex: "codex";
    "claude-code": "claude-code";
}>;
export type SubagentHarness = z.infer<typeof SubagentHarnessSchema>;
export declare const SubagentStatusSchema: z.ZodEnum<{
    error: "error";
    done: "done";
    working: "working";
}>;
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;
export declare const SubagentStatusRecordSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    harness: z.ZodEnum<{
        codex: "codex";
        "claude-code": "claude-code";
    }>;
    hc_terminal: z.ZodNullable<z.ZodString>;
    session_id: z.ZodString;
    agent_id: z.ZodString;
    agent_type: z.ZodString;
    description: z.ZodString;
    ticket: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        error: "error";
        done: "done";
        working: "working";
    }>;
    cwd: z.ZodString;
    started_at: z.ZodString;
    updated_at: z.ZodString;
    ended_at: z.ZodNullable<z.ZodString>;
}, z.core.$loose>;
export type SubagentStatusRecord = z.infer<typeof SubagentStatusRecordSchema>;
/** Finished records, and working records nothing has refreshed, are deleted after a day. */
export declare const subagentStatusMaxAgeMs: number;
/** A tool call refreshes `updated_at` at most this often, so busy sub-agents don't rewrite their file on every call. */
export declare const subagentTouchIntervalMs = 30000;
export interface SubagentStatusRecorderProps {
    env?: Record<string, string | undefined>;
    home?: string;
    now?: () => number;
    extractor?: TicketKeyExtractor;
    readBranch?: (cwd: string) => string | undefined;
}
/** Ids become one file name each, limited to `[A-Za-z0-9._-]`. */
export declare const SubagentFileNameSchema: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
/**
 * Keeps one JSON file per sub-agent run under
 * `$XDG_STATE_HOME/flight-rules/agents/` (default
 * `~/.local/state/flight-rules/agents/`), so a terminal multiplexer can nest
 * in-process sub-agents under the terminal that runs them. Each hook event
 * from Claude Code or Codex maps to one transition; every write is atomic and
 * every call prunes stale records. Nothing here throws to the caller.
 */
export declare class SubagentStatusRecorder {
    private readonly env;
    private readonly home;
    private readonly now;
    private readonly extractor;
    private readonly readBranch;
    constructor(props?: SubagentStatusRecorderProps);
    folder(): string;
    /** Routes a hook payload by its `hook_event_name`. */
    handle(harness: SubagentHarness, payload: unknown): void;
    read(harness: SubagentHarness, session: string, agent: string): SubagentStatusRecord | undefined;
    list(): SubagentStatusRecord[];
    prune(): void;
    private start;
    private stop;
    private touch;
    private endSession;
    /**
     * Hook processes can run at once (a sub-agent's last tool call beside its
     * stop, SessionEnd beside a failure), so a finished state is never left to
     * the last rename. Each end creates `.<record>.done` or `.<record>.error`
     * with an exclusive create before it writes, and every writer re-reads the
     * markers after its rename and rewrites the record if they disagree. Error
     * outranks done, and the first marker of each kind keeps its time.
     */
    private end;
    private terminal;
    private commit;
    private markerPath;
    private markers;
    private expired;
    private readText;
    private recent;
    /** Nothing can outrank a key in the description, so only then is there nothing left to look up. */
    private resolved;
    private fresh;
    /**
     * Fills the description and ticket once the harness has written something
     * to read them from. A key in the description, then the first prompt, wins
     * over one in the branch, so a branch ticket found early is replaced later.
     */
    private enrich;
    private failed;
    /** Claude Code keeps each sub-agent's sidecar beside the session transcript: `<transcript>/subagents/agent-<id>.meta.json`. */
    private claudeMeta;
    private firstPrompt;
    private claudeSubagentsDir;
    private pathFor;
    private readPath;
    private write;
    private isRecordName;
    private mtime;
    private entries;
    private timestamp;
    private clip;
    private contentText;
    /** The transcript's first bytes only, so the read never grows with the transcript. */
    private readHead;
}
/** Reads the checked-out branch from `.git/HEAD` without starting git, following a worktree's `gitdir:` pointer. */
export declare class GitHeadReader {
    branch(cwd: string): string | undefined;
    private isDirectory;
    private headBranch;
}
