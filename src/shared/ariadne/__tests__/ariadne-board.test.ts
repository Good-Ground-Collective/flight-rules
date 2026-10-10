import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriadneBoard } from "../ariadne-board.js";
import { AriadneTokenStore } from "../ariadne-token-store.js";
import { defaultAriadneUrl } from "../ariadne.schema.js";
import { FakeTransport, agentToken, contract } from "./fake-transport.js";

describe("AriadneBoard", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-board-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const board = (
    transport: FakeTransport,
    {
      config = {},
      env = { ARIADNE_AGENT_TOKEN: agentToken, CLAUDE_CODE_SESSION_ID: "claude-session-1" },
    }: { config?: Record<string, unknown>; env?: Record<string, string | undefined> } = {},
  ) =>
    new AriadneBoard({
      readConfig: () => config,
      tokens: new AriadneTokenStore({ env, home }),
      env,
      transport,
    });

  const heartbeat = { ticket: "FRT-1", step: "implement", state: "nominal" } as const;

  describe("config resolution", () => {
    it("defaults to the production URL and enabled", () => {
      expect(board(new FakeTransport()).settings()).toEqual({ url: defaultAriadneUrl, enabled: true });
    });

    it("reads ariadne.url and ariadne.enabled from the merged config", () => {
      const settings = board(new FakeTransport(), {
        config: { tracker: "jira", "ariadne.url": "http://localhost:8080", "ariadne.enabled": false },
      }).settings();
      expect(settings).toEqual({ url: "http://localhost:8080", enabled: false });
    });

    it("posts to the configured URL", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      await board(transport, {
        config: { "ariadne.url": "http://localhost:8080/" },
        env: { ARIADNE_AGENT_TOKEN: agentToken },
      }).heartbeat({ ...heartbeat, session: "s1" });
      expect(transport.requests[0]?.url).toBe("http://localhost:8080/v1/agents/heartbeat");
    });

    it("fails, rather than throws, on an invalid URL", async () => {
      const outcome = await board(new FakeTransport(), { config: { "ariadne.url": "not a url" } }).heartbeat(heartbeat);
      expect(outcome).toMatchObject({ status: "failed" });
      expect(outcome.status === "failed" && outcome.message).toContain("ariadne.url");
    });
  });

  describe("no-op path", () => {
    it("skips without a request when disabled, even under strict", async () => {
      const transport = new FakeTransport();
      const outcome = await board(transport, { config: { "ariadne.enabled": false } }).heartbeat(heartbeat, { strict: true });
      expect(outcome).toEqual({ status: "skipped", reason: "disabled" });
      expect(transport.requests).toHaveLength(0);
    });

    it("skips without a request when no token is found", async () => {
      const transport = new FakeTransport();
      const quiet = board(transport, { env: { CLAUDE_CODE_SESSION_ID: "s1" } });
      expect(await quiet.heartbeat(heartbeat)).toEqual({ status: "skipped", reason: "no-token" });
      expect(await quiet.item({ kind: "question", ticket: "FRT-1", title: "t" })).toEqual({ status: "skipped", reason: "no-token" });
      expect(await quiet.activity({ ticket: "FRT-1", text: "t" })).toEqual({ status: "skipped", reason: "no-token" });
      expect(await quiet.items(undefined)).toEqual({ status: "skipped", reason: "no-token" });
      expect(transport.requests).toHaveLength(0);
    });

    it("under strict, posts without a token so the API's 401 surfaces", async () => {
      const transport = new FakeTransport(FakeTransport.json(401, { error: "unauthorized" }));
      const outcome = await board(transport, { env: { CLAUDE_CODE_SESSION_ID: "s1" } }).heartbeat(heartbeat, { strict: true });
      expect(transport.requests[0]?.headers).not.toHaveProperty("Authorization");
      expect(outcome).toMatchObject({ status: "failed" });
      expect(outcome.status === "failed" && outcome.message).toContain("no Ariadne token (401 unauthorized)");
    });
  });

  describe("sessions", () => {
    it("defaults the session to $CLAUDE_CODE_SESSION_ID", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      await board(transport).heartbeat(heartbeat);
      expect(transport.bodies()[0]).toMatchObject({ session: "claude-session-1" });
    });

    it("prefers an explicit session", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { items: [] }));
      await board(transport).items("explicit");
      expect(transport.requests[0]?.url).toContain("?session=explicit");
    });

    it("fails without a request when there is no session id", async () => {
      const transport = new FakeTransport();
      const outcome = await board(transport, { env: { ARIADNE_AGENT_TOKEN: agentToken } }).heartbeat(heartbeat);
      expect(outcome).toMatchObject({ status: "failed" });
      expect(outcome.status === "failed" && outcome.message).toContain("--session");
      expect(transport.requests).toHaveLength(0);
    });

    it("sends an item straight away when the session exists, never overwriting its step", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { item: contract.item, created: true }));
      await board(transport).item({ kind: "question", ticket: "FRT-1", title: "Patch or revert?" });
      expect(transport.requests.map((r) => r.url)).toEqual([`${defaultAriadneUrl}/v1/agents/items`]);
    });

    it.each([
      ["item", (b: AriadneBoard) => b.item({ kind: "testable", ticket: "frt-1", title: "Fix is on staging" }), "/v1/agents/items"],
      ["activity", (b: AriadneBoard) => b.activity({ ticket: "frt-1", text: "Opened PR #86" }), "/v1/agents/activity"],
    ] as const)("sends a heartbeat first when the %s's session does not exist yet", async (_kind, post, path) => {
      const transport = new FakeTransport(
        FakeTransport.json(404, { error: "session_not_found", message: "Send a heartbeat for this session first." }),
        FakeTransport.json(200, { session: contract.session }),
        path === "/v1/agents/items"
          ? FakeTransport.json(200, { item: contract.item, created: true })
          : FakeTransport.json(200, { activity: contract.activity, created: true }),
      );
      const outcome = await post(board(transport));
      expect(outcome.status).toBe("posted");
      expect(transport.requests.map((r) => r.url.replace(defaultAriadneUrl, ""))).toEqual([path, "/v1/agents/heartbeat", path]);
      expect(transport.bodies()[1]).toEqual({ session: "claude-session-1", ticket: "FRT-1", step: "started", state: "nominal" });
    });

    it("does not loop when the session is still missing after the heartbeat", async () => {
      const missing = FakeTransport.json(404, { error: "session_not_found", message: "Send a heartbeat first." });
      const transport = new FakeTransport(missing, FakeTransport.json(200, { session: contract.session }), missing);
      const outcome = await board(transport).activity({ ticket: "FRT-1", text: "x" });
      expect(outcome.status).toBe("failed");
      expect(transport.requests).toHaveLength(3);
    });
  });

  describe("failures", () => {
    it("names the setting to change when Agents is off", async () => {
      const transport = new FakeTransport(
        FakeTransport.json(403, { error: "agents_opt_in_required", message: "Turn on Agents in Ariadne’s Connections settings first." }),
      );
      const outcome = await board(transport).heartbeat(heartbeat);
      expect(outcome).toEqual({
        status: "failed",
        message: "Agents reporting is off for you (403 agents_opt_in_required). Turn on Agents in Ariadne › Settings › Connections",
      });
    });

    it("explains an unrecognised token without printing it", async () => {
      const outcome = await board(new FakeTransport(FakeTransport.json(401, { error: "unauthorized" }))).heartbeat(heartbeat);
      expect(outcome.status === "failed" && outcome.message).toContain("Ariadne agent token not recognised (401 unauthorized)");
      expect(JSON.stringify(outcome)).not.toContain(agentToken);
    });

    it("tells the person to replace an expired token, separately from an unrecognised one", async () => {
      const outcome = await board(new FakeTransport(FakeTransport.json(401, { error: "agent_token_expired" }))).heartbeat(heartbeat);
      expect(outcome).toEqual({
        status: "failed",
        message:
          "Ariadne agent token expired (401 agent_token_expired) — create a new one in Ariadne › Settings › Connections and run `flight-rules board login`",
      });
    });

    it("surfaces a 403 agent_token_cannot_decide as a plain failure", async () => {
      const transport = new FakeTransport(
        FakeTransport.json(403, { error: "agent_token_cannot_decide", message: "Agent tokens cannot answer items." }),
      );
      const outcome = await board(transport).items("s1");
      expect(outcome).toEqual({ status: "failed", message: "Ariadne returned 403 agent_token_cannot_decide Agent tokens cannot answer items." });
    });

    it("redacts the token if a server message ever echoes it", async () => {
      const transport = new FakeTransport(FakeTransport.json(422, { error: "invalid_input", message: `Check ${agentToken}.` }));
      const outcome = await board(transport).heartbeat(heartbeat);
      expect(outcome).toEqual({ status: "failed", message: "Ariadne returned 422 invalid_input Check [redacted]." });
    });

    it("reports an unreachable API after the retry", async () => {
      const offline = new TypeError("fetch failed");
      const outcome = await board(new FakeTransport(offline, offline)).heartbeat(heartbeat);
      expect(outcome.status === "failed" && outcome.message).toBe(
        `could not reach Ariadne at ${defaultAriadneUrl}: no response from ${defaultAriadneUrl} after 2 attempts (fetch failed)`,
      );
    });

    it("reports invalid input without a request", async () => {
      const transport = new FakeTransport();
      const outcome = await board(transport).heartbeat({ ...heartbeat, ticket: "not a key" });
      expect(outcome.status === "failed" && outcome.message).toContain("invalid heartbeat: ticket");
      expect(transport.requests).toHaveLength(0);
    });
  });
});
