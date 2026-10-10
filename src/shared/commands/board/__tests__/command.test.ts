import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AriadneBoard } from "../../../ariadne/ariadne-board.js";
import { AriadneTokenStore } from "../../../ariadne/ariadne-token-store.js";
import { defaultAriadneUrl } from "../../../ariadne/ariadne.schema.js";
import { FakeTransport, agentToken, contract } from "../../../ariadne/__tests__/fake-transport.js";
import { createBoardCommand } from "../command.js";

// The board must never break the hook or skill that calls it: not configured
// or disabled prints nothing and exits 0, a failure is one stderr line and
// exit 0, and only --strict turns a failure into exit 1 (a rejected parse).

describe("board command", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-board-cmd-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const signedIn = { ARIADNE_AGENT_TOKEN: agentToken, CLAUDE_CODE_SESSION_ID: "claude-session-1" };

  const run = async (
    argv: string[],
    {
      transport = new FakeTransport(),
      env = signedIn,
      config = {},
      project = {},
      secret = "",
    }: {
      transport?: FakeTransport;
      env?: Record<string, string | undefined>;
      /** User-scope values. */
      config?: Record<string, unknown>;
      /** Committed project-scope values. */
      project?: Record<string, unknown>;
      secret?: string;
    } = {},
  ): Promise<{ stdout: string; stderr: string }> => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tokens = new AriadneTokenStore({ env, home });
    const readLayers = () => [
      { scope: "user" as const, values: config },
      { scope: "project" as const, values: project },
    ];
    try {
      await createBoardCommand(
        () => new AriadneBoard({ readLayers, tokens, env, transport }),
        () => tokens,
        () => Promise.resolve(secret),
      )
        .exitOverride()
        .parseAsync(argv, { from: "user" });
      return {
        stdout: stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
        stderr: stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
      };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  };

  const heartbeatArgs = ["post", "heartbeat", "--ticket", "FRT-1", "--step", "implement", "--state", "nominal"];

  describe("not configured or disabled", () => {
    it.each([
      ["heartbeat", heartbeatArgs],
      ["item", ["post", "item", "--kind", "question", "--ticket", "FRT-1", "--title", "Patch or revert?", "--option", "Patch", "--option", "Revert"]],
      ["activity", ["post", "activity", "--ticket", "FRT-1", "--text", "Opened PR #86"]],
      ["items", ["items", "--session", "s1", "--json"]],
    ])("%s prints nothing and sends nothing without a token", async (_name, argv) => {
      const transport = new FakeTransport();
      expect(await run(argv, { transport, env: { CLAUDE_CODE_SESSION_ID: "s1" } })).toEqual({ stdout: "", stderr: "" });
      expect(transport.requests).toHaveLength(0);
    });

    it("ignores a committed project ariadne.url: posts to the default URL, silent unless --strict", async () => {
      const project = { "ariadne.url": "https://attacker.example.com" };
      const ok = () => new FakeTransport(FakeTransport.json(200, { session: contract.session }));

      const quiet = ok();
      expect(await run(heartbeatArgs, { transport: quiet, project })).toEqual({ stdout: "", stderr: "" });
      expect(quiet.requests.map((r) => r.url)).toEqual([`${defaultAriadneUrl}/v1/agents/heartbeat`]);

      const strict = ok();
      expect((await run([...heartbeatArgs, "--strict"], { transport: strict, project })).stderr).toBe(
        "flight-rules board: ignored ariadne.url from project settings; set it in user scope\n",
      );
      expect(strict.requests.every((r) => r.url.startsWith(defaultAriadneUrl))).toBe(true);
    });

    it("board items prints the ignored-config notice", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { items: [] }));
      const output = await run(["items", "--json"], { transport, project: { "ariadne.enabled": false } });
      expect(output).toEqual({
        stdout: '{"items":[]}\n',
        stderr: "flight-rules board: ignored ariadne.enabled from project settings; set it in user scope\n",
      });
    });

    it("never sends anything to a plain-http URL, and says so only under --strict", async () => {
      const transport = new FakeTransport();
      const config = { "ariadne.url": "http://ariadne.example.com" };
      expect(await run(heartbeatArgs, { transport, config })).toEqual({ stdout: "", stderr: "" });
      const strict = await run([...heartbeatArgs, "--strict"], { transport, config });
      expect(strict.stderr).toContain("ignored ariadne.url from user settings: must be https");
      expect(transport.requests).toHaveLength(0);
    });

    it("prints nothing when ariadne.enabled is false, even under --strict", async () => {
      const transport = new FakeTransport();
      expect(await run([...heartbeatArgs, "--strict"], { transport, config: { "ariadne.enabled": false } })).toEqual({
        stdout: "",
        stderr: "",
      });
      expect(transport.requests).toHaveLength(0);
    });
  });

  describe("posting", () => {
    it("posts a heartbeat with every flag and prints nothing", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
      const output = await run(
        [
          ...heartbeatArgs.slice(0, 5),
          "verify 2/3",
          "--state",
          "caution",
          "--branch",
          "feat/FRT-1-x",
          "--repo",
          "think-lp/ariadne",
          "--skill",
          "flight-rules:execute-work",
          "--detail",
          "Lint failed once",
          "--session",
          "explicit-1",
        ],
        { transport },
      );
      expect(output).toEqual({ stdout: "", stderr: "" });
      expect(transport.bodies()).toEqual([
        {
          session: "explicit-1",
          ticket: "FRT-1",
          step: "verify 2/3",
          state: "caution",
          branch: "feat/FRT-1-x",
          repo: "think-lp/ariadne",
          skill: "flight-rules:execute-work",
          detail: "Lint failed once",
        },
      ]);
    });

    it("posts an item with repeated options and prints the response under --json", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { item: contract.item, created: false }));
      const output = await run(
        [
          "post",
          "item",
          "--kind",
          "wave-gate",
          "--ticket",
          "FRT-1200",
          "--title",
          "Wave 2 merged 4 of 4; wave 3 can start 3 tickets",
          "--option",
          "Start wave",
          "--option",
          "Review wave",
          "--id",
          "wave-3",
          "--json",
        ],
        { transport },
      );
      expect(transport.bodies()[0]).toEqual({
        session: "claude-session-1",
        kind: "wave-gate",
        ticket: "FRT-1200",
        title: "Wave 2 merged 4 of 4; wave 3 can start 3 tickets",
        options: ["Start wave", "Review wave"],
        id: "wave-3",
      });
      expect(JSON.parse(output.stdout)).toMatchObject({ created: false, item: { chosenOption: "Start wave" } });
    });

    it("posts an activity line with a level", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, { activity: contract.activity, created: true }));
      await run(["post", "activity", "--ticket", "FRT-1", "--text", "Opened PR #86", "--level", "success"], { transport });
      expect(transport.bodies()[0]).toEqual({ session: "claude-session-1", ticket: "FRT-1", text: "Opened PR #86", level: "success" });
    });

    it("rejects an unknown state or kind before posting", async () => {
      await expect(run(["post", "heartbeat", "--ticket", "FRT-1", "--step", "pr", "--state", "fine"])).rejects.toMatchObject({
        code: "commander.invalidArgument",
      });
      await expect(run(["post", "item", "--kind", "poll", "--ticket", "FRT-1", "--title", "t"])).rejects.toMatchObject({
        code: "commander.invalidArgument",
      });
    });
  });

  describe("failures", () => {
    const optInRequired = () =>
      new FakeTransport(FakeTransport.json(403, { error: "agents_opt_in_required", message: "Turn on Agents first." }));

    it("writes one stderr line and exits 0", async () => {
      const output = await run(heartbeatArgs, { transport: optInRequired() });
      expect(output.stdout).toBe("");
      expect(output.stderr).toBe(
        "flight-rules board: Agents reporting is off for you (403 agents_opt_in_required). Turn on Agents in Ariadne › Settings › Connections\n",
      );
    });

    it("tells the person to replace an expired token in one line, exit 0, or exit 1 under --strict", async () => {
      const expired = () => new FakeTransport(FakeTransport.json(401, { error: "agent_token_expired" }));
      const line =
        "flight-rules board: Ariadne agent token expired (401 agent_token_expired) — create a new one in Ariadne › Settings › Connections and run `flight-rules board login`";
      expect(await run(heartbeatArgs, { transport: expired() })).toEqual({ stdout: "", stderr: `${line}\n` });
      await expect(run([...heartbeatArgs, "--strict"], { transport: expired() })).rejects.toThrow(line);
    });

    it("exits 0 with one line when the API is unreachable", async () => {
      const offline = new TypeError("fetch failed");
      const output = await run(heartbeatArgs, { transport: new FakeTransport(offline, offline) });
      expect(output.stderr.trim().split("\n")).toHaveLength(1);
    });

    it("--strict turns a failure into exit 1", async () => {
      await expect(run([...heartbeatArgs, "--strict"], { transport: optInRequired() })).rejects.toThrow(
        "flight-rules board: Agents reporting is off for you (403 agents_opt_in_required)",
      );
    });

    it("--strict without a token posts anyway and fails on the 401", async () => {
      const transport = new FakeTransport(FakeTransport.json(401, { error: "unauthorized" }));
      await expect(run([...heartbeatArgs, "--strict"], { transport, env: { CLAUDE_CODE_SESSION_ID: "s1" } })).rejects.toThrow(
        "no Ariadne token (401 unauthorized)",
      );
      expect(transport.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/agents/heartbeat`);
    });
  });

  describe("items", () => {
    const listed = () =>
      new FakeTransport(
        FakeTransport.json(200, {
          items: [
            contract.item,
            { ...contract.item, id: "q-1", kind: "question", status: "open", chosenOption: null, resolvedAt: null, resolvedBy: null, title: "Patch or revert?", options: ["Patch", "Revert"] },
          ],
        }),
      );

    it("prints {items} under --json so a skill can read a decision", async () => {
      const transport = listed();
      const output = await run(["items", "--session", "0f9a7c4e-1", "--json"], { transport });
      expect(transport.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/agents/items?session=0f9a7c4e-1`);
      const { items } = JSON.parse(output.stdout) as { items: { status: string; chosenOption: string | null }[] };
      expect(items.map((item) => [item.status, item.chosenOption])).toEqual([
        ["resolved", "Start wave"],
        ["open", null],
      ]);
    });

    it("prints one line per item with its status and answer", async () => {
      const output = await run(["items"], { transport: listed() });
      expect(output.stdout).toBe(
        [
          "resolved\twave-gate\tFRT-1200\tgate-1\tWave 2 merged 4 of 4; wave 3 can start 3 tickets -> Start wave",
          "open\tquestion\tFRT-1200\tq-1\tPatch or revert? [Patch | Revert]",
          "",
        ].join("\n"),
      );
    });
  });

  describe("login", () => {
    it("saves the token with mode 0600 and never prints it", async () => {
      const output = await run(["login"], { env: {}, secret: `${agentToken}\n` });
      const path = join(home, ".config", "flight-rules", "ariadne-token");
      expect(JSON.parse(output.stdout)).toEqual({ saved: path });
      expect(output.stdout + output.stderr).not.toContain(agentToken);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it("warns when an environment variable outranks the saved token", async () => {
      const output = await run(["login"], { env: { ARIADNE_TOKEN: "x" }, secret: agentToken });
      expect(JSON.parse(output.stdout)).toMatchObject({ warning: expect.stringContaining("$ARIADNE_TOKEN") });
    });

    it("rejects a malformed token without echoing it", async () => {
      const secret = "ariadne_agent_nothex_short";
      const failure = await run(["login"], { env: {}, secret }).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("not an Ariadne agent token");
      expect((failure as Error).message).not.toContain(secret);
    });

    it("logout deletes the saved token", async () => {
      await run(["login"], { env: {}, secret: agentToken });
      const output = await run(["logout"], { env: {} });
      expect(JSON.parse(output.stdout)).toMatchObject({ removed: true });
    });
  });
});
