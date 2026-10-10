import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AriadneBoard } from "../../../shared/ariadne/ariadne-board.js";
import { AriadneTokenStore } from "../../../shared/ariadne/ariadne-token-store.js";
import { BoardSessionStore } from "../../../shared/ariadne/board-session-store.js";
import { FakeTransport, agentToken, contract } from "../../../shared/ariadne/__tests__/fake-transport.js";
import { createHookCommand } from "../../commands/hook/command.js";
import { BoardHeartbeatHook, DetachedHeartbeatSender, heartbeatIntervalMs } from "../board-heartbeat.js";

// The hook runs after every tool call, so it must be silent, exit 0, never
// wait on the network, and post nothing unless a skill recorded a ticket.

describe("hook board-heartbeat", () => {
  let home: string;
  let now: number;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-board-hook-"));
    now = 5_000_000;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const sessions = () => new BoardSessionStore({ env: {}, home, now: () => now });

  const run = async (argv: string[], stdin: string, transport = new FakeTransport()) => {
    const sent: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const env = { ARIADNE_AGENT_TOKEN: agentToken };
    try {
      await createHookCommand(undefined, () => Promise.resolve(stdin), {
        heartbeatHook: () => new BoardHeartbeatHook({ sessions: sessions() }),
        sender: () => ({ send: (session: string) => sent.push(session) }),
        board: () =>
          new AriadneBoard({
            readLayers: () => [],
            tokens: new AriadneTokenStore({ env, home }),
            env,
            transport,
            sessions: sessions(),
          }),
      })
        .exitOverride()
        .parseAsync(argv, { from: "user" });
      return { sent, stdout: stdout.mock.calls.length, stderr: stderr.mock.calls.length };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  };

  const payload = JSON.stringify({ session_id: "claude-session-1", hook_event_name: "PostToolUse", tool_name: "Bash" });

  it("does nothing, silently, when no skill has reported a ticket for the session", async () => {
    expect(await run(["board-heartbeat"], payload)).toEqual({ sent: [], stdout: 0, stderr: 0 });
  });

  it("does nothing on bad stdin", async () => {
    expect(await run(["board-heartbeat"], "{not json")).toEqual({ sent: [], stdout: 0, stderr: 0 });
    expect(await run(["board-heartbeat"], "{}")).toEqual({ sent: [], stdout: 0, stderr: 0 });
  });

  it("hands a due session to the detached sender at most once a minute", async () => {
    sessions().record({ session: "claude-session-1", ticket: "FRT-1", step: "verify 2/3", state: "nominal" });
    now += heartbeatIntervalMs;
    expect((await run(["board-heartbeat"], payload)).sent).toEqual(["claude-session-1"]);
    now += 10_000;
    expect((await run(["board-heartbeat"], payload)).sent).toEqual([]);
    now += heartbeatIntervalMs;
    expect((await run(["board-heartbeat"], payload)).sent).toEqual(["claude-session-1"]);
  });

  it("--send replays the skill's last heartbeat, keeping its step", async () => {
    sessions().record({ session: "claude-session-1", ticket: "FRT-1", step: "verify 2/3", state: "caution" });
    const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
    expect(await run(["board-heartbeat", "--send", "claude-session-1"], "", transport)).toMatchObject({ stdout: 0, stderr: 0 });
    expect(transport.bodies()).toEqual([{ session: "claude-session-1", ticket: "FRT-1", step: "verify 2/3", state: "caution" }]);
  });

  it("the detached sender re-runs the CLI with --send and returns without waiting", async () => {
    const entry = join(home, "entry.mjs");
    const out = join(home, "argv.json");
    writeFileSync(entry, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`);
    const started = Date.now();
    new DetachedHeartbeatSender({ entry }).send("claude-session-1");
    expect(Date.now() - started).toBeLessThan(500);
    await vi.waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 5000, interval: 50 });
    await vi.waitFor(() => expect(JSON.parse(readFileSync(out, "utf-8"))).toEqual(["hook", "board-heartbeat", "--send", "claude-session-1"]), {
      timeout: 5000,
      interval: 50,
    });
  });

  it("--send stays silent when the post fails", async () => {
    sessions().record({ session: "claude-session-1", ticket: "FRT-1", step: "pr", state: "nominal" });
    const transport = new FakeTransport(FakeTransport.json(401, { error: "unauthorized" }));
    expect(await run(["board-heartbeat", "--send", "claude-session-1"], "", transport)).toMatchObject({ stdout: 0, stderr: 0 });
  });
});
