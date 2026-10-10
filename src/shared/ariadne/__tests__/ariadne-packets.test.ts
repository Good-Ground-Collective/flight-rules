import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriadnePacketError, AriadnePackets } from "../ariadne-packets.js";
import { AriadneTokenStore } from "../ariadne-token-store.js";
import { defaultAriadneUrl } from "../ariadne.schema.js";
import { FakeTransport, agentToken, packetContract, packetEnvelope, storedPacket } from "./fake-transport.js";

describe("AriadnePackets", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-packets-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const packets = (
    transport: FakeTransport,
    {
      env = { ARIADNE_AGENT_TOKEN: agentToken },
      user = {},
      project = {},
    }: { env?: Record<string, string | undefined>; user?: Record<string, unknown>; project?: Record<string, unknown> } = {},
  ) =>
    new AriadnePackets({
      readLayers: () => [
        { scope: "user", values: user },
        { scope: "project", values: project },
      ],
      tokens: new AriadneTokenStore({ env, home }),
      transport,
    });

  const failure = async (promise: Promise<unknown>): Promise<AriadnePacketError> => {
    const error = await promise.then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(AriadnePacketError);
    return error as AriadnePacketError;
  };

  it("publishes with the author's token to the default API", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    await packets(transport).create(packetContract.createRequest);
    expect(transport.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/review-packets`);
    expect(transport.requests[0]?.headers["Authorization"]).toBe(`Bearer ${agentToken}`);
  });

  it("throws, naming the login command, when there is no token", async () => {
    const transport = new FakeTransport();
    const error = await failure(packets(transport, { env: {} }).get("rp-frt-2400"));
    expect(error.message).toContain("flight-rules board login");
    expect(error.message).toContain("ARIADNE_AGENT_TOKEN");
    expect(transport.requests).toHaveLength(0);
  });

  it("ignores ariadne.url from project scope but honours user scope", async () => {
    const ignored = new FakeTransport(FakeTransport.json(200, packetContract.reviewerList));
    await packets(ignored, { project: { "ariadne.url": "https://evil.example.com" } }).reviewers();
    expect(ignored.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/review-packets/reviewers`);

    const honoured = new FakeTransport(FakeTransport.json(200, packetContract.reviewerList));
    await packets(honoured, { user: { "ariadne.url": "https://ariadne.example.com" } }).reviewers();
    expect(honoured.requests[0]?.url).toBe("https://ariadne.example.com/v1/review-packets/reviewers");
  });

  it("refuses an invalid ariadne.url and sends nothing", async () => {
    const transport = new FakeTransport();
    const error = await failure(packets(transport, { user: { "ariadne.url": "http://example.com" } }).reviewers());
    expect(error.message).toContain("ariadne.url is invalid");
    expect(transport.requests).toHaveLength(0);
  });

  it("generates an operationId for an update when none is given", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
    const { packet } = packetContract.updateRequest;
    await packets(transport).update("rp-frt-2400", { packet, expectedRevision: 3 });
    const body = transport.bodies()[0] as { operationId: string; expectedRevision: number };
    expect(body.operationId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.expectedRevision).toBe(3);
  });

  it.each([
    [401, "agent_token_expired", "flight-rules board login"],
    [403, "agents_opt_in_required", "turn on Agents"],
    [409, "revision_conflict", "flight-rules packet get"],
    [409, "packet_exists", "flight-rules packet update"],
    [409, "packet_id_taken", "flight-rules packet new-id"],
    [422, "reviewer_not_found", "flight-rules packet reviewers"],
  ])("maps %s %s to a next step", async (status, code, step) => {
    const transport = new FakeTransport(FakeTransport.json(status, packetContract.errors[code]));
    const error = await failure(packets(transport).get("rp-frt-2400"));
    expect(error.message).toContain(code);
    expect(error.message).toContain(step);
  });

  describe("create ids", () => {
    const withoutId = Object.fromEntries(Object.entries(packetContract.createRequest).filter(([key]) => key !== "id"));
    const taken = () => FakeTransport.json(409, packetContract.errors["packet_id_taken"]);
    const sentIds = (transport: FakeTransport) => transport.bodies().map((body) => (body as { id: string }).id);

    it("generates an id from the title when the packet has none", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
      await packets(transport).create(withoutId);
      expect(sentIds(transport)).toHaveLength(1);
      expect(sentIds(transport)[0]).toMatch(/^review-packets-api-store-and-routes-[0-9a-f]{8}$/);
    });

    it("keeps the id the packet already has", async () => {
      const transport = new FakeTransport(FakeTransport.json(200, packetEnvelope));
      await packets(transport).create(packetContract.createRequest);
      expect(sentIds(transport)).toEqual(["rp-frt-2400"]);
    });

    it("resends the same id and body when a 5xx is retried", async () => {
      const transport = new FakeTransport(FakeTransport.json(503, {}), FakeTransport.json(200, packetEnvelope));
      await packets(transport).create(withoutId);
      const [first, second] = sentIds(transport);
      expect(transport.requests).toHaveLength(2);
      expect(first).toBe(second);
    });

    it("regenerates the suffix once after packet_id_taken and returns the stored packet", async () => {
      const stored = { ...storedPacket, id: "ignored" };
      const transport = new FakeTransport(taken(), FakeTransport.json(200, { packet: stored }));
      const result = await packets(transport).create(withoutId);
      const [first, second] = sentIds(transport);
      expect(sentIds(transport)).toHaveLength(2);
      expect(first).toMatch(/^review-packets-api-store-and-routes-[0-9a-f]{8}$/);
      expect(second).toMatch(/^review-packets-api-store-and-routes-[0-9a-f]{8}$/);
      expect(second).not.toBe(first);
      expect(result).toEqual(stored);
    });

    it("keeps the slug of a file-supplied id when regenerating", async () => {
      const transport = new FakeTransport(taken(), FakeTransport.json(200, packetEnvelope));
      await packets(transport).create(packetContract.createRequest);
      const [first, second] = sentIds(transport);
      expect(first).toBe("rp-frt-2400");
      expect(second).toMatch(/^rp-frt-2400-[0-9a-f]{8}$/);
    });

    it("fails on a second packet_id_taken, naming the ids tried", async () => {
      const transport = new FakeTransport(taken(), taken(), FakeTransport.json(200, packetEnvelope));
      const error = await failure(packets(transport).create(withoutId));
      const [first, second] = sentIds(transport);
      expect(transport.requests).toHaveLength(2);
      expect(error.message).toContain("packet_id_taken");
      expect(error.message).toContain(String(first));
      expect(error.message).toContain(String(second));
      expect(error.message).toContain("flight-rules packet new-id");
    });

    it("never retries packet_exists", async () => {
      const transport = new FakeTransport(FakeTransport.json(409, packetContract.errors["packet_exists"]));
      await failure(packets(transport).create(withoutId));
      expect(transport.requests).toHaveLength(1);
    });

    it("never retries an unknown 409", async () => {
      const transport = new FakeTransport(FakeTransport.json(409, { error: "surprise", message: "x" }));
      const error = await failure(packets(transport).create(withoutId));
      expect(transport.requests).toHaveLength(1);
      expect(error.message).toContain("409");
    });

    it("sends nothing for a packet that has neither id nor title", async () => {
      const transport = new FakeTransport();
      await failure(packets(transport).create({}));
      expect(transport.requests).toHaveLength(0);
    });
  });

  it("explains a network failure", async () => {
    const down = new Error("fetch failed");
    const error = await failure(packets(new FakeTransport(down, down)).get("rp-frt-2400"));
    expect(error.message).toContain("could not reach Ariadne");
  });

  it("never lets the token into an error", async () => {
    const transport = new FakeTransport(FakeTransport.json(400, { error: "bad", message: `echo ${agentToken}` }));
    const error = await failure(packets(transport).get("rp-frt-2400"));
    expect(error.message).not.toContain(agentToken);
    expect(error.message).toContain("[redacted]");
  });
});
