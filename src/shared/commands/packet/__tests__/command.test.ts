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

  it("create generates an id from the title when the file has none", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    const withoutId = Object.fromEntries(Object.entries(packetContract.createRequest).filter(([key]) => key !== "id"));
    const out = await run(["create", "--file", file(withoutId)], { transport });

    expect((transport.bodies()[0] as { id: string }).id).toMatch(/^checkout-rewrite-wave-2-[0-9a-f]{8}$/);
    expect(JSON.parse(out)).toEqual(packetContract.storedPacket);
  });

  it("create retries once with a new suffix on packet_id_taken and prints the stored packet", async () => {
    const stored = { ...packetContract.storedPacket, id: "wave-2-checkout-aaaaaaaa" };
    const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_id_taken"]), FakeTransport.json(200, stored));
    const out = await run(["create", "--file", file(packetContract.createRequest)], { transport });

    const ids = transport.bodies().map((body) => (body as { id: string }).id);
    expect(ids[0]).toBe("wave-2-checkout");
    expect(ids[1]).toMatch(/^wave-2-checkout-[0-9a-f]{8}$/);
    expect(JSON.parse(out)).toEqual(stored);
  });

  it("create fails on a second packet_id_taken and on packet_exists without a further retry", async () => {
    const taken = () => FakeTransport.json(409, packetContract.errors["packet_id_taken"]);
    const twice = new FakeTransport(taken(), taken());
    await expect(run(["create", "--file", file(packetContract.createRequest)], { transport: twice })).rejects.toThrow(/packet_id_taken.*wave-2-checkout/);
    expect(twice.requests).toHaveLength(2);

    const exists = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_exists"]));
    await expect(run(["create", "--file", file(packetContract.createRequest)], { transport: exists })).rejects.toThrow(/packet_exists/);
    expect(exists.requests).toHaveLength(1);
  });

  it("new-id prints one JSON line with a generated id and needs no token", async () => {
    const transport = new FakeTransport();
    const out = await run(["new-id", "--title", "Checkout rewrite, wave 2"], { transport, env: {} });

    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({ id: expect.stringMatching(/^checkout-rewrite-wave-2-[0-9a-f]{8}$/) });
    expect(transport.requests).toHaveLength(0);
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
