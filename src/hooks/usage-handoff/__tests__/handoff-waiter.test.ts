import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTransport } from "../agent-transport.js";
import { HandoffWaiter } from "../handoff-waiter.js";

const directories: string[] = [];
const now = Date.parse("2026-11-03T14:00:00Z");

class RecordingTransport implements AgentTransport {
  calls: string[] = [];
  onWait: () => void = () => {};
  async spaceOf(): Promise<string | undefined> {
    return undefined;
  }
  async findIdleAgent(): Promise<string | undefined> {
    return undefined;
  }
  async send(terminal: string, text: string): Promise<void> {
    this.calls.push(`send ${terminal} ${text}`);
  }
  async startAgent(): Promise<string> {
    return "";
  }
  async startWaiter(): Promise<string> {
    return "";
  }
  async waitUntilIdle(terminal: string): Promise<void> {
    this.calls.push(`wait ${terminal}`);
    this.onWait();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("HandoffWaiter", () => {
  it("tells the original agent to continue once a short window resets", async () => {
    const transport = new RecordingTransport();
    const done = new HandoffWaiter({ transport }).run({ origin: "t1", resetsAt: now + 5 * 60_000, harness: "claude-code" });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(transport.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;

    expect(transport.calls).toEqual([expect.stringMatching(/^send t1 Usage has reset\. Continue/)]);
  });

  it("collects the stand-in's handback at the reset and sends it to the original terminal", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-waiter-")));
    directories.push(directory);
    const handback = join(directory, "handback.md");
    const transport = new RecordingTransport();
    transport.onWait = () => writeFileSync(handback, "done");
    const done = new HandoffWaiter({ transport }).run({
      origin: "t1",
      standIn: "t9",
      resetsAt: now + 3_600_000,
      handback,
      harness: "claude-code",
    });

    await vi.advanceTimersByTimeAsync(3_599_000);
    expect(transport.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(40_000);
    await done;

    expect(transport.calls).toEqual([
      expect.stringMatching(new RegExp(`^send t9 .*${handback}`)),
      "wait t9",
      expect.stringMatching(new RegExp(`^send t1 .*Codex agent.*${handback}`)),
    ]);
  });

  it("tells the original agent when the stand-in never wrote a handback", async () => {
    const transport = new RecordingTransport();
    const done = new HandoffWaiter({ transport, maxHandbackWaits: 2 }).run({
      origin: "t1",
      standIn: "t9",
      resetsAt: now,
      handback: join(tmpdir(), "flight-rules-no-such-handback.md"),
      harness: "codex",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await done;

    expect(transport.calls.at(-1)).toMatch(/^send t1 .*Claude Code agent in t9 did not write a handback/);
  });

  it("sends the resume message within one chunk after the wall clock jumps past the reset", async () => {
    const transport = new RecordingTransport();
    const done = new HandoffWaiter({ transport }).run({ origin: "t1", resetsAt: now + 3_600_000, harness: "claude-code" });

    vi.setSystemTime(now + 3_600_000 + 30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;

    expect(transport.calls).toEqual([expect.stringMatching(/^send t1 Usage has reset\. Continue/)]);
  });

  it("collects the handback within one chunk after the wall clock jumps past the reset", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-waiter-")));
    directories.push(directory);
    const handback = join(directory, "handback.md");
    const transport = new RecordingTransport();
    transport.onWait = () => writeFileSync(handback, "done");
    const done = new HandoffWaiter({ transport }).run({
      origin: "t1",
      standIn: "t9",
      resetsAt: now + 3_600_000,
      handback,
      harness: "claude-code",
    });

    vi.setSystemTime(now + 3_600_000 + 30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(transport.calls.at(-1)).toMatch(new RegExp(`^send t1 .*${handback}`));
  });

  it("does not accept a handback left over from an earlier window", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-waiter-")));
    directories.push(directory);
    const handback = join(directory, "handback.md");
    writeFileSync(handback, "old");
    const transport = new RecordingTransport();
    const done = new HandoffWaiter({ transport, maxHandbackWaits: 2 }).run({
      origin: "t1",
      standIn: "t9",
      resetsAt: now,
      handback,
      harness: "claude-code",
    });

    await vi.advanceTimersByTimeAsync(30_000 + 10_000);
    await done;

    expect(transport.calls.at(-1)).toMatch(/^send t1 .*did not write a handback/);
  });
});
