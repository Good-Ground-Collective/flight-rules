import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AriadneBoard } from "../../../shared/ariadne/ariadne-board.js";
import { AriadneTokenStore } from "../../../shared/ariadne/ariadne-token-store.js";
import { BoardAgentStore } from "../../../shared/ariadne/board-agent-store.js";
import { BoardSessionStore } from "../../../shared/ariadne/board-session-store.js";
import { FakeTransport, agentToken, contract } from "../../../shared/ariadne/__tests__/fake-transport.js";
import { createHookCommand } from "../../commands/hook/command.js";
import type { BoardHookServices } from "../../commands/hook/command.js";
import { BoardHookKit } from "../board-hook-kit.js";
import { DetachedHeartbeatSender, heartbeatIntervalMs, heartbeatMaxAgeMs } from "../board-heartbeat.js";
import type { FinishedReport } from "../board-heartbeat.js";

// The board hooks run on every tool call and every Agent dispatch, so they
// must be silent, exit 0, never wait on the network, and never overwrite a
// skill's step. These tests drive them through the `hook` command, as Claude
// Code does, with the detached sender replaced by a recorder.

const claude = "claude-session-1";

interface Spawned {
  sent: string[];
  branches: { claudeSession: string; cwd: string }[];
  finished: FinishedReport[];
}

describe("board hooks", () => {
  let home: string;
  let now: number;
  let transcripts: string;
  let env: Record<string, string | undefined>;
  let branchName: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-board-hook-"));
    transcripts = join(home, "projects", "repo");
    mkdirSync(join(transcripts, claude, "subagents"), { recursive: true });
    now = 5_000_000_000;
    env = { ARIADNE_AGENT_TOKEN: agentToken };
    branchName = undefined;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const sessions = () => new BoardSessionStore({ env: {}, home, now: () => now });
  const agents = () => new BoardAgentStore({ env: {}, home, now: () => now });
  const board = (transport = new FakeTransport()) =>
    new AriadneBoard({ readLayers: () => [], tokens: new AriadneTokenStore({ env, home }), env, transport, sessions: sessions() });
  const transcriptPath = () => join(transcripts, `${claude}.jsonl`);
  const subagentFile = (name: string) => join(transcripts, claude, "subagents", name);

  const run = async (argv: string[], stdin: string, transport = new FakeTransport()) => {
    const spawned: Spawned = { sent: [], branches: [], finished: [] };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const kit = () => new BoardHookKit({ sessions: sessions(), agents: agents(), board: () => board() });
    const services: BoardHookServices = {
      heartbeatHook: () => kit().heartbeatHook(),
      dispatchHook: () => kit().dispatchHook(),
      sender: () => ({
        send: (session) => spawned.sent.push(session),
        sendBranch: (claudeSession, cwd) => spawned.branches.push({ claudeSession, cwd }),
        sendFinished: (report) => spawned.finished.push(report),
      }),
      board: () => board(transport),
      branch: () => ({ read: () => branchName }),
    };
    try {
      await createHookCommand(undefined, () => Promise.resolve(stdin), services)
        .exitOverride()
        .parseAsync(argv, { from: "user" });
      return { ...spawned, stdout: stdout.mock.calls.length, stderr: stderr.mock.calls.length };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  };

  const dispatch = (toolUseId: string, description: string, prompt: string, extra: Record<string, unknown> = {}) =>
    run(
      ["agent-dispatch"],
      JSON.stringify({
        session_id: claude,
        transcript_path: transcriptPath(),
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_use_id: toolUseId,
        tool_input: { description, prompt, subagent_type: "general-purpose" },
        ...extra,
      }),
    );

  /** What Claude Code writes beside the session transcript once a sub-agent starts. */
  const startSubagent = (agentId: string, toolUseId: string, description: string, prompt: string) => {
    writeFileSync(
      subagentFile(`agent-${agentId}.meta.json`),
      JSON.stringify({ agentType: "general-purpose", description, toolUseId, spawnDepth: 1, requestShape: "foreground" }),
    );
    writeFileSync(subagentFile(`agent-${agentId}.jsonl`), JSON.stringify({ type: "user", agentId, message: { role: "user", content: prompt } }) + "\n");
  };

  const toolCall = (agentId?: string, extra: Record<string, unknown> = {}) =>
    run(
      ["board-heartbeat"],
      JSON.stringify({
        session_id: claude,
        transcript_path: transcriptPath(),
        cwd: join(home, "repo"),
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        ...(agentId !== undefined ? { agent_id: agentId, agent_type: "general-purpose" } : {}),
        ...extra,
      }),
    );

  const subagentStop = (agentId: string) =>
    run(
      ["agent-stop"],
      JSON.stringify({
        session_id: claude,
        transcript_path: transcriptPath(),
        hook_event_name: "SubagentStop",
        agent_id: agentId,
        agent_type: "general-purpose",
        agent_transcript_path: subagentFile(`agent-${agentId}.jsonl`),
        last_assistant_message: "done",
      }),
    );

  describe("skill sessions", () => {
    const payload = JSON.stringify({ session_id: claude, hook_event_name: "PostToolUse", tool_name: "Bash" });

    it("does nothing, silently, when no skill has reported a ticket for the session", async () => {
      expect(await run(["board-heartbeat"], payload)).toMatchObject({ sent: [], branches: [], stdout: 0, stderr: 0 });
    });

    it("does nothing on bad stdin", async () => {
      expect(await run(["board-heartbeat"], "{not json")).toMatchObject({ sent: [], stdout: 0, stderr: 0 });
      expect(await run(["board-heartbeat"], "{}")).toMatchObject({ sent: [], stdout: 0, stderr: 0 });
      expect(await run(["agent-dispatch"], "{not json")).toMatchObject({ stdout: 0, stderr: 0 });
      expect(await run(["agent-stop"], "{}")).toMatchObject({ finished: [], stdout: 0, stderr: 0 });
    });

    it("hands a session recorded under the Claude Code session id to the sender at most once a minute", async () => {
      sessions().record({ session: claude, ticket: "FRT-1", step: "verify 2/3", state: "nominal" });
      now += heartbeatIntervalMs;
      expect((await run(["board-heartbeat"], payload)).sent).toEqual([claude]);
      now += 10_000;
      expect((await run(["board-heartbeat"], payload)).sent).toEqual([]);
      now += heartbeatIntervalMs;
      expect((await run(["board-heartbeat"], payload)).sent).toEqual([claude]);
    });

    it("finds a main-thread skill run under its new default session <session>-<TICKET>", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      env = { ...env, CLAUDE_CODE_SESSION_ID: claude };
      await board(transport).heartbeat({ ticket: "FRT-7", step: "implement", state: "nominal", skill: "flight-rules:execute-work" });
      now += heartbeatIntervalMs;
      expect((await toolCall()).sent).toEqual([`${claude}-FRT-7`]);
      expect((await toolCall()).sent).toEqual([]);
    });

    it("--send replays the skill's last heartbeat, keeping its step", async () => {
      sessions().record({ session: claude, ticket: "FRT-1", step: "verify 2/3", state: "caution" });
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      expect(await run(["board-heartbeat", "--send", claude], "", transport)).toMatchObject({ stdout: 0, stderr: 0 });
      expect(transport.bodies()).toEqual([{ session: claude, ticket: "FRT-1", step: "verify 2/3", state: "caution" }]);
    });

    it("--send stays silent when the post fails", async () => {
      sessions().record({ session: claude, ticket: "FRT-1", step: "pr", state: "nominal" });
      const transport = new FakeTransport(FakeTransport.json(401, { error: "unauthorized" }));
      expect(await run(["board-heartbeat", "--send", claude], "", transport)).toMatchObject({ stdout: 0, stderr: 0 });
    });
  });

  describe("sub-agents", () => {
    it("reports a general-purpose sub-agent dispatched for a ticket on its first tool call, with no skill involved", async () => {
      expect(await dispatch("toolu_1", "Build FRT-1234 probe", "Run echo hi.")).toMatchObject({ stdout: 0, stderr: 0 });
      startSubagent("a1", "toolu_1", "Build FRT-1234 probe", "Run echo hi.");
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-1234`]);

      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      await run(["board-heartbeat", "--send", `${claude}-FRT-1234`], "", transport);
      expect(transport.bodies()).toEqual([
        { session: `${claude}-FRT-1234`, ticket: "FRT-1234", step: "Build FRT-1234 probe", state: "nominal", skill: "general-purpose" },
      ]);
    });

    it("cuts a long dispatch description to the step's 60 characters", async () => {
      const description = `Build FRT-1 ${"and more ".repeat(20)}`;
      await dispatch("toolu_1", description, "p");
      startSubagent("a1", "toolu_1", description, "p");
      await toolCall("a1");
      const step = sessions().readInferred(`${claude}-FRT-1`)?.heartbeat.step ?? "";
      expect(step.length).toBeLessThanOrEqual(60);
      expect(step.startsWith("Build FRT-1 and more")).toBe(true);
    });

    it("makes two sessions for two tickets, and one for two sub-agents on the same ticket", async () => {
      await dispatch("toolu_1", "Build FRT-1 api", "p1");
      await dispatch("toolu_2", "Build FRT-2 ui", "p2");
      await dispatch("toolu_3", "Review FRT-1 api", "p3");
      startSubagent("a1", "toolu_1", "Build FRT-1 api", "p1");
      startSubagent("a2", "toolu_2", "Build FRT-2 ui", "p2");
      startSubagent("a3", "toolu_3", "Review FRT-1 api", "p3");
      const sent = [...(await toolCall("a1")).sent, ...(await toolCall("a2")).sent, ...(await toolCall("a3")).sent];
      expect(sent).toEqual([`${claude}-FRT-1`, `${claude}-FRT-2`]);
      expect([agents().readAgent("a1")?.ticket, agents().readAgent("a3")?.ticket]).toEqual(["FRT-1", "FRT-1"]);
    });

    it("throttles each board session to one heartbeat a minute", async () => {
      await dispatch("toolu_1", "Build FRT-1 api", "p1");
      startSubagent("a1", "toolu_1", "Build FRT-1 api", "p1");
      expect((await toolCall("a1")).sent).toHaveLength(1);
      now += heartbeatIntervalMs - 1;
      expect((await toolCall("a1")).sent).toHaveLength(0);
      now += 1;
      expect((await toolCall("a1")).sent).toHaveLength(1);
    });

    it("falls back to the sub-agent's transcript when meta.json is missing", async () => {
      await dispatch("toolu_1", "Build the probe", "You are building Jira ticket FRT-5678. Run echo hi.");
      writeFileSync(
        subagentFile("agent-a1.jsonl"),
        JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "You are building Jira ticket FRT-5678. Run echo hi." }] } }) + "\n",
      );
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-5678`]);
      expect(agents().readAgent("a1")).toMatchObject({ ticket: "FRT-5678", description: "Build the probe" });
    });

    it("maps a background sub-agent from its early PostToolUse(Agent), before it has started", async () => {
      await dispatch("toolu_bg", "Build FRT-5678 probe", "p");
      const launch = await toolCall(undefined, {
        tool_name: "Agent",
        tool_use_id: "toolu_bg",
        tool_response: { status: "async_launched", agentId: "abg", description: "Build FRT-5678 probe" },
      });
      expect(launch.sent).toEqual([]);
      expect(agents().readAgent("abg")).toMatchObject({ ticket: "FRT-5678", toolUseId: "toolu_bg" });
      // No meta.json or transcript yet: the bridge alone resolves the ticket.
      expect((await toolCall("abg")).sent).toEqual([`${claude}-FRT-5678`]);
      // The launch carried no agent type; the sub-agent's own tool call does.
      expect(sessions().readInferred(`${claude}-FRT-5678`)?.heartbeat).toMatchObject({ step: "Build FRT-5678 probe", skill: "general-purpose" });
    });

    it("leaves an already-mapped sub-agent alone when its PostToolUse(Agent) arrives late", async () => {
      await dispatch("toolu_bg", "Build FRT-5678 probe", "p");
      startSubagent("abg", "toolu_bg", "Build FRT-5678 probe", "p");
      await toolCall("abg");
      const mapped = agents().readAgent("abg");
      now += 1000;
      await toolCall(undefined, { tool_name: "Agent", tool_use_id: "toolu_bg", tool_response: { status: "async_launched", agentId: "abg" } });
      expect(agents().readAgent("abg")).toEqual(mapped);
    });

    it("waits, without caching, while Claude Code has written nothing for the sub-agent", async () => {
      await dispatch("toolu_1", "Build FRT-1 api", "p1");
      expect((await toolCall("a1")).sent).toEqual([]);
      expect(agents().readAgent("a1")).toBeUndefined();
      startSubagent("a1", "toolu_1", "Build FRT-1 api", "p1");
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-1`]);
    });

    it("caches a sub-agent with no ticket, and reports nothing for it", async () => {
      await dispatch("toolu_1", "Explore the repo", "Find the config loader.");
      startSubagent("a1", "toolu_1", "Explore the repo", "Find the config loader.");
      expect((await toolCall("a1")).sent).toEqual([]);
      expect(agents().readAgent("a1")).toMatchObject({ ticket: null });
      writeFileSync(subagentFile("agent-a1.meta.json"), JSON.stringify({ description: "Build FRT-9", toolUseId: "toolu_x" }));
      expect((await toolCall("a1")).sent).toEqual([]);
    });

    it("lets a nested sub-agent inherit its parent's ticket when its own dispatch names none", async () => {
      await dispatch("toolu_1", "Build FRT-3 api", "p1");
      startSubagent("a1", "toolu_1", "Build FRT-3 api", "p1");
      await toolCall("a1");
      await dispatch("toolu_2", "Implement the change", "Write the code.", { agent_id: "a1", agent_type: "general-purpose" });
      expect(agents().readDispatch("toolu_2")?.ticket).toBe("FRT-3");
    });

    it("writes the mapping but starts no child when Ariadne is not configured", async () => {
      env = {};
      await dispatch("toolu_1", "Build FRT-1 api", "p1");
      startSubagent("a1", "toolu_1", "Build FRT-1 api", "p1");
      expect(await toolCall("a1")).toMatchObject({ sent: [], stdout: 0, stderr: 0 });
      expect(agents().readAgent("a1")?.ticket).toBe("FRT-1");
    });

    it("names the skill a sub-agent loads instead of its agent type, from then on", async () => {
      await dispatch("toolu_1", "Build FRT-1 api", "p1");
      startSubagent("a1", "toolu_1", "Build FRT-1 api", "p1");
      await toolCall("a1", { tool_name: "Skill", tool_input: { skill: "flight-rules:execute-work" } });
      expect(sessions().readInferred(`${claude}-FRT-1`)?.heartbeat.skill).toBe("flight-rules:execute-work");

      now += heartbeatIntervalMs;
      await toolCall("a1");
      expect(sessions().readInferred(`${claude}-FRT-1`)?.heartbeat.skill).toBe("flight-rules:execute-work");
    });

    it("keeps a sub-agent's skill when its background launch maps it after the skill was recorded", async () => {
      await dispatch("toolu_bg", "Build FRT-5678 probe", "p");
      // The sub-agent's Skill hook lands first, from its own process.
      agents().recordAgentSkill("abg", "flight-rules:execute-work");
      await toolCall(undefined, { tool_name: "Agent", tool_use_id: "toolu_bg", tool_response: { status: "async_launched", agentId: "abg" } });
      await toolCall("abg");
      expect(sessions().readInferred(`${claude}-FRT-5678`)?.heartbeat.skill).toBe("flight-rules:execute-work");
    });

    it("keeps the agent type when a Skill call names no skill Ariadne accepts", async () => {
      await dispatch("toolu_1", "Build FRT-1 api", "p1");
      startSubagent("a1", "toolu_1", "Build FRT-1 api", "p1");
      await toolCall("a1", { tool_name: "Skill", tool_input: { skill: "not a skill name" } });
      expect(sessions().readInferred(`${claude}-FRT-1`)?.heartbeat.skill).toBe("general-purpose");
    });
  });

  describe("skill steps win", () => {
    const skillStep = {
      session: `${claude}-FRT-1`,
      ticket: "FRT-1",
      step: "verify 2/3",
      state: "nominal",
      skill: "flight-rules:execute-work",
    } as const;

    beforeEach(async () => {
      await dispatch("toolu_1", "Execute FRT-1", "p1");
      startSubagent("a1", "toolu_1", "Execute FRT-1", "p1");
    });

    it("replays a skill's heartbeat for the sub-agent's session instead of inferring one", async () => {
      sessions().record(skillStep);
      now += heartbeatIntervalMs;
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-1`]);
      expect(sessions().readInferred(`${claude}-FRT-1`)).toBeUndefined();

      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      await run(["board-heartbeat", "--send", `${claude}-FRT-1`], "", transport);
      expect(transport.bodies()).toEqual([skillStep]);
    });

    it("never infers over a skill's step once the skill has posted, even after an inferred heartbeat", async () => {
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-1`]);
      sessions().record(skillStep);
      now += heartbeatIntervalMs;
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-1`]);
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      await run(["board-heartbeat", "--send", `${claude}-FRT-1`], "", transport);
      expect(transport.bodies()).toEqual([skillStep]);
    });

    it("keeps a session an item created for a skill, rather than inferring over it", async () => {
      env = { ...env, CLAUDE_CODE_SESSION_ID: claude };
      const transport = new FakeTransport(
        FakeTransport.json(404, { error: "session_not_found", message: "Send a heartbeat for this session first." }),
        FakeTransport.json(200, { session: contract.session }),
        FakeTransport.json(200, { item: contract.item, created: true }),
      );
      await board(transport).item({ kind: "testable", ticket: "FRT-1", title: "Ready to test" }, { skill: "flight-rules:verify-ticket" });
      now += heartbeatIntervalMs;
      expect((await toolCall("a1")).sent).toEqual([`${claude}-FRT-1`]);
      expect(sessions().readInferred(`${claude}-FRT-1`)).toBeUndefined();
      expect(sessions().read(`${claude}-FRT-1`)?.heartbeat).toMatchObject({ step: "started", skill: "flight-rules:verify-ticket" });
    });

    it("creates a missing session from a skill heartbeat that failed in transit, keeping its verdict", async () => {
      env = { ...env, CLAUDE_CODE_SESSION_ID: claude };
      const verdict = { ...skillStep, step: "qa", state: "abort", skill: "flight-rules:verify-ticket", detail: "2 of 3 failed" } as const;
      sessions().record(verdict);
      const transport = new FakeTransport(
        FakeTransport.json(404, { error: "session_not_found", message: "Send a heartbeat for this session first." }),
        FakeTransport.json(200, { session: contract.session }),
        FakeTransport.json(200, { activity: contract.activity, created: true }),
      );
      await board(transport).activity({ ticket: "FRT-1", text: "Verification failed" }, { skill: "flight-rules:verify-ticket" });
      expect(transport.bodies()[1]).toEqual(verdict);
      expect(sessions().read(`${claude}-FRT-1`)?.heartbeat).toEqual(verdict);
    });

    it("starts a fresh placeholder, not a finished run's old verdict, when the record is over an hour old", async () => {
      env = { ...env, CLAUDE_CODE_SESSION_ID: claude };
      sessions().record({ ...skillStep, step: "qa", state: "abort", skill: "flight-rules:verify-ticket" });
      now += heartbeatMaxAgeMs + 1;
      const transport = new FakeTransport(
        FakeTransport.json(404, { error: "session_not_found", message: "Send a heartbeat for this session first." }),
        FakeTransport.json(200, { session: contract.session }),
        FakeTransport.json(200, { item: contract.item, created: true }),
      );
      await board(transport).item({ kind: "question", ticket: "FRT-1", title: "Open PRs?" }, { skill: "flight-rules:execute-work" });
      const placeholder = { session: `${claude}-FRT-1`, ticket: "FRT-1", step: "started", state: "nominal", skill: "flight-rules:execute-work" };
      expect(transport.bodies()[1]).toEqual(placeholder);
      expect(sessions().read(`${claude}-FRT-1`)?.heartbeat).toEqual(placeholder);
    });

    it("never remembers a placeholder over a recent skill heartbeat", () => {
      sessions().record({ ...skillStep, step: "qa", state: "caution" });
      expect(sessions().recordIfAbsent({ ...skillStep, step: "started" }, heartbeatMaxAgeMs)).toBe(false);
      expect(sessions().read(`${claude}-FRT-1`)?.heartbeat.step).toBe("qa");
    });

    it("sends nothing for an aborted skill run or one quiet for over an hour", async () => {
      sessions().record({ ...skillStep, state: "abort" });
      now += heartbeatIntervalMs;
      expect((await toolCall("a1")).sent).toEqual([]);
      sessions().record(skillStep);
      now += heartbeatMaxAgeMs + 1;
      expect((await toolCall("a1")).sent).toEqual([]);
      expect(sessions().readInferred(`${claude}-FRT-1`)).toBeUndefined();
    });
  });

  describe("main thread", () => {
    it("uses a Jira key in the working directory's name", async () => {
      const result = await toolCall(undefined, { cwd: join(home, "worktrees", "FRT-42-login") });
      expect(result.sent).toEqual([`${claude}-FRT-42`]);
      expect(sessions().readInferred(`${claude}-FRT-42`)?.heartbeat).toEqual({
        session: `${claude}-FRT-42`,
        ticket: "FRT-42",
        step: "working",
        state: "nominal",
      });
    });

    it("names the skill the main thread last loaded", async () => {
      const cwd = join(home, "pd302", "crime-linking-aws-FRT-42");
      await toolCall(undefined, { cwd, tool_name: "Skill", tool_input: { skill: "flight-rules:review-prose" } });
      expect(sessions().readInferred(`${claude}-FRT-42`)?.heartbeat).toEqual({
        session: `${claude}-FRT-42`,
        ticket: "FRT-42",
        step: "working",
        state: "nominal",
        skill: "flight-rules:review-prose",
      });
    });

    it("hands a branch lookup to the child at most once a minute, and the child reports the branch's ticket", async () => {
      expect((await toolCall()).branches).toEqual([{ claudeSession: claude, cwd: join(home, "repo") }]);
      expect((await toolCall()).branches).toEqual([]);

      branchName = "feat/FRT-77-search";
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      await run(["board-heartbeat", "--branch", claude, "--cwd", join(home, "repo")], "", transport);
      expect(transport.bodies()).toEqual([
        { session: `${claude}-FRT-77`, ticket: "FRT-77", step: "working", state: "nominal", branch: "feat/FRT-77-search" },
      ]);
    });

    it("posts nothing from the child when the branch names no ticket", async () => {
      branchName = "main";
      const transport = new FakeTransport();
      await run(["board-heartbeat", "--branch", claude, "--cwd", join(home, "repo")], "", transport);
      expect(transport.requests).toEqual([]);
    });

    it("starts no branch lookup when Ariadne is not configured", async () => {
      env = {};
      expect(await toolCall()).toMatchObject({ sent: [], branches: [], stdout: 0, stderr: 0 });
    });
  });

  describe("SubagentStop", () => {
    it("posts Finished: <description> through the child and forgets the sub-agent", async () => {
      await dispatch("toolu_1", "Build FRT-1234 probe", "p");
      startSubagent("a1", "toolu_1", "Build FRT-1234 probe", "p");
      await toolCall("a1");
      const stop = await subagentStop("a1");
      expect(stop).toMatchObject({ stdout: 0, stderr: 0 });
      expect(stop.finished).toEqual([
        { session: `${claude}-FRT-1234`, ticket: "FRT-1234", text: "Finished: Build FRT-1234 probe", id: "finished-a1" },
      ]);
      expect(agents().readAgent("a1")).toBeUndefined();
      expect(agents().readDispatch("toolu_1")).toBeUndefined();

      const transport = new FakeTransport(FakeTransport.json(200, { activity: contract.activity, created: true }));
      const report = stop.finished[0] as FinishedReport;
      await run(["agent-stop", "--send", report.session, "--ticket", report.ticket, "--text", report.text, "--id", report.id], "", transport);
      expect(transport.bodies()).toEqual([
        { session: `${claude}-FRT-1234`, ticket: "FRT-1234", text: "Finished: Build FRT-1234 probe", id: "finished-a1" },
      ]);
    });

    it("resolves a sub-agent that made no tool calls, and reports nothing for one with no ticket", async () => {
      await dispatch("toolu_1", "Build FRT-8 probe", "p");
      startSubagent("a1", "toolu_1", "Build FRT-8 probe", "p");
      expect((await subagentStop("a1")).finished).toHaveLength(1);

      await dispatch("toolu_2", "Explore", "look around");
      startSubagent("a2", "toolu_2", "Explore", "look around");
      expect((await subagentStop("a2")).finished).toEqual([]);
    });

    it("forgets the sub-agent but posts nothing when Ariadne is not configured", async () => {
      env = {};
      await dispatch("toolu_1", "Build FRT-8 probe", "p");
      startSubagent("a1", "toolu_1", "Build FRT-8 probe", "p");
      await toolCall("a1");
      expect((await subagentStop("a1")).finished).toEqual([]);
      expect(agents().readAgent("a1")).toBeUndefined();
    });
  });

  describe("dispatch records", () => {
    it("records the ticket, description and session keyed by tool_use_id, and prints nothing", async () => {
      expect(await dispatch("toolu_1", "Build FRT-1234 probe", "p")).toMatchObject({ stdout: 0, stderr: 0 });
      expect(agents().readDispatch("toolu_1")).toMatchObject({ ticket: "FRT-1234", description: "Build FRT-1234 probe", session: claude, at: now });
    });

    it("records a dispatch that names no ticket as null", async () => {
      await dispatch("toolu_1", "Explore", "look around");
      expect(agents().readDispatch("toolu_1")?.ticket).toBeNull();
    });

    it("prunes dispatch records older than a day", async () => {
      await dispatch("toolu_old", "Build FRT-1 old", "p");
      const dir = join(sessions().dir(), "dispatch");
      const old = new Date(now - 25 * 60 * 60_000);
      utimesSync(join(dir, "toolu_old.json"), old, old);
      await dispatch("toolu_new", "Build FRT-2 new", "p");
      expect(readdirSync(dir).sort()).toEqual(["toolu_new.json"]);
    });
  });

  it("the detached sender re-runs the CLI with the hook's internal arguments and returns without waiting", async () => {
    const entry = join(home, "entry.mjs");
    const out = join(home, "argv.jsonl");
    writeFileSync(
      entry,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    );
    const sender = new DetachedHeartbeatSender({ entry });
    const started = Date.now();
    sender.send(claude);
    sender.sendBranch(claude, "/repo");
    sender.sendFinished({ session: `${claude}-FRT-1`, ticket: "FRT-1", text: "Finished: Build FRT-1", id: "finished-a1" });
    expect(Date.now() - started).toBeLessThan(500);
    const read = () =>
      existsSync(out)
        ? readFileSync(out, "utf-8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as string[])
        : [];
    await vi.waitFor(() => expect(read()).toHaveLength(3), { timeout: 5000, interval: 50 });
    expect(read()).toEqual(
      expect.arrayContaining([
        ["hook", "board-heartbeat", "--send", claude],
        ["hook", "board-heartbeat", "--branch", claude, "--cwd", "/repo"],
        ["hook", "agent-stop", "--send", `${claude}-FRT-1`, "--ticket", "FRT-1", "--text", "Finished: Build FRT-1", "--id", "finished-a1"],
      ]),
    );
  });
});
