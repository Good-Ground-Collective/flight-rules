import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardSessionStore, ticketSessionKey } from "../board-session-store.js";

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

  it("tells a skill record within a window from a live one", () => {
    store().record({ ...heartbeat, state: "abort" });
    expect([store().hasSkillRecord("s1", 1000), store().isLive("s1", 1000)]).toEqual([true, false]);
    store().record(heartbeat);
    now += 1001;
    expect([store().hasSkillRecord("s1", 1000), store().isLive("s1", 1000)]).toEqual([false, false]);
    expect(store().hasSkillRecord("missing", 1000)).toBe(false);
  });

  it("claims an inferred heartbeat at most once per interval, apart from skill records", () => {
    const inferred = { session: "s1", ticket: "FRT-1", step: "Build FRT-1", state: "nominal", skill: "general-purpose" } as const;
    expect(store().claimInferred(inferred, 60_000)).toBe(true);
    expect(store().readInferred("s1")).toEqual({ heartbeat: inferred, sentAt: now });
    expect(store().read("s1")).toBeUndefined();
    now += 59_999;
    expect(store().claimInferred(inferred, 60_000)).toBe(false);
    now += 1;
    expect(store().claimInferred(inferred, 60_000)).toBe(true);
  });

  it("points a Claude Code session at its skill session and throttles its branch lookups", () => {
    expect(store().threadSession("c1")).toBeUndefined();
    store().pointThread("c1", "c1-FRT-1");
    expect(store().claimBranchCheck("c1", 60_000)).toBe(true);
    expect(store().claimBranchCheck("c1", 60_000)).toBe(false);
    expect(store().threadSession("c1")).toBe("c1-FRT-1");
    now += 60_000;
    expect(store().claimBranchCheck("c1", 60_000)).toBe(true);
  });

  it("prunes inferred and thread records untouched for the given age, keeping skill records", () => {
    store().record(heartbeat);
    store().claimInferred({ ...heartbeat, session: "old" }, 0);
    store().pointThread("c-old", "old");
    const old = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(join(store().dir(), "inferred", "old.json"), old, old);
    utimesSync(join(store().dir(), "threads", "c-old.json"), old, old);
    utimesSync(join(store().dir(), "s1.json"), old, old);
    store().claimInferred({ ...heartbeat, session: "fresh" }, 0);
    new BoardSessionStore({ env: {}, home }).prune(86_400_000);
    expect(readdirSync(join(store().dir(), "inferred"))).toEqual(["fresh.json"]);
    expect(readdirSync(join(store().dir(), "threads"))).toEqual([]);
    expect(store().read("s1")).toBeDefined();
  });
});

describe("TicketSessionKey", () => {
  it("joins the Claude Code session and the ticket", () => {
    expect(ticketSessionKey.key("0f9a7c4e-1b2c", "FRT-1234")).toBe("0f9a7c4e-1b2c-FRT-1234");
  });

  it("keeps the API's alphabet and 80 characters, cutting the session part and never the ticket", () => {
    const key = ticketSessionKey.key(`${"b".repeat(100)}`, "ABCDEFGHIJ-123456789");
    expect(key).toBe(`${"b".repeat(59)}-ABCDEFGHIJ-123456789`);
    expect(key).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
    expect(ticketSessionKey.key("a.b/c", "FRT-1")).toBe("a_b_c-FRT-1");
    expect(ticketSessionKey.key(" ", "FRT-1")).toBeUndefined();
  });
});
