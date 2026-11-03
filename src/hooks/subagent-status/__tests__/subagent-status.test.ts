import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHookCommand } from "../../commands/hook/command.js";
import { GitHeadReader, SubagentFileNameSchema, SubagentStatusRecorder, subagentStatusMaxAgeMs } from "../subagent-status.js";

const directories: string[] = [];
const temporary = (): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-subagent-status-")));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const start = Date.parse("2026-11-03T14:00:00Z");

const setup = (env: Record<string, string | undefined> = { HC_TERMINAL_ID: "t3" }, branch?: string) => {
  const state = temporary();
  const work = temporary();
  const clock = { now: start };
  const recorder = new SubagentStatusRecorder({
    env: { XDG_STATE_HOME: state, ...env },
    home: temporary(),
    now: () => clock.now,
    readBranch: () => branch,
  });
  const folder = join(state, "flight-rules", "agents");
  return { recorder, clock, folder, work };
};

const claudeSession = (work: string) => {
  const transcript = join(work, "session-1.jsonl");
  const subagents = join(work, "session-1", "subagents");
  mkdirSync(subagents, { recursive: true });
  return { transcript, subagents };
};

const base = (work: string, extra: Record<string, unknown> = {}) => ({
  session_id: "session-1",
  agent_id: "agent-a",
  agent_type: "code-verifier",
  cwd: work,
  transcript_path: join(work, "session-1.jsonl"),
  ...extra,
});

describe("SubagentStatusRecorder", () => {
  it("writes a working record on SubagentStart", () => {
    const { recorder, folder, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });

    expect(readdirSync(folder)).toEqual(["claude-code-session-1-agent-a.json"]);
    expect(JSON.parse(readFileSync(join(folder, "claude-code-session-1-agent-a.json"), "utf-8"))).toEqual({
      v: 1,
      harness: "claude-code",
      hc_terminal: "t3",
      session_id: "session-1",
      agent_id: "agent-a",
      agent_type: "code-verifier",
      description: "",
      ticket: null,
      status: "working",
      cwd: work,
      started_at: "2026-11-03T14:00:00Z",
      updated_at: "2026-11-03T14:00:00Z",
      ended_at: null,
    });
  });

  it("reads the description and ticket from Claude Code's sub-agent sidecar", () => {
    const { recorder, work } = setup();
    const { subagents } = claudeSession(work);
    writeFileSync(join(subagents, "agent-agent-a.meta.json"), JSON.stringify({ agentType: "code-verifier", description: "Verify FRT-1234 acceptance criteria" }));
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });

    const record = recorder.read("claude-code", "session-1", "agent-a");
    expect(record?.description).toBe("Verify FRT-1234 acceptance criteria");
    expect(record?.ticket).toBe("FRT-1234");
  });

  it("takes the ticket from the sub-agent's first prompt when the description names none", () => {
    const { recorder, work } = setup();
    const { subagents } = claudeSession(work);
    writeFileSync(join(subagents, "agent-agent-a.meta.json"), JSON.stringify({ description: "verify the change" }));
    writeFileSync(
      join(subagents, "agent-agent-a.jsonl"),
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "You are building ticket PLT-77 now." }] } }) + "\n",
    );
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });

    expect(recorder.read("claude-code", "session-1", "agent-a")?.ticket).toBe("PLT-77");
  });

  it("falls back to the branch, then lets a later description replace it", () => {
    const { recorder, clock, work } = setup({}, "feat/FRT-9-branch-work");
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    expect(recorder.read("claude-code", "session-1", "agent-a")?.ticket).toBe("FRT-9");

    const { subagents } = claudeSession(work);
    writeFileSync(join(subagents, "agent-agent-a.meta.json"), JSON.stringify({ description: "Implement FRT-42" }));
    clock.now += 60_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse", tool_name: "Read" });

    const record = recorder.read("claude-code", "session-1", "agent-a");
    expect(record?.description).toBe("Implement FRT-42");
    expect(record?.ticket).toBe("FRT-42");
  });

  it("clips descriptions to 120 characters on one line", () => {
    const { recorder, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart", description: `line one\n${"x".repeat(200)}` });

    const description = recorder.read("claude-code", "session-1", "agent-a")?.description ?? "";
    expect(description).toHaveLength(120);
    expect(description).not.toContain("\n");
  });

  it("marks the record done on SubagentStop and keeps started_at", () => {
    const { recorder, clock, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now += 90_000;
    recorder.handle("claude-code", {
      ...base(work),
      hook_event_name: "SubagentStop",
      background_tasks: [{ id: "agent-a", status: "running", description: "Verify FRT-5" }],
    });

    const record = recorder.read("claude-code", "session-1", "agent-a");
    expect(record).toMatchObject({
      status: "done",
      started_at: "2026-11-03T14:00:00Z",
      updated_at: "2026-11-03T14:01:30Z",
      ended_at: "2026-11-03T14:01:30Z",
      description: "Verify FRT-5",
      ticket: "FRT-5",
    });
  });

  it("writes a finished record for a stop it never saw start", () => {
    const { recorder, work } = setup();
    recorder.handle("codex", { ...base(work), hook_event_name: "SubagentStop", agent_transcript_path: null });

    expect(recorder.read("codex", "session-1", "agent-a")).toMatchObject({ harness: "codex", status: "done", ended_at: "2026-11-03T14:00:00Z" });
  });

  it("marks the record error when the harness reports a failure", () => {
    const { recorder, clock, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now += 1000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "StopFailure", error: "rate_limit" });
    clock.now += 1000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStop" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "error", ended_at: "2026-11-03T14:00:01Z" });
  });

  it("treats a failed background task on SubagentStop as an error", () => {
    const { recorder, work } = setup();
    recorder.handle("claude-code", {
      ...base(work),
      hook_event_name: "SubagentStop",
      background_tasks: [{ id: "agent-a", status: "failed" }],
    });

    expect(recorder.read("claude-code", "session-1", "agent-a")?.status).toBe("error");
  });

  it("ignores a StopFailure from the main thread", () => {
    const { recorder, folder, work } = setup();
    recorder.handle("claude-code", { session_id: "session-1", cwd: work, hook_event_name: "StopFailure", error: "server_error" });

    expect(() => readdirSync(folder)).toThrow();
  });

  it("refreshes updated_at from a sub-agent's tool call, at most every 30 seconds", () => {
    const { recorder, clock, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now += 10_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });
    expect(recorder.read("claude-code", "session-1", "agent-a")?.updated_at).toBe("2026-11-03T14:00:00Z");

    clock.now += 30_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });
    expect(recorder.read("claude-code", "session-1", "agent-a")?.updated_at).toBe("2026-11-03T14:00:40Z");
  });

  it("lets a tool call inside the interval fill a description the start couldn't read yet", () => {
    const { recorder, clock, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    const { subagents } = claudeSession(work);
    writeFileSync(join(subagents, "agent-agent-a.meta.json"), JSON.stringify({ description: "Review FRT-8" }));
    clock.now += 2000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({
      description: "Review FRT-8",
      ticket: "FRT-8",
      updated_at: "2026-11-03T14:00:02Z",
    });
  });

  it("never reopens a finished record from a late tool call", () => {
    const { recorder, clock, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStop" });
    clock.now += 60_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "done", updated_at: "2026-11-03T14:00:00Z" });
  });

  it("ignores main-thread tool calls", () => {
    const { recorder, folder, work } = setup();
    recorder.handle("claude-code", { session_id: "session-1", cwd: work, hook_event_name: "PostToolUse", tool_name: "Bash" });

    expect(() => readdirSync(folder)).toThrow();
  });

  it("marks only the ending session's working records done on SessionEnd", () => {
    const { recorder, clock, work } = setup();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    recorder.handle("claude-code", { ...base(work, { agent_id: "agent-b" }), hook_event_name: "SubagentStart" });
    recorder.handle("claude-code", { ...base(work, { agent_id: "agent-c" }), hook_event_name: "SubagentStop" });
    recorder.handle("claude-code", { ...base(work, { session_id: "session-2" }), hook_event_name: "SubagentStart" });
    recorder.handle("codex", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now += 5000;
    recorder.handle("claude-code", { session_id: "session-1", cwd: work, hook_event_name: "SessionEnd", reason: "other" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "done", ended_at: "2026-11-03T14:00:05Z" });
    expect(recorder.read("claude-code", "session-1", "agent-b")).toMatchObject({ status: "done", ended_at: "2026-11-03T14:00:05Z" });
    expect(recorder.read("claude-code", "session-1", "agent-c")).toMatchObject({ status: "done", ended_at: "2026-11-03T14:00:00Z" });
    expect(recorder.read("claude-code", "session-2", "agent-a")?.status).toBe("working");
    expect(recorder.read("codex", "session-1", "agent-a")?.status).toBe("working");
  });

  it("prunes records finished or silent for more than 24 hours on every run", () => {
    const { recorder, clock, folder, work } = setup();
    recorder.handle("claude-code", { ...base(work, { agent_id: "finished-old" }), hook_event_name: "SubagentStop" });
    recorder.handle("claude-code", { ...base(work, { agent_id: "silent-old" }), hook_event_name: "SubagentStart" });
    clock.now += 2 * 60 * 60_000;
    recorder.handle("claude-code", { ...base(work, { agent_id: "finished-new" }), hook_event_name: "SubagentStop" });
    recorder.handle("claude-code", { ...base(work, { agent_id: "working-new" }), hook_event_name: "SubagentStart" });
    writeFileSync(join(folder, "garbage.json"), "{not json");
    writeFileSync(join(folder, ".abandoned.tmp"), "{}");
    const old = (start - 1000) / 1000;
    utimesSync(join(folder, "garbage.json"), old, old);
    utimesSync(join(folder, ".abandoned.tmp"), old, old);
    writeFileSync(join(folder, ".fresh.tmp"), "{}");
    const recent = (start + subagentStatusMaxAgeMs) / 1000;
    utimesSync(join(folder, ".fresh.tmp"), recent, recent);

    clock.now = start + subagentStatusMaxAgeMs + 60_000;
    recorder.handle("claude-code", { hook_event_name: "Notification" });

    expect(readdirSync(folder).sort()).toEqual([
      ".claude-code-session-1-finished-new.json.done",
      ".fresh.tmp",
      "claude-code-session-1-finished-new.json",
      "claude-code-session-1-working-new.json",
    ]);
  });

  it("writes through a temp file and rename, leaving only the record behind", () => {
    const { recorder, clock, folder, work } = setup();
    for (let index = 0; index < 5; index += 1) {
      clock.now += 60_000;
      recorder.handle("claude-code", { ...base(work), hook_event_name: index === 0 ? "SubagentStart" : "PostToolUse" });
    }

    expect(readdirSync(folder)).toEqual(["claude-code-session-1-agent-a.json"]);
    expect(recorder.read("claude-code", "session-1", "agent-a")?.updated_at).toBe("2026-11-03T14:05:00Z");
  });

  it("tolerates a missing HC_TERMINAL_ID, agent type and cwd", () => {
    const { recorder } = setup({});
    recorder.handle("codex", { session_id: "s", agent_id: "a", hook_event_name: "SubagentStart" });

    expect(recorder.read("codex", "s", "a")).toMatchObject({ hc_terminal: null, agent_type: "subagent", cwd: process.cwd(), ticket: null });
  });

  it("ignores payloads without a session or agent, and unknown events", () => {
    const { recorder, folder } = setup();
    recorder.handle("claude-code", { hook_event_name: "SubagentStart", agent_id: "a" });
    recorder.handle("claude-code", { hook_event_name: "SubagentStart", session_id: "s" });
    recorder.handle("claude-code", { hook_event_name: "PreCompact", session_id: "s", agent_id: "a" });
    recorder.handle("claude-code", "not an object");

    expect(() => readdirSync(folder)).toThrow();
  });

  it("sanitizes file names", () => {
    const { recorder, folder } = setup();
    recorder.handle("codex", { session_id: "019a/../x y", agent_id: "agent:1", hook_event_name: "SubagentStart" });

    expect(readdirSync(folder)).toEqual(["codex-019a_.._x_y-agent_1.json"]);
    expect(SubagentFileNameSchema.parse("a/b c:d.e_f-g")).toBe("a_b_c_d.e_f-g");
  });

  it("defaults the folder to ~/.local/state", () => {
    const home = temporary();
    expect(new SubagentStatusRecorder({ env: { XDG_STATE_HOME: "" }, home }).folder()).toBe(join(home, ".local", "state", "flight-rules", "agents"));
  });
});

describe("SubagentStatusRecorder across hook processes", () => {
  const racing = (branch?: string) => {
    const state = temporary();
    const work = temporary();
    const clock = { now: start };
    let interleave: (() => void) | undefined;
    const now = () => {
      const step = interleave;
      interleave = undefined;
      step?.();
      return clock.now;
    };
    const recorder = new SubagentStatusRecorder({ env: { XDG_STATE_HOME: state }, now, readBranch: () => branch });
    const other = new SubagentStatusRecorder({ env: { XDG_STATE_HOME: state }, now: () => clock.now, readBranch: () => branch });
    const folder = join(state, "flight-rules", "agents");
    const marker = (status: "done" | "error", at: string) => writeFileSync(join(folder, `.claude-code-session-1-agent-a.json.${status}`), at);
    return { recorder, other, clock, folder, work, marker, race: (step: () => void) => (interleave = step) };
  };

  it("repairs a tool-call refresh that renames over a stop which landed after its first look", () => {
    const { recorder, other, clock, work, race } = racing();
    other.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now += 60_000;
    race(() => other.handle("claude-code", { ...base(work), hook_event_name: "SubagentStop" }));
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });

    expect(other.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "done", ended_at: "2026-11-03T14:01:00Z" });
  });

  it("leaves a record alone once a stop has marked it, even before the stop writes", () => {
    const { recorder, clock, work, marker } = racing();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    marker("done", "2026-11-03T14:00:30Z");
    clock.now += 60_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "working", updated_at: "2026-11-03T14:00:00Z" });
  });

  it("keeps an error whose marker landed while SessionEnd was closing the session", () => {
    const { recorder, work, marker } = racing();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    marker("error", "2026-11-03T14:00:00Z");
    recorder.handle("claude-code", { session_id: "session-1", hook_event_name: "SessionEnd" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "error", ended_at: "2026-11-03T14:00:00Z" });
  });

  it("lets an error replace a done that SessionEnd already wrote", () => {
    const { recorder, clock, work } = racing();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    recorder.handle("claude-code", { session_id: "session-1", hook_event_name: "SessionEnd" });
    clock.now += 1000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "StopFailure" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "error", ended_at: "2026-11-03T14:00:01Z" });
  });

  it("does not prune a stale record that a stop has just marked", () => {
    const { recorder, clock, folder, work, marker } = racing();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now = start + subagentStatusMaxAgeMs + 60_000;
    marker("done", new Date(clock.now).toISOString());
    recorder.prune();

    expect(readdirSync(folder).sort()).toEqual([".claude-code-session-1-agent-a.json.done", "claude-code-session-1-agent-a.json"]);
  });

  it("clears the end markers when a sub-agent starts again", () => {
    const { recorder, clock, folder, work } = racing();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStop" });
    clock.now += 60_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    clock.now += 60_000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });

    expect(recorder.read("claude-code", "session-1", "agent-a")).toMatchObject({ status: "working", ended_at: null, updated_at: "2026-11-03T14:02:00Z" });
    expect(readdirSync(folder)).toEqual(["claude-code-session-1-agent-a.json"]);
  });

  it("prunes a finished record together with its markers", () => {
    const { recorder, clock, folder, work } = racing();
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStop" });
    clock.now = start + subagentStatusMaxAgeMs + 60_000;
    recorder.prune();

    expect(readdirSync(folder)).toEqual([]);
  });

  it("lets a prompt ticket replace a branch ticket once the prompt is written", () => {
    const { recorder, clock, work } = racing("feat/BR-1-work");
    const { subagents } = claudeSession(work);
    writeFileSync(join(subagents, "agent-agent-a.meta.json"), JSON.stringify({ description: "verify the change" }));
    recorder.handle("claude-code", { ...base(work), hook_event_name: "SubagentStart" });
    expect(recorder.read("claude-code", "session-1", "agent-a")?.ticket).toBe("BR-1");

    writeFileSync(join(subagents, "agent-agent-a.jsonl"), JSON.stringify({ type: "user", message: { role: "user", content: "Work on TASK-2." } }) + "\n");
    clock.now += 1000;
    recorder.handle("claude-code", { ...base(work), hook_event_name: "PostToolUse" });

    expect(recorder.read("claude-code", "session-1", "agent-a")?.ticket).toBe("TASK-2");
  });
});

describe("GitHeadReader", () => {
  it("reads a checkout's branch and follows a worktree's gitdir pointer", () => {
    const repo = temporary();
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/feat/FRT-1-thing\n");
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    expect(new GitHeadReader().branch(join(repo, "src", "deep"))).toBe("feat/FRT-1-thing");

    const worktreeGit = join(repo, ".git", "worktrees", "wt");
    mkdirSync(worktreeGit, { recursive: true });
    writeFileSync(join(worktreeGit, "HEAD"), "ref: refs/heads/fix/PLT-2\n");
    const worktree = temporary();
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGit}\n`);
    expect(new GitHeadReader().branch(worktree)).toBe("fix/PLT-2");
  });

  it("returns undefined for a detached head or no repository", () => {
    const repo = temporary();
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(new GitHeadReader().branch(repo)).toBeUndefined();
    expect(new GitHeadReader().branch("/")).toBeUndefined();
  });
});

describe("hook subagent-status", () => {
  const run = async (stdin: string, args: string[], recorder: SubagentStatusRecorder): Promise<string> => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createHookCommand(undefined, () => Promise.resolve(stdin), undefined, () => recorder)
      .exitOverride()
      .parseAsync(["subagent-status", ...args], { from: "user" });
    return output.mock.calls.map(([chunk]) => String(chunk)).join("");
  };

  it("records a sub-agent for the named harness and prints nothing", async () => {
    const { recorder, work } = setup();
    const printed = await run(JSON.stringify({ ...base(work), hook_event_name: "SubagentStart" }), ["--harness", "codex"], recorder);

    expect(printed).toBe("");
    expect(recorder.read("codex", "session-1", "agent-a")?.status).toBe("working");
  });

  it("defaults to claude-code", async () => {
    const { recorder, work } = setup();
    await run(JSON.stringify({ ...base(work), hook_event_name: "SubagentStart" }), [], recorder);

    expect(recorder.read("claude-code", "session-1", "agent-a")?.status).toBe("working");
  });

  it("does nothing for an unknown harness, invalid JSON or a recorder that throws", async () => {
    const { recorder, folder, work } = setup();
    expect(await run(JSON.stringify({ ...base(work), hook_event_name: "SubagentStart" }), ["--harness", "cursor"], recorder)).toBe("");
    expect(await run("{not json", [], recorder)).toBe("");
    expect(() => readdirSync(folder)).toThrow();

    const failing = new SubagentStatusRecorder();
    vi.spyOn(failing, "handle").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(run(JSON.stringify({ ...base(work), hook_event_name: "SubagentStart" }), [], failing)).resolves.toBe("");
  });
});
