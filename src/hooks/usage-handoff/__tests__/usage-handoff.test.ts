import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTransport, StartedAgent } from "../agent-transport.js";
import { HandoffStore } from "../handoff-store.js";
import { UsageHandoffHook } from "../usage-handoff.js";
import type { UsageReader } from "../usage-reader.js";
import { UsageSnapshot, type UsageHarness, type UsageWindow } from "../usage-snapshot.js";

const directories: string[] = [];
const temporary = (): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-usage-handoff-")));
  directories.push(directory);
  return directory;
};

const now = Date.parse("2026-11-03T14:00:00Z");
const hours = (count: number): number => now + count * 3_600_000;
const minutes = (count: number): number => now + count * 60_000;

class FakeReader implements UsageReader {
  constructor(public windows: UsageWindow[] | undefined) {}
  async read(): Promise<UsageSnapshot | undefined> {
    return this.windows === undefined ? undefined : new UsageSnapshot(this.windows);
  }
}

class FakeTransport implements AgentTransport {
  calls: string[] = [];
  space: string | undefined = "sp1";
  idle: string | undefined;

  async spaceOf(terminal: string): Promise<string | undefined> {
    this.calls.push(`spaceOf ${terminal}`);
    return this.space;
  }
  async findIdleAgent(space: string, harness: UsageHarness, except: string): Promise<string | undefined> {
    this.calls.push(`findIdleAgent ${space} ${harness} ${except}`);
    return this.idle;
  }
  async send(terminal: string, text: string): Promise<void> {
    this.calls.push(`send ${terminal} ${text}`);
  }
  async startAgent(agent: StartedAgent): Promise<string> {
    this.calls.push(`startAgent ${agent.harness} ${agent.space} ${agent.prompt}`);
    return "t-new";
  }
  async startWaiter(space: string | undefined, _cwd: string, args: readonly string[]): Promise<string> {
    this.calls.push(`startWaiter ${space} ${args.join(" ")}`);
    return "t-wait";
  }
  async waitUntilIdle(): Promise<void> {}
}

const session = { session_id: "s1", cwd: "/work", hook_event_name: "Stop" };

const setup = (env: Record<string, string | undefined> = { HC_TERMINAL_ID: "t1" }) => {
  const state = temporary();
  const fullEnv = { XDG_STATE_HOME: state, ...env };
  const reader = new FakeReader([{ kind: "session", percent: 96, resetsAt: hours(3) }]);
  const other = new FakeReader([{ kind: "session", percent: 10, resetsAt: hours(2) }]);
  const transport = new FakeTransport();
  const store = new HandoffStore({ env: fullEnv });
  const hook = new UsageHandoffHook({
    readers: { "claude-code": reader, codex: other },
    transport,
    store,
    settings: { usageHandoffThreshold: 95, usageHandoffMinResetMinutes: 10 },
    env: fullEnv,
  });
  const writeHandoff = (): string => {
    const path = store.handoffPath("claude-code", "s1");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "handoff");
    return path;
  };
  return { hook, reader, other, transport, store, writeHandoff, state };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("UsageHandoffHook", () => {
  it("does nothing below the threshold", async () => {
    const { hook, reader, transport } = setup();
    reader.windows = [{ kind: "session", percent: 94.9, resetsAt: hours(3) }];

    expect(await hook.handle("claude-code", session)).toBeUndefined();
    expect(transport.calls).toEqual([]);
  });

  it("does nothing when the usage read fails", async () => {
    const { hook, reader } = setup();
    reader.windows = undefined;

    expect(await hook.handle("claude-code", session)).toBeUndefined();
  });

  it("ignores payloads without a session id", async () => {
    const { hook } = setup();
    expect(await hook.handle("claude-code", {})).toBeUndefined();
  });

  it("blocks Stop once with the handoff instruction and a file path under the state folder", async () => {
    const { hook, store, state } = setup();

    const output = await hook.handle("claude-code", session);

    const path = store.handoffPath("claude-code", "s1");
    expect(path).toBe(join(state, "flight-rules", "handoffs", "claude-code-s1.md"));
    expect(output).toMatchObject({ decision: "block", reason: expect.stringContaining(path) });
    expect(output).toMatchObject({ reason: expect.stringContaining(new Date(hours(3)).toISOString()) });
  });

  it("triggers on the weekly window when it is the busier one", async () => {
    const { hook, reader } = setup();
    reader.windows = [
      { kind: "session", percent: 40, resetsAt: hours(2) },
      { kind: "weekly", percent: 97, resetsAt: hours(100) },
    ];

    expect(await hook.handle("claude-code", session)).toMatchObject({
      decision: "block",
      reason: expect.stringContaining(new Date(hours(100)).toISOString()),
    });
  });

  it("delivers the written handoff to an idle agent of the other harness and starts the waiter", async () => {
    const { hook, transport, writeHandoff, store } = setup();
    transport.idle = "t9";
    await hook.handle("claude-code", session);
    const path = writeHandoff();

    const output = await hook.handle("claude-code", session);

    expect(transport.calls).toEqual([
      "spaceOf t1",
      "findIdleAgent sp1 codex t1",
      expect.stringMatching(new RegExp(`^send t9 .*${path}`)),
      `startWaiter sp1 handoff wait --origin t1 --stand-in t9 --at ${hours(3)} --handback ${store.handbackPath("claude-code", "s1")} --harness claude-code`,
    ]);
    expect(output).toMatchObject({ systemMessage: expect.stringContaining("t9") });
    expect(store.read("claude-code", "s1")).toMatchObject({ phase: "delivered", standIn: "t9", waiter: "t-wait" });
  });

  it("starts an agent of the other harness in the same space when none is idle", async () => {
    const { hook, transport, writeHandoff } = setup();
    await hook.handle("claude-code", session);
    writeHandoff();

    await hook.handle("claude-code", session);

    expect(transport.calls[2]).toMatch(/^startAgent codex sp1 /);
    expect(transport.calls[3]).toContain("--stand-in t-new");
  });

  it("hands off only once per session and window", async () => {
    const { hook, transport, writeHandoff } = setup();
    await hook.handle("claude-code", session);
    writeHandoff();
    await hook.handle("claude-code", session);
    const calls = transport.calls.length;

    expect(await hook.handle("claude-code", session)).toBeUndefined();
    expect(transport.calls).toHaveLength(calls);
  });

  it("hands off again once the earlier window has reset", async () => {
    const { hook, reader } = setup();
    await hook.handle("claude-code", session);

    vi.setSystemTime(hours(4));
    reader.windows = [{ kind: "session", percent: 99, resetsAt: hours(9) }];

    expect(await hook.handle("claude-code", session)).toMatchObject({ decision: "block" });
  });

  it("does not block again when the agent never wrote the handoff file", async () => {
    const { hook, transport } = setup();
    await hook.handle("claude-code", session);

    expect(await hook.handle("claude-code", session)).toBeUndefined();
    expect(transport.calls).toEqual([]);
    expect(await hook.handle("claude-code", session)).toBeUndefined();
  });

  it("skips the handoff when the reset is closer than the cutoff and the waiter wakes the original agent", async () => {
    const { hook, reader, transport } = setup();
    reader.windows = [{ kind: "session", percent: 99, resetsAt: minutes(9) }];

    const output = await hook.handle("claude-code", session);

    expect(output).not.toHaveProperty("decision");
    expect(transport.calls).toEqual([
      "spaceOf t1",
      `startWaiter sp1 handoff wait --origin t1 --at ${minutes(9)} --harness claude-code`,
    ]);
  });

  it("hands off when the reset is exactly at the cutoff", async () => {
    const { hook, reader } = setup();
    reader.windows = [{ kind: "session", percent: 99, resetsAt: minutes(10) }];

    expect(await hook.handle("claude-code", session)).toMatchObject({ decision: "block" });
  });

  it("honors configured threshold and cutoff", async () => {
    const state = temporary();
    const env = { XDG_STATE_HOME: state, HC_TERMINAL_ID: "t1" };
    const hook = new UsageHandoffHook({
      readers: {
        "claude-code": new FakeReader([{ kind: "session", percent: 80, resetsAt: minutes(25) }]),
        codex: new FakeReader([]),
      },
      transport: new FakeTransport(),
      store: new HandoffStore({ env }),
      settings: { usageHandoffThreshold: 75, usageHandoffMinResetMinutes: 30 },
      env,
    });

    expect(await hook.handle("claude-code", session)).not.toHaveProperty("decision");
  });

  it("notifies instead of handing off when the other harness is also over its threshold", async () => {
    const { hook, other, transport } = setup();
    other.windows = [{ kind: "weekly", percent: 96, resetsAt: hours(50) }];

    const output = await hook.handle("claude-code", session);

    expect(output).toMatchObject({ systemMessage: expect.stringContaining("not handed off") });
    expect(output).not.toHaveProperty("decision");
    expect(transport.calls).toEqual([]);
    expect(await hook.handle("claude-code", session)).toBeUndefined();
  });

  it("still hands off when the other harness's usage can't be read", async () => {
    const { hook, other } = setup();
    other.windows = undefined;

    expect(await hook.handle("claude-code", session)).toMatchObject({ decision: "block" });
  });

  it("outside hc only writes the handoff file and reports its path", async () => {
    const { hook, transport, writeHandoff } = setup({});
    expect(await hook.handle("claude-code", session)).toMatchObject({ decision: "block" });
    const path = writeHandoff();

    const output = await hook.handle("claude-code", session);

    expect(output).toMatchObject({ systemMessage: expect.stringContaining(path) });
    expect(transport.calls).toEqual([]);
  });

  it("outside hc does nothing for a short window", async () => {
    const { hook, reader, transport } = setup({});
    reader.windows = [{ kind: "session", percent: 99, resetsAt: minutes(5) }];

    expect(await hook.handle("claude-code", session)).toBeUndefined();
    expect(transport.calls).toEqual([]);
  });

  it("falls back to reporting the path when hc fails", async () => {
    const { hook, transport, writeHandoff } = setup();
    transport.spaceOf = () => Promise.reject(new Error("hc missing"));
    await hook.handle("claude-code", session);
    const path = writeHandoff();

    expect(await hook.handle("claude-code", session)).toMatchObject({ systemMessage: expect.stringContaining(path) });
  });

  it("does not borrow an agent when the terminal has no space", async () => {
    const { hook, transport, writeHandoff } = setup();
    transport.space = undefined;
    await hook.handle("claude-code", session);
    const path = writeHandoff();

    expect(await hook.handle("claude-code", session)).toMatchObject({ systemMessage: expect.stringContaining(path) });
    expect(transport.calls.some((call) => call.startsWith("send") || call.startsWith("startAgent"))).toBe(false);
  });

  it("works the same from Codex", async () => {
    const { hook, other, reader } = setup();
    other.windows = [{ kind: "session", percent: 97, resetsAt: hours(3) }];
    reader.windows = [{ kind: "session", percent: 1, resetsAt: hours(3) }];

    const output = await hook.handle("codex", session);

    expect(output).toMatchObject({ decision: "block", reason: expect.stringContaining("codex-s1.md") });
  });
});
