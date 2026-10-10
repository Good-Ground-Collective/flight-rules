import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AriadnePackets } from "../../../ariadne/ariadne-packets.js";
import { AriadneTokenStore } from "../../../ariadne/ariadne-token-store.js";
import { FakeTransport, agentToken, packetContract } from "../../../ariadne/__tests__/fake-transport.js";
import { createPacketCommand } from "../command.js";

describe("packet command", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-packet-cmd-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const file = (content: unknown): string => {
    const path = join(home, "p.json");
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
    return path;
  };

  const run = async (
    argv: string[],
    { transport = new FakeTransport(), env = { ARIADNE_AGENT_TOKEN: agentToken } }: { transport?: FakeTransport; env?: Record<string, string | undefined> } = {},
  ): Promise<string> => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const tokens = new AriadneTokenStore({ env, home });
    try {
      await createPacketCommand(() => new AriadnePackets({ readLayers: () => [], tokens, transport }))
        .exitOverride()
        .parseAsync(argv, { from: "user" });
      return stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      stdout.mockRestore();
    }
  };

  it("create sends the file and prints the stored packet as one JSON line", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    const out = await run(["create", "--file", file(packetContract.createRequest)], { transport });

    expect(transport.requests[0]).toMatchObject({ method: "POST" });
    expect(transport.bodies()[0]).toEqual(packetContract.createRequest);
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual(packetContract.storedPacket);
  });

  it("create rejects an unknown field locally, listing the issue, and sends nothing", async () => {
    const transport = new FakeTransport();
    const bad = { ...packetContract.createRequest, diff: "--- a/x" };
    await expect(run(["create", "--file", file(bad)], { transport })).rejects.toThrow(/diff/);
    expect(transport.requests).toHaveLength(0);
  });

  it("create fails on a file that is not JSON", async () => {
    await expect(run(["create", "--file", file("{nope")])).rejects.toThrow(/not valid JSON/);
  });

  it("update sends PUT with the flag's expected revision", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    const { packet } = packetContract.updateRequest;
    await run(["update", "wave-2-checkout", "--file", file(packet), "--expected-revision", "3"], { transport });

    expect(transport.requests[0]).toMatchObject({ method: "PUT" });
    expect(transport.requests[0]?.url).toMatch(/\/v1\/review-packets\/wave-2-checkout$/);
    expect(transport.bodies()[0]).toMatchObject({ expectedRevision: 3, packet });
  });

  it("update accepts packet get output, taking its revision and reviewer logins", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    await run(["update", "wave-2-checkout", "--file", file(packetContract.storedPacket)], { transport });

    const body = transport.bodies()[0] as { expectedRevision: number; packet: Record<string, unknown> };
    expect(body.expectedRevision).toBe(3);
    expect(body.packet["reviewers"]).toEqual(["octocat", "hubot"]);
    expect(body.packet).not.toHaveProperty("authorId");
  });

  it("update without any revision exits before sending", async () => {
    const transport = new FakeTransport();
    await expect(
      run(["update", "wave-2-checkout", "--file", file(packetContract.updateRequest.packet)], { transport }),
    ).rejects.toThrow(/no expected revision/);
    expect(transport.requests).toHaveLength(0);
  });

  it("update turns a 409 revision_conflict into a re-read next step", async () => {
    const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["revision_conflict"]));
    await expect(
      run(["update", "wave-2-checkout", "--file", file(packetContract.storedPacket)], { transport }),
    ).rejects.toThrow(/flight-rules packet get/);
  });

  it("get and reviewers print the server's JSON", async () => {
    const transport = new FakeTransport(
      FakeTransport.json(200, packetContract.storedPacket),
      FakeTransport.json(200, packetContract.reviewerList),
    );
    expect(JSON.parse(await run(["get", "wave-2-checkout"], { transport }))).toEqual(packetContract.storedPacket);
    expect(JSON.parse(await run(["reviewers"], { transport }))).toEqual(packetContract.reviewerList);
  });

  it("a missing token throws and never prints the token", async () => {
    await expect(run(["get", "wave-2-checkout"], { env: {} })).rejects.toThrow(/flight-rules board login/);
  });
});
