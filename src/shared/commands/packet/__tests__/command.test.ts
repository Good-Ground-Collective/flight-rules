import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AriadnePackets } from "../../../ariadne/ariadne-packets.js";
import { AriadneTokenStore } from "../../../ariadne/ariadne-token-store.js";
import { FakeTransport, agentToken, packetContract, packetEnvelope, storedPacket } from "../../../ariadne/__tests__/fake-transport.js";
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
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    const out = await run(["create", "--file", file(packetContract.createRequest)], { transport });

    expect(transport.requests[0]).toMatchObject({ method: "POST" });
    expect(transport.bodies()[0]).toEqual(packetContract.createRequest);
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual(storedPacket);
  });

  it("create generates an id from the title when the file has none", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    const withoutId = Object.fromEntries(Object.entries(packetContract.createRequest).filter(([key]) => key !== "id"));
    const out = await run(["create", "--file", file(withoutId)], { transport });

    expect((transport.bodies()[0] as { id: string }).id).toMatch(/^review-packets-api-store-and-routes-[0-9a-f]{8}$/);
    expect(JSON.parse(out)).toEqual(storedPacket);
  });

  it("create retries once with a new suffix on packet_id_taken and prints the stored packet", async () => {
    const stored = { ...storedPacket, id: "rp-frt-2400-aaaaaaaa" };
    const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_id_taken"]), FakeTransport.json(200, { packet: stored }));
    const out = await run(["create", "--file", file(packetContract.createRequest)], { transport });

    const ids = transport.bodies().map((body) => (body as { id: string }).id);
    expect(ids[0]).toBe("rp-frt-2400");
    expect(ids[1]).toMatch(/^rp-frt-2400-[0-9a-f]{8}$/);
    expect(JSON.parse(out)).toEqual(stored);
  });

  it("create fails on a second packet_id_taken and on packet_exists without a further retry", async () => {
    const taken = () => FakeTransport.json(409, packetContract.errors["packet_id_taken"]);
    const twice = new FakeTransport(taken(), taken());
    await expect(run(["create", "--file", file(packetContract.createRequest)], { transport: twice })).rejects.toThrow(/packet_id_taken.*rp-frt-2400/);
    expect(twice.requests).toHaveLength(2);

    const exists = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_exists"]));
    await expect(run(["create", "--file", file(packetContract.createRequest)], { transport: exists })).rejects.toThrow(/packet_exists/);
    expect(exists.requests).toHaveLength(1);
  });

  it("create writes the generated id back into the file, keeping its other keys, and a re-run replays", async () => {
    const withoutId = Object.fromEntries(Object.entries(packetContract.createRequest).filter(([key]) => key !== "id"));
    const path = file(withoutId);
    const echo = (request: { body?: string }) => FakeTransport.json(200, { packet: { ...storedPacket, id: JSON.parse(request.body ?? "{}").id } });
    const transport = new FakeTransport(echo, echo);
    const first = JSON.parse(await run(["create", "--file", path], { transport })) as { id: string };

    const written = readFileSync(path, "utf8");
    expect(written).toBe(JSON.stringify({ ...withoutId, id: first.id }, null, 2) + "\n");
    expect(first.id).toMatch(/^review-packets-api-store-and-routes-[0-9a-f]{8}$/);

    await run(["create", "--file", path], { transport });
    expect(transport.bodies().map((body) => (body as { id: string }).id)).toEqual([first.id, first.id]);
    expect(readFileSync(path, "utf8")).toBe(written);
  });

  it("create writes the regenerated id back after packet_id_taken", async () => {
    const path = file(packetContract.createRequest);
    const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_id_taken"]), (request) =>
      FakeTransport.json(200, { packet: { ...storedPacket, id: JSON.parse(request.body ?? "{}").id } }),
    );
    await run(["create", "--file", path], { transport });

    const retriedId = (transport.bodies()[1] as { id: string }).id;
    expect(retriedId).not.toBe("rp-frt-2400");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...packetContract.createRequest, id: retriedId });
  });

  it("create leaves the file alone when the create fails", async () => {
    const withoutId = Object.fromEntries(Object.entries(packetContract.createRequest).filter(([key]) => key !== "id"));
    const path = file(withoutId);
    const before = readFileSync(path, "utf8");
    const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_exists"]));
    await expect(run(["create", "--file", path], { transport })).rejects.toThrow(/packet_exists/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("update exits without sending when the file names a different packet", async () => {
    const transport = new FakeTransport();
    const other = { ...(packetContract.updateRequest["packet"] as Record<string, unknown>), id: "b-2" };
    await expect(run(["update", "a-1", "--file", file(other), "--expected-revision", "1"], { transport })).rejects.toThrow(/b-2.*a-1/);
    expect(transport.requests).toHaveLength(0);
  });

  it.each(["", "0x3", "1e2", "-1", "1.5", " 2"])("update rejects --expected-revision %j before sending", async (value) => {
    const transport = new FakeTransport();
    await expect(
      run(["update", "rp-frt-2400", "--file", file(packetContract.updateRequest.packet), "--expected-revision", value], { transport }),
    ).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
  });

  it("update accepts --expected-revision 0", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    await run(["update", "rp-frt-2400", "--file", file(packetContract.updateRequest.packet), "--expected-revision", "0"], { transport });
    expect(transport.bodies()[0]).toMatchObject({ expectedRevision: 0 });
  });

  it("new-id prints one JSON line with a generated id and needs no token", async () => {
    const transport = new FakeTransport();
    const out = await run(["new-id", "--title", "Review packets: API store and routes"], { transport, env: {} });

    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({ id: expect.stringMatching(/^review-packets-api-store-and-routes-[0-9a-f]{8}$/) });
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
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    const { packet } = packetContract.updateRequest;
    await run(["update", "rp-frt-2400", "--file", file(packet), "--expected-revision", "1"], { transport });

    expect(transport.requests[0]).toMatchObject({ method: "PUT" });
    expect(transport.requests[0]?.url).toMatch(/\/v1\/review-packets\/rp-frt-2400$/);
    expect(transport.bodies()[0]).toMatchObject({ expectedRevision: 1, packet });
  });

  it("update accepts packet get output, taking its revision and reviewer logins", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    await run(["update", "rp-frt-2400", "--file", file(storedPacket)], { transport });

    const body = transport.bodies()[0] as { expectedRevision: number; packet: Record<string, unknown> };
    expect(body.expectedRevision).toBe(1);
    expect(body.packet["reviewers"]).toEqual(["sam-example", "taylor-example"]);
    expect(body.packet).not.toHaveProperty("authorId");
  });

  it("update without any revision exits before sending", async () => {
    const transport = new FakeTransport();
    await expect(
      run(["update", "rp-frt-2400", "--file", file(packetContract.updateRequest.packet)], { transport }),
    ).rejects.toThrow(/no expected revision/);
    expect(transport.requests).toHaveLength(0);
  });

  it("update turns a 409 revision_conflict into a re-read next step", async () => {
    const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["revision_conflict"]));
    await expect(
      run(["update", "rp-frt-2400", "--file", file(storedPacket)], { transport }),
    ).rejects.toThrow(/flight-rules packet get/);
  });

  it("get and reviewers print the server's JSON", async () => {
    const transport = new FakeTransport(
      FakeTransport.json(200, packetEnvelope),
      FakeTransport.json(200, packetContract.reviewerList),
    );
    expect(JSON.parse(await run(["get", "rp-frt-2400"], { transport }))).toEqual(storedPacket);
    expect(JSON.parse(await run(["reviewers"], { transport }))).toEqual(packetContract.reviewerList);
  });

  it("a missing token throws and never prints the token", async () => {
    await expect(run(["get", "rp-frt-2400"], { env: {} })).rejects.toThrow(/flight-rules board login/);
  });
});
