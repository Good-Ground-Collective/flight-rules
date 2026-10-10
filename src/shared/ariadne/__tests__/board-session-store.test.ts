import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardSessionStore } from "../board-session-store.js";

describe("BoardSessionStore", () => {
  let home: string;
  let now: number;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-board-sessions-"));
    now = 1_000_000;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const store = (env: Record<string, string | undefined> = {}) => new BoardSessionStore({ env, home, now: () => now });
  const heartbeat = { session: "s1", ticket: "FRT-1", step: "implement", state: "nominal" } as const;

  it("lives in the user's state directory, never the repo", () => {
    expect(store().dir()).toBe(join(home, ".local", "state", "flight-rules", "board"));
    expect(store({ XDG_STATE_HOME: join(home, "xdg") }).dir()).toBe(join(home, "xdg", "flight-rules", "board"));
  });

  it("records a heartbeat with mode 0600 and drops empty fields", () => {
    store().record({ ...heartbeat, branch: "", detail: undefined });
    expect(store().read("s1")).toEqual({ heartbeat, recordedAt: now, sentAt: now });
    const [file] = readdirSync(store().dir());
    expect(statSync(join(store().dir(), file ?? "")).mode & 0o777).toBe(0o600);
  });

  it("claims at most once per interval", () => {
    store().record(heartbeat);
    expect(store().claim("s1", 60_000, 3_600_000)).toBeUndefined();
    now += 60_000;
    expect(store().claim("s1", 60_000, 3_600_000)?.sentAt).toBe(now);
    now += 30_000;
    expect(store().claim("s1", 60_000, 3_600_000)).toBeUndefined();
  });

  it("stops keeping a session alive once the skill has been quiet too long", () => {
    store().record(heartbeat);
    now += 3_600_001;
    expect(store().claim("s1", 60_000, 3_600_000)).toBeUndefined();
  });

  it("never keeps an aborted run alive", () => {
    store().record({ ...heartbeat, state: "abort" });
    now += 120_000;
    expect(store().claim("s1", 60_000, 3_600_000)).toBeUndefined();
  });

  it("ignores session ids that are not safe file names, and unreadable records", () => {
    store().record({ ...heartbeat, session: "../escape" });
    expect(store().read("../escape")).toBeUndefined();
    store().record(heartbeat);
    writeFileSync(join(store().dir(), "s1.json"), "{not json");
    expect(store().claim("s1", 0, 3_600_000)).toBeUndefined();
  });
});
