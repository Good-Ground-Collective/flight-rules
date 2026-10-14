import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AriadneBoard } from "../../shared/ariadne/ariadne-board.js";
import { AriadnePackets } from "../../shared/ariadne/ariadne-packets.js";
import { AriadneTokenStore } from "../../shared/ariadne/ariadne-token-store.js";
import {
  FakeTransport,
  agentToken,
  contract,
  packetContract,
  packetEnvelope,
  storedPacket,
} from "../../shared/ariadne/__tests__/fake-transport.js";
import { DefaultAriadneOperations } from "../ariadne-operations.js";
import { LaunchOperationAccessPolicy, MapOperationRegistry } from "../operation-registry.js";

describe("shared Ariadne operations", () => {
  let home: string;

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("registers and runs all nine routes with validated result shapes", async () => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-ops-"));
    const transport = new FakeTransport(
      FakeTransport.json(200, { session: contract.session }),
      FakeTransport.json(200, { item: contract.item, created: true }),
      FakeTransport.json(200, { activity: contract.activity, created: true }),
      FakeTransport.json(200, { items: [contract.item] }),
      FakeTransport.json(200, packetEnvelope),
      FakeTransport.json(200, packetEnvelope),
      FakeTransport.json(200, packetEnvelope),
      FakeTransport.json(200, packetContract.reviewerList),
    );
    const env = { ARIADNE_AGENT_TOKEN: agentToken, CLAUDE_CODE_SESSION_ID: "session-1" };
    const tokens = new AriadneTokenStore({ env, home });
    const operations = new DefaultAriadneOperations({
      getBoard: () => new AriadneBoard({ readLayers: () => [], tokens, env, transport }),
      getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
    }).operations();
    const registry = new MapOperationRegistry({
      operations,
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });

    expect(registry.list().map(({ cli }) => cli.path.join(" "))).toEqual([
      "board post heartbeat",
      "board post item",
      "board post activity",
      "board items",
      "packet create",
      "packet new-id",
      "packet update",
      "packet get",
      "packet reviewers",
    ]);
    const heartbeat = await registry.invoke("board-post-heartbeat", {
      input: { session: "0f9a7c4e-1", ticket: "FRT-1", step: "implement", state: "nominal" },
    });
    expect(heartbeat).toMatchObject({
      status: "success",
      data: { status: "ok", value: { session: contract.session } },
    });
    const item = await registry.invoke("board-post-item", {
      input: {
        session: "0f9a7c4e-1",
        ticket: "FRT-1",
        kind: "question",
        title: "Continue?",
        options: ["Yes", "No"],
      },
    });
    expect(item).toMatchObject({
      status: "success",
      data: { status: "ok", value: { created: true } },
    });
    const activity = await registry.invoke("board-post-activity", {
      input: { session: "0f9a7c4e-1", ticket: "FRT-1", text: "Opened a PR" },
    });
    expect(activity).toMatchObject({
      status: "success",
      data: { status: "ok", value: { created: true } },
    });
    const items = await registry.invoke("board-items", { session: "0f9a7c4e-1", ticket: "FRT-1" });
    expect(items).toMatchObject({
      status: "success",
      data: { status: "ok", value: { items: [contract.item] } },
    });
    expect(
      await registry.invoke("packet-create", { packet: packetContract.createRequest }),
    ).toMatchObject({ status: "success", data: storedPacket });
    expect(await registry.invoke("packet-new-id", { title: "A new review" })).toMatchObject({
      status: "success",
      data: { id: expect.stringMatching(/^a-new-review-[0-9a-f]{8}$/) },
    });
    expect(
      await registry.invoke("packet-update", {
        id: storedPacket.id,
        packet: packetContract.updateRequest.packet,
        expectedRevision: 1,
      }),
    ).toMatchObject({ status: "success" });
    expect(await registry.invoke("packet-get", { id: storedPacket.id })).toMatchObject({
      status: "success",
      data: storedPacket,
    });
    const reviewerResult = await registry.invoke("packet-reviewers", {});
    expect(reviewerResult).toMatchObject({ status: "success", data: packetContract.reviewerList });
    expect(transport.requests).toHaveLength(8);
  });

  it("returns skipped board outcomes and rejects denied mutations before transport effects", async () => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-ops-"));
    const transport = new FakeTransport();
    const env = { CLAUDE_CODE_SESSION_ID: "session-1" };
    const tokens = new AriadneTokenStore({ env, home });
    const operations = new DefaultAriadneOperations({
      getBoard: () => new AriadneBoard({ readLayers: () => [], tokens, env, transport }),
      getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
    }).operations();
    const registry = new MapOperationRegistry({
      operations,
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });

    const boardResult = await registry.invoke("board-post-heartbeat", {
      input: { ticket: "FRT-1", step: "start", state: "nominal" },
    });
    expect(boardResult).toMatchObject({
      status: "success",
      data: { status: "skipped", reason: "no-token" },
    });
    expect(
      await registry.invoke("board-post-heartbeat", {
        input: { ticket: "FRT-1", step: "", state: "nominal" },
      }),
    ).toMatchObject({ status: "success", data: { status: "skipped", reason: "no-token" } });
    expect(
      await registry.invoke("board-post-item", {
        input: { ticket: "FRT-1", kind: "question", title: "" },
      }),
    ).toMatchObject({ status: "success", data: { status: "skipped", reason: "no-token" } });
    expect(
      await registry.invoke("board-post-activity", { input: { ticket: "FRT-1", text: "" } }),
    ).toMatchObject({ status: "success", data: { status: "skipped", reason: "no-token" } });
    const deniedRegistry = new MapOperationRegistry({
      operations,
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network"] }),
    });
    expect(
      await deniedRegistry.invoke("packet-create", { packet: packetContract.createRequest }),
    ).toMatchObject({ status: "error", error: { name: "OperationAccessDeniedError" } });
    expect(transport.requests).toHaveLength(0);
  });

  it("returns board validation failures as data when reporting is enabled", async () => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-ops-"));
    const transport = new FakeTransport();
    const env = { ARIADNE_AGENT_TOKEN: agentToken, CLAUDE_CODE_SESSION_ID: "session-1" };
    const tokens = new AriadneTokenStore({ env, home });
    const registry = new MapOperationRegistry({
      operations: new DefaultAriadneOperations({
        getBoard: () => new AriadneBoard({ readLayers: () => [], tokens, env, transport }),
        getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
      }).operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });

    expect(
      await registry.invoke("board-post-heartbeat", {
        input: { session: "0f9a7c4e-1", ticket: "FRT-1", step: "", state: "nominal" },
      }),
    ).toMatchObject({
      status: "success",
      data: { status: "failed", message: expect.stringContaining("step") },
    });
    expect(
      await registry.invoke("board-post-item", {
        input: { session: "0f9a7c4e-1", ticket: "FRT-1", kind: "question", title: "" },
      }),
    ).toMatchObject({
      status: "success",
      data: { status: "failed", message: expect.stringContaining("title") },
    });
    expect(
      await registry.invoke("board-post-activity", {
        input: { session: "0f9a7c4e-1", ticket: "FRT-1", text: "" },
      }),
    ).toMatchObject({
      status: "success",
      data: { status: "failed", message: expect.stringContaining("text") },
    });
    expect(transport.requests).toHaveLength(0);
  });

  it("keeps non-Jira, disabled and invalid-URL reports as explicit skips before credential or transport effects", async () => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-ops-"));
    const transport = new FakeTransport();
    const env = { ARIADNE_AGENT_TOKEN: agentToken, CLAUDE_CODE_SESSION_ID: "session-1" };
    const tokens = new AriadneTokenStore({ env, home });
    const board = (layers: () => readonly { scope: "user"; values: Record<string, unknown> }[]) =>
      new AriadneBoard({ readLayers: layers, tokens, env, transport });
    const operations = new DefaultAriadneOperations({
      getBoard: () => board(() => []),
      getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
    }).operations();
    const registry = new MapOperationRegistry({
      operations,
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });

    for (const [id, input] of [
      ["board-post-heartbeat", { input: { ticket: "263", step: "implement", state: "nominal" } }],
      ["board-post-item", { input: { ticket: "263", kind: "question", title: "Need input?" } }],
      ["board-post-activity", { input: { ticket: "263", text: "Started work" } }],
      ["board-items", { ticket: "263" }],
    ] as const) {
      expect(await registry.invoke(id, input)).toMatchObject({
        status: "success",
        data: { status: "skipped", reason: "not-jira-ticket" },
      });
    }

    const disabledRegistry = new MapOperationRegistry({
      operations: new DefaultAriadneOperations({
        getBoard: () => board(() => [{ scope: "user", values: { "ariadne.enabled": false } }]),
        getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
      }).operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });
    expect(
      await disabledRegistry.invoke("board-post-heartbeat", {
        input: { ticket: "FRT-263", step: "implement", state: "nominal" },
      }),
    ).toMatchObject({ status: "success", data: { status: "skipped", reason: "disabled" } });

    const invalidUrlRegistry = new MapOperationRegistry({
      operations: new DefaultAriadneOperations({
        getBoard: () =>
          board(() => [{ scope: "user", values: { "ariadne.url": "http://external.example" } }]),
        getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
      }).operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });
    expect(
      await invalidUrlRegistry.invoke("board-post-heartbeat", {
        input: { ticket: "FRT-263", step: "implement", state: "nominal" },
      }),
    ).toMatchObject({ status: "success", data: { status: "skipped", reason: "invalid-url" } });
    expect(transport.requests).toHaveLength(0);
  });

  it("preserves packet revision conflicts as operation errors without retrying the mutation", async () => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-ops-"));
    const transport = new FakeTransport(
      FakeTransport.json(409, packetContract.errors["revision_conflict"]),
    );
    const env = { ARIADNE_AGENT_TOKEN: agentToken };
    const tokens = new AriadneTokenStore({ env, home });
    const registry = new MapOperationRegistry({
      operations: new DefaultAriadneOperations({
        getBoard: () => new AriadneBoard({ readLayers: () => [], tokens, env, transport }),
        getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
      }).operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });

    expect(
      await registry.invoke("packet-update", {
        id: storedPacket.id,
        packet: packetContract.updateRequest.packet,
        expectedRevision: 1,
      }),
    ).toMatchObject({
      status: "error",
      error: { name: "AriadnePacketError", message: expect.stringContaining("revision_conflict") },
    });
    expect(transport.requests).toHaveLength(1);
  });

  it("does not repeat board posts or packet creation after a server response", async () => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-ops-"));
    const notFound = () =>
      FakeTransport.json(404, {
        error: "session_not_found",
        message: "Send a heartbeat for this session first.",
      });
    const transport = new FakeTransport(
      notFound(),
      notFound(),
      FakeTransport.json(409, packetContract.errors["packet_id_taken"]),
    );
    const env = { ARIADNE_AGENT_TOKEN: agentToken, CLAUDE_CODE_SESSION_ID: "session-1" };
    const tokens = new AriadneTokenStore({ env, home });
    const registry = new MapOperationRegistry({
      operations: new DefaultAriadneOperations({
        getBoard: () => new AriadneBoard({ readLayers: () => [], tokens, env, transport }),
        getPackets: () => new AriadnePackets({ readLayers: () => [], tokens, transport }),
      }).operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "write", "network"] }),
    });

    expect(
      await registry.invoke("board-post-item", {
        input: { session: "0f9a7c4e-1", ticket: "FRT-1", kind: "question", title: "Continue?" },
      }),
    ).toMatchObject({
      status: "success",
      data: { status: "failed", message: expect.stringContaining("session_not_found") },
    });
    expect(transport.requests).toHaveLength(1);
    expect(
      await registry.invoke("board-post-activity", {
        input: { session: "0f9a7c4e-1", ticket: "FRT-1", text: "Started" },
      }),
    ).toMatchObject({
      status: "success",
      data: { status: "failed", message: expect.stringContaining("session_not_found") },
    });
    expect(transport.requests).toHaveLength(2);
    expect(
      await registry.invoke("packet-create", { packet: packetContract.createRequest }),
    ).toMatchObject({ status: "error", error: { message: expect.stringContaining("new-id") } });
    expect(transport.requests).toHaveLength(3);
  });
});
