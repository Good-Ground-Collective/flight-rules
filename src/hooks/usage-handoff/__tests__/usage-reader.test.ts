import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachedUsageReader, ClaudeCodeUsageReader, CodexUsageReader, type UsageReader } from "../usage-reader.js";
import { UsageSnapshot } from "../usage-snapshot.js";

const directories: string[] = [];
const temporary = (): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-usage-reader-")));
  directories.push(directory);
  return directory;
};

const respondWith = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ClaudeCodeUsageReader", () => {
  const homeWithToken = (): string => {
    const home = temporary();
    mkdirSync(join(home, ".claude"));
    writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "secret" } }));
    return home;
  };

  it("reads both windows with the OAuth token and beta header", async () => {
    respondWith({
      five_hour: { utilization: 42.5, resets_at: "2026-11-03T18:00:00.000000+00:00" },
      seven_day: { utilization: 61, resets_at: "2026-11-08T20:00:00Z" },
    });

    const snapshot = await new ClaudeCodeUsageReader({ home: homeWithToken(), platform: "linux" }).read();

    expect(snapshot?.windows).toEqual([
      { kind: "session", percent: 42.5, resetsAt: Date.parse("2026-11-03T18:00:00Z") },
      { kind: "weekly", percent: 61, resetsAt: Date.parse("2026-11-08T20:00:00Z") },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({ headers: { Authorization: "Bearer secret", "anthropic-beta": "oauth-2025-04-20" } }),
    );
  });

  it("accepts a null window", async () => {
    respondWith({ five_hour: null, seven_day: { utilization: 3, resets_at: "2026-11-08T20:00:00Z" } });

    const snapshot = await new ClaudeCodeUsageReader({ home: homeWithToken(), platform: "linux" }).read();

    expect(snapshot?.windows.map((window) => window.kind)).toEqual(["weekly"]);
  });

  it("returns nothing when the request is refused", async () => {
    respondWith({}, false);
    expect(await new ClaudeCodeUsageReader({ home: homeWithToken(), platform: "linux" }).read()).toBeUndefined();
  });

  it("returns nothing when the response has an unexpected shape", async () => {
    respondWith({ five_hour: { utilization: "lots" } });
    expect(await new ClaudeCodeUsageReader({ home: homeWithToken(), platform: "linux" }).read()).toBeUndefined();
  });

  it("returns nothing without credentials", async () => {
    respondWith({});
    expect(await new ClaudeCodeUsageReader({ home: temporary(), platform: "linux" }).read()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("CodexUsageReader", () => {
  const codexHome = (): string => {
    const home = temporary();
    writeFileSync(join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "secret", account_id: "acct" } }));
    return home;
  };

  it("classifies windows by length rather than by primary or secondary", async () => {
    respondWith({
      rate_limit: {
        primary_window: { used_percent: 70, limit_window_seconds: 604800, reset_at: 1793799559 },
        secondary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1793757600 },
      },
    });

    const snapshot = await new CodexUsageReader({ env: { CODEX_HOME: codexHome() } }).read();

    expect(snapshot?.windows).toEqual([
      { kind: "weekly", percent: 70, resetsAt: 1793799559000 },
      { kind: "session", percent: 12, resetsAt: 1793757600000 },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret", "ChatGPT-Account-Id": "acct", "User-Agent": "codex-cli" },
      }),
    );
  });

  it("falls back to the newest session rollout's rate limits", async () => {
    respondWith({}, false);
    const home = codexHome();
    const day = join(home, "sessions", "2026", "11", "03");
    mkdirSync(day, { recursive: true });
    const limits = (used: number) =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: used, window_minutes: 300, resets_at: 1793757600 },
            secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1793799559 },
          },
        },
      });
    writeFileSync(join(day, "rollout-2026-11-03T10-00-00-a.jsonl"), limits(1) + "\n");
    writeFileSync(join(day, "rollout-2026-11-03T12-00-00-b.jsonl"), [limits(50), limits(96), '{"type":"other"}'].join("\n") + "\n");

    const snapshot = await new CodexUsageReader({ env: { CODEX_HOME: home } }).read();

    expect(snapshot?.windows).toEqual([
      { kind: "session", percent: 96, resetsAt: 1793757600000 },
      { kind: "weekly", percent: 20, resetsAt: 1793799559000 },
    ]);
  });

  it("returns nothing when neither source is available", async () => {
    respondWith({}, false);
    expect(await new CodexUsageReader({ env: { CODEX_HOME: temporary() } }).read()).toBeUndefined();
  });
});

describe("CachedUsageReader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-03T14:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const countingReader = (): UsageReader & { reads: number } => ({
    reads: 0,
    async read() {
      this.reads += 1;
      return new UsageSnapshot([{ kind: "session", percent: this.reads, resetsAt: Date.now() + 3_600_000 }]);
    },
  });

  it("reuses a read for a minute, then reads again", async () => {
    const inner = countingReader();
    const cached = new CachedUsageReader({ harness: "codex", reader: inner, folder: temporary() });

    await cached.read();
    vi.advanceTimersByTime(59_000);
    expect((await cached.read())?.windows[0]?.percent).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect((await cached.read())?.windows[0]?.percent).toBe(2);
    expect(inner.reads).toBe(2);
  });

  it("does not cache a failed read", async () => {
    const failing: UsageReader = { read: async () => undefined };
    const folder = temporary();
    expect(await new CachedUsageReader({ harness: "codex", reader: failing, folder }).read()).toBeUndefined();

    const inner = countingReader();
    await new CachedUsageReader({ harness: "codex", reader: inner, folder }).read();
    expect(inner.reads).toBe(1);
  });
});
