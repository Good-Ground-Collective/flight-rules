import { describe, expect, it } from "vitest";
import { AriadneClient, AriadneError } from "../ariadne-client.js";
import { defaultAriadneUrl } from "../ariadne.schema.js";
import { FakeTransport, agentToken, contract, packetContract } from "./fake-transport.js";

// Payloads and paths are pinned to think-lp/ariadne docs/agents-api.md,
// contract version 1. The request examples below are the contract's own.

const client = (transport: FakeTransport) =>
  new AriadneClient({ baseUrl: `${defaultAriadneUrl}/`, token: agentToken, transport });

const rejection = async (promise: Promise<unknown>): Promise<AriadneError> => {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(AriadneError);
  return error as AriadneError;
};

describe("AriadneClient requests", () => {
  it("defaults to the production API", () => {
    expect(defaultAriadneUrl).toBe("https://ariadne-api-xohlbba2ea-uc.a.run.app");
  });

  it("posts the contract's heartbeat example to /v1/agents/heartbeat with a bearer token", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
    const response = await client(transport).heartbeat({
      session: "0f9a7c4e-1",
      ticket: "FRT-1234",
      repo: "think-lp/ariadne",
      branch: "feat/FRT-1234-agents",
      skill: "flight-rules:execute-work",
      step: "verify 1/3",
      state: "caution",
      detail: "Lint failed once; retrying.",
    });

    expect(response.session).toMatchObject({ id: "0f9a7c4e-1", running: true });
    const [request] = transport.requests;
    expect(request).toMatchObject({
      method: "POST",
      url: "https://ariadne-api-xohlbba2ea-uc.a.run.app/v1/agents/heartbeat",
      timeoutMs: 5000,
    });
    expect(request?.headers).toMatchObject({
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(transport.bodies()[0]).toEqual({
      session: "0f9a7c4e-1",
      ticket: "FRT-1234",
      repo: "think-lp/ariadne",
      branch: "feat/FRT-1234-agents",
      skill: "flight-rules:execute-work",
      step: "verify 1/3",
      state: "caution",
      detail: "Lint failed once; retrying.",
    });
  });

  it("posts the contract's item example to /v1/agents/items", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { item: contract.item, created: false }));
    const response = await client(transport).postItem({
      session: "0f9a7c4e-1",
      kind: "wave-gate",
      ticket: "FRT-1200",
      title: "Wave 2 merged 4 of 4; wave 3 can start 3 tickets",
      detail: "Optional, up to 2,000 characters; line breaks allowed.",
      options: ["Start wave", "Review wave"],
      id: "optional-client-id",
    });

    expect(response).toMatchObject({ created: false, item: { chosenOption: "Start wave" } });
    expect(transport.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/agents/items`);
    expect(transport.bodies()[0]).toEqual({
      session: "0f9a7c4e-1",
      kind: "wave-gate",
      ticket: "FRT-1200",
      title: "Wave 2 merged 4 of 4; wave 3 can start 3 tickets",
      detail: "Optional, up to 2,000 characters; line breaks allowed.",
      options: ["Start wave", "Review wave"],
      id: "optional-client-id",
    });
  });

  it("posts the contract's activity example to /v1/agents/activity", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { activity: contract.activity, created: true }));
    await client(transport).postActivity({
      session: "0f9a7c4e-1",
      text: "Opened PR #86",
      level: "success",
      ticket: "FRT-1234",
      id: "optional-client-id",
    });

    expect(transport.requests[0]?.url).toBe(`${defaultAriadneUrl}/v1/agents/activity`);
    expect(transport.bodies()[0]).toEqual({
      session: "0f9a7c4e-1",
      text: "Opened PR #86",
      level: "success",
      ticket: "FRT-1234",
      id: "optional-client-id",
    });
  });

  it("omits optional fields that were not given instead of sending empty values", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { activity: contract.activity, created: true }));
    await client(transport).postActivity({ session: "s1", text: "Started", ticket: "", level: undefined });
    expect(transport.bodies()[0]).toEqual({ session: "s1", text: "Started" });
  });

  it("reads a session's items with GET /v1/agents/items?session=", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { items: [contract.item] }));
    const response = await client(transport).listItems("0f9a7c4e-1");
    expect(response.items[0]).toMatchObject({ status: "resolved", chosenOption: "Start wave" });
    expect(transport.requests[0]).toMatchObject({
      method: "GET",
      url: `${defaultAriadneUrl}/v1/agents/items?session=0f9a7c4e-1`,
    });
    expect(transport.requests[0]?.body).toBeUndefined();
    expect(transport.requests[0]?.headers).not.toHaveProperty("Content-Type");
  });

  it("sends no Authorization header without a token", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { items: [] }));
    await new AriadneClient({ baseUrl: defaultAriadneUrl, transport }).listItems("s1");
    expect(transport.requests[0]?.headers).not.toHaveProperty("Authorization");
  });
});

describe("AriadneClient surface", () => {
  it("reports and reads only; agent tokens cannot resolve items, so there is no resolve call", () => {
    const methods = Object.getOwnPropertyNames(AriadneClient.prototype).filter((name) => name !== "constructor");
    expect(methods.filter((name) => ["heartbeat", "postItem", "postActivity", "listItems"].includes(name)).sort()).toEqual([
      "heartbeat",
      "listItems",
      "postActivity",
      "postItem",
    ]);
    expect(methods.some((name) => /resolve|answer|decide/i.test(name))).toBe(false);
  });
});

describe("AriadneClient payload rules", () => {
  it("rejects any field outside the contract, so code, diffs or ticket bodies cannot ride along", async () => {
    const transport = new FakeTransport();
    const input = { session: "s1", kind: "question", title: "Patch or revert?", diff: "--- a/x\n+++ b/x" };
    const error = await rejection(client(transport).postItem(input as never));
    expect(error.failure).toBe("invalid-input");
    expect(error.message).toContain("diff");
    expect(transport.requests).toHaveLength(0);
  });

  it("upper-cases ticket keys and rejects anything that is not a Jira key", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
    await client(transport).heartbeat({ session: "s1", ticket: "frt-12", step: "pr", state: "nominal" });
    expect(transport.bodies()[0]).toMatchObject({ ticket: "FRT-12" });

    const error = await rejection(client(transport).heartbeat({ session: "s1", ticket: "#194", step: "pr", state: "nominal" }));
    expect(error.message).toContain("ticket");
  });

  it("rejects a session id outside [A-Za-z0-9_-]{1,80}", async () => {
    const error = await rejection(client(new FakeTransport()).listItems("has space"));
    expect(error.failure).toBe("invalid-input");
  });

  it("folds one-line fields onto one line and cuts them to their limits", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { item: contract.item, created: true }));
    await client(transport).postItem({
      session: "s1",
      kind: "question",
      title: `  Ship\nit?\t${"x".repeat(300)}`,
      detail: `line one\r\nline two\u0007${"y".repeat(3000)}`,
      options: ["Ship", "o".repeat(80)],
    });
    const body = transport.bodies()[0] as { title: string; detail: string; options: string[] };
    expect(body.title).toHaveLength(200);
    expect(body.title.startsWith("Ship it? xxx")).toBe(true);
    expect(body.title.endsWith("…")).toBe(true);
    expect(body.detail).toHaveLength(2000);
    expect(body.detail.startsWith("line one\nline two")).toBe(true);
    expect(body.options[1]).toHaveLength(60);
  });

  it("allows up to six distinct options", async () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect((await rejection(client(new FakeTransport()).postItem({ session: "s1", kind: "question", title: "t", options: seven }))).message).toContain("options");
    expect((await rejection(client(new FakeTransport()).postItem({ session: "s1", kind: "question", title: "t", options: ["a", "a"] }))).message).toContain("distinct");
  });

  it("accepts a free-text step such as verify 2/3 and requires a known state", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, { session: contract.session }));
    await client(transport).heartbeat({ session: "s1", step: "verify 2/3", state: "hold" });
    expect(transport.bodies()[0]).toEqual({ session: "s1", step: "verify 2/3", state: "hold" });
    await rejection(client(transport).heartbeat({ session: "s1", step: "pr", state: "fine" as never }));
  });
});

describe("AriadneClient failures", () => {
  it("parses {error, message} and keeps the status and code", async () => {
    const transport = new FakeTransport(
      FakeTransport.json(404, { error: "session_not_found", message: "Send a heartbeat for this session first." }),
    );
    const error = await rejection(client(transport).postActivity({ session: "s1", text: "x" }));
    expect(error).toMatchObject({ failure: "http", status: 404, code: "session_not_found" });
    expect(error.message).toBe("404 session_not_found Send a heartbeat for this session first.");
  });

  it("parses the bare 401 body", async () => {
    const transport = new FakeTransport(FakeTransport.json(401, { error: "unauthorized" }));
    const error = await rejection(client(transport).listItems("s1"));
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
    expect(error.message).not.toContain(agentToken);
  });

  it("does not retry a 4xx", async () => {
    const transport = new FakeTransport(FakeTransport.json(429, { error: "rate_limited", message: "Retry in a minute." }));
    await rejection(client(transport).listItems("s1"));
    expect(transport.requests).toHaveLength(1);
  });

  it("retries once after a timeout and succeeds", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const transport = new FakeTransport(timeout, FakeTransport.json(200, { items: [] }));
    await expect(client(transport).listItems("s1")).resolves.toEqual({ items: [] });
    expect(transport.requests).toHaveLength(2);
  });

  it("retries once after a 5xx, then reports the second answer", async () => {
    const transport = new FakeTransport(
      FakeTransport.json(503, { error: "unavailable" }),
      FakeTransport.json(502, { error: "bad_gateway" }),
    );
    const error = await rejection(client(transport).listItems("s1"));
    expect(error).toMatchObject({ failure: "http", status: 502 });
    expect(transport.requests).toHaveLength(2);
  });

  it("gives up after two timeouts with a network failure", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const transport = new FakeTransport(timeout, timeout, FakeTransport.json(200, { items: [] }));
    const error = await rejection(client(transport).listItems("s1"));
    expect(error.failure).toBe("network");
    expect(error.message).toContain("timed out after 5 s");
    expect(transport.requests).toHaveLength(2);
  });

  it("reports a 2xx body it cannot read", async () => {
    const error = await rejection(client(new FakeTransport({ status: 200, body: "<html>" })).listItems("s1"));
    expect(error.failure).toBe("bad-response");
  });
});

describe("AriadneClient review packets", () => {
  const base = `${defaultAriadneUrl}/v1/review-packets`;
  const create = packetContract.createRequest;
  const update = packetContract.updateRequest;
  const withField = (record: Record<string, unknown>, extra: Record<string, unknown>) => ({ ...record, ...extra });

  it("creates with POST and the exact body, returning the stored packet", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    const response = await client(transport).createPacket(create);

    expect(response).toMatchObject({ id: "wave-2-checkout", revision: 3 });
    expect(transport.requests[0]).toMatchObject({ method: "POST", url: base });
    expect(transport.requests[0]?.headers).toMatchObject({
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
    });
    expect(transport.bodies()[0]).toEqual(create);
  });

  it("updates with PUT to the packet's own path", async () => {
    const transport = new FakeTransport(FakeTransport.json(200, packetContract.storedPacket));
    await client(transport).updatePacket("wave-2-checkout", update);

    expect(transport.requests[0]).toMatchObject({ method: "PUT", url: `${base}/wave-2-checkout` });
    expect(transport.bodies()[0]).toEqual(update);
  });

  it("gets a packet and lists reviewers with no body", async () => {
    const transport = new FakeTransport(
      FakeTransport.json(200, packetContract.storedPacket),
      FakeTransport.json(200, packetContract.reviewerList),
    );
    await client(transport).getPacket("wave-2-checkout");
    const list = await client(transport).listReviewers();

    expect(transport.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${base}/wave-2-checkout`,
      `GET ${base}/reviewers`,
    ]);
    expect(transport.requests.every((r) => r.body === undefined)).toBe(true);
    expect(list.reviewers[0]).toMatchObject({ id: "member-1", name: "Octo Cat", github: { id: 583231, login: "octocat" } });
  });

  it("rejects an unknown field such as diff or snippet without sending anything", async () => {
    const transport = new FakeTransport();
    const error = await rejection(client(transport).createPacket(withField(create, { diff: "--- a/x" })));
    expect(error.failure).toBe("invalid-input");
    expect(error.message).toContain("diff");

    const prs = [{ ...(create["prs"] as Record<string, unknown>[])[0], snippet: "const a = 1" }];
    await rejection(client(transport).createPacket(withField(create, { prs })));
    expect(transport.requests).toHaveLength(0);
  });

  it("rejects an over-long rationale instead of cutting it, listing every issue", async () => {
    const transport = new FakeTransport();
    const prs = (create["prs"] as Record<string, unknown>[]).map((pr, index) =>
      index === 0
        ? { ...pr, focusAreas: [{ id: "fa-1", kind: "other", title: "t", rationale: "x".repeat(2001), anchors: [] }] }
        : pr,
    );
    const error = await rejection(client(transport).createPacket(withField(create, { prs, title: "y".repeat(201) })));

    expect(error.message).toContain("rationale: must be at most 2000 characters");
    expect(error.message).toContain("title: must be at most 200 characters");
    expect(transport.requests).toHaveLength(0);
  });

  it("rejects a malformed packet id before building a path", async () => {
    const transport = new FakeTransport();
    await rejection(client(transport).getPacket("../etc"));
    await rejection(client(transport).updatePacket("a/b", update));
    expect(transport.requests).toHaveLength(0);
  });

  it("retries once after a 5xx and never after a 4xx", async () => {
    const retried = new FakeTransport(FakeTransport.json(503, { error: "unavailable" }), FakeTransport.json(200, packetContract.storedPacket));
    await client(retried).updatePacket("wave-2-checkout", update);
    expect(retried.requests).toHaveLength(2);
    expect(retried.bodies()[1]).toEqual(retried.bodies()[0]);

    const conflict = new FakeTransport(FakeTransport.json(409, packetContract.errors["revision_conflict"]));
    const error = await rejection(client(conflict).updatePacket("wave-2-checkout", update));
    expect(error).toMatchObject({ failure: "http", status: 409, code: "revision_conflict" });
    expect(conflict.requests).toHaveLength(1);
  });

  it("exposes no way to resolve, answer or decide on a packet", () => {
    const methods = Object.getOwnPropertyNames(AriadneClient.prototype);
    expect(["createPacket", "updatePacket", "getPacket", "listReviewers"].every((name) => methods.includes(name))).toBe(true);
    expect(methods.some((name) => /resolve|answer|decide/i.test(name))).toBe(false);
  });
});
