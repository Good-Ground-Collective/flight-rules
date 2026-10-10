import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriadnePacketError, AriadnePackets } from "../ariadne-packets.js";
import { AriadneTokenStore } from "../ariadne-token-store.js";
import { defaultAriadneUrl } from "../ariadne.schema.js";
import { FakeTransport, agentToken, packetContract } from "./fake-transport.js";

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
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    await packets(transport).create(packetContract.createRequest);
    expect(transport.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/review-packets`);
    expect(transport.requests[0]?.headers["Authorization"]).toBe(`Bearer ${agentToken}`);
  });

  it("throws, naming the login command, when there is no token", async () => {
    const transport = new FakeTransport();
    const error = await failure(packets(transport, { env: {} }).get("wave-2-checkout"));
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
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    const { packet } = packetContract.updateRequest;
    await packets(transport).update("wave-2-checkout", { packet, expectedRevision: 3 });
    const body = transport.bodies()[0] as { operationId: string; expectedRevision: number };
    expect(body.operationId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.expectedRevision).toBe(3);
  });

  it.each([
    [401, "agent_token_expired", "flight-rules board login"],
    [403, "agents_opt_in_required", "turn on Agents"],
    [409, "revision_conflict", "flight-rules packet get"],
    [409, "packet_exists", "flight-rules packet update"],
    [422, "reviewer_not_found", "flight-rules packet reviewers"],
  ])("maps %s %s to a next step", async (status, code, step) => {
    const transport = new FakeTransport(FakeTransport.json(status, packetContract.errors[code]));
    const error = await failure(packets(transport).get("wave-2-checkout"));
    expect(error.message).toContain(code);
    expect(error.message).toContain(step);
  });

  it("explains a network failure", async () => {
    const down = new Error("fetch failed");
    const error = await failure(packets(new FakeTransport(down, down)).get("wave-2-checkout"));
    expect(error.message).toContain("could not reach Ariadne");
  });

  it("never lets the token into an error", async () => {
    const transport = new FakeTransport(FakeTransport.json(400, { error: "bad", message: `echo ${agentToken}` }));
    const error = await failure(packets(transport).get("wave-2-checkout"));
    expect(error.message).not.toContain(agentToken);
    expect(error.message).toContain("[redacted]");
  });
});
