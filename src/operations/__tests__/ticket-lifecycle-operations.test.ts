import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTicketCommand } from "../../tasks/commands/ticket/command.js";
import type { Comment, TaskTracker } from "../../tasks/task-tracker/task-tracker.js";
import { LaunchOperationAccessPolicy } from "../operation-registry.js";
import { DefaultTrackerEntityOperations } from "../tracker-entity-operations.js";

const comment: Comment = {
  id: "COMMENT-1",
  body: "Evidence",
  author: "Ada",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const rootDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of rootDirs.splice(0)) rmSync(root, { recursive: true, force: true });
});

const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), "ticket-lifecycle-"));
  rootDirs.push(path);
  return path;
};

const trackerFixture = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn(),
  getTicket: vi.fn().mockResolvedValue({ metadata: {} }),
  linkTicketToEpic: vi.fn(),
  getTicketEpicId: vi.fn().mockResolvedValue(null),
  blockTicket: vi.fn(),
  unblockTicket: vi.fn(),
  transitionTicket: vi.fn(),
  listTransitions: vi.fn(),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  updateEpicDescription: vi.fn(),
  updateTicketDescription: vi.fn(),
  updateInitiativeDescription: vi.fn(),
  createTechnicalDesign: vi.fn(),
  createInitiative: vi.fn(),
  getInitiative: vi.fn(),
  linkEpicToInitiative: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn().mockResolvedValue(comment),
  addAttachment: vi.fn().mockResolvedValue({
    id: "ATT-1",
    filename: "proof.png",
    mimeType: "image/png",
  }),
  getUsers: vi.fn(),
  ping: vi.fn(),
});

const openRegistry = (
  tracker: TaskTracker,
  cwd: string,
  policy = new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }),
) => new DefaultTrackerEntityOperations({ getTracker: () => tracker, cwd }).registry(policy);

const command = (tracker: TaskTracker, registry: ReturnType<typeof openRegistry>) => {
  const program = new Command("flight-rules");
  program.exitOverride();
  program.addCommand(createTicketCommand(() => tracker, registry));
  return program;
};

describe("ticket lifecycle shared operations", () => {
  it("registers all five lifecycle routes as completed shared operations", () => {
    const tracker = trackerFixture();
    const routes = new DefaultTrackerEntityOperations({ getTracker: () => tracker, cwd: root() })
      .operations()
      .filter(
        ({ id }) =>
          id.startsWith("ticket-") &&
          ["block", "unblock", "status", "comment", "label"].some(
            (action) => id === `ticket-${action}`,
          ),
      );
    expect(routes.map(({ id, cli }) => [id, cli.path])).toEqual([
      ["ticket-block", ["ticket", "block"]],
      ["ticket-unblock", ["ticket", "unblock"]],
      ["ticket-status", ["ticket", "status"]],
      ["ticket-comment", ["ticket", "comment"]],
      ["ticket-label", ["ticket", "label"]],
    ]);
  });

  it("denies every lifecycle mutation before resolving a tracker", async () => {
    const getTracker = vi.fn(() => trackerFixture());
    const registry = new DefaultTrackerEntityOperations({ getTracker, cwd: root() }).registry();
    for (const [id, input] of [
      ["ticket-block", { ticketId: "T-1", blockerId: "T-2" }],
      ["ticket-unblock", { ticketId: "T-1", blockerId: "T-2" }],
      ["ticket-status", { id: "T-1", status: "Done" }],
      ["ticket-comment", { id: "T-1", body: "hello" }],
      ["ticket-label", { id: "T-1", add: ["bug"] }],
    ] as const) {
      await expect(registry.invoke(id, input)).resolves.toMatchObject({
        status: "error",
        error: { name: "OperationAccessDeniedError" },
      });
    }
    expect(getTracker).not.toHaveBeenCalled();
  });

  it("returns a validated acknowledgement for each lifecycle operation", async () => {
    const tracker = trackerFixture();
    const registry = openRegistry(tracker, root());
    const requests = [
      ["ticket-block", { ticketId: "T-1", blockerId: "T-2" }],
      ["ticket-unblock", { ticketId: "T-1", blockerId: "T-2" }],
      ["ticket-status", { id: "T-1", status: "Done" }],
      ["ticket-comment", { id: "T-1", body: "hello", attach: [] }],
      ["ticket-label", { id: "T-1", add: ["bug"], remove: [] }],
    ] as const;
    for (const [id, input] of requests) {
      await expect(registry.invoke(id, input)).resolves.toMatchObject({ status: "success" });
    }
    expect(tracker.blockTicket).toHaveBeenCalledOnce();
    expect(tracker.unblockTicket).toHaveBeenCalledOnce();
    expect(tracker.transitionTicket).toHaveBeenCalledOnce();
    expect(tracker.addComment).toHaveBeenCalledOnce();
    expect(tracker.addLabel).toHaveBeenCalledOnce();
  });

  it("preserves the epic guard refusal and records an explicit cross-epic reason", async () => {
    const tracker = trackerFixture();
    vi.mocked(tracker.getTicketEpicId).mockImplementation(async (id) =>
      id === "T-1" ? "E-1" : "E-2",
    );
    const registry = openRegistry(tracker, root());
    await expect(
      registry.invoke("ticket-block", { ticketId: "T-1", blockerId: "T-2" }),
    ).resolves.toMatchObject({
      status: "error",
      error: {
        name: "CrossEpicDependencyError",
        message: expect.stringContaining("--cross-epic-reason"),
      },
    });
    expect(tracker.blockTicket).not.toHaveBeenCalled();

    vi.mocked(tracker.getTicket).mockResolvedValue({ metadata: { crossEpicReasons: {} } } as never);
    await expect(
      registry.invoke("ticket-block", {
        ticketId: "T-1",
        blockerId: "T-2",
        reason: " upstream API contract ",
      }),
    ).resolves.toMatchObject({
      status: "success",
      data: { crossEpic: true, reasonRecorded: true },
    });
    expect(tracker.blockTicket).toHaveBeenCalledOnce();
    expect(tracker.addComment).toHaveBeenCalledWith(
      "T-1",
      expect.stringContaining("Reason: upstream API contract"),
    );
    expect(tracker.updateTicketMetadata).toHaveBeenCalledWith("T-1", {
      crossEpicReasons: { "T-2": "upstream API contract" },
    });
  });

  it("keeps unsupported transition errors and CLI JSON output compatible", async () => {
    const tracker = trackerFixture();
    vi.mocked(tracker.transitionTicket).mockRejectedValue(
      new Error("unsupported transition: Backlog -> Done"),
    );
    const registry = openRegistry(tracker, root());
    await expect(
      registry.invoke("ticket-status", { id: "T-1", status: "Done" }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: "unsupported transition: Backlog -> Done" },
    });
    vi.mocked(tracker.transitionTicket).mockResolvedValue();
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await command(tracker, registry).parseAsync(["ticket", "status", "T-1", "--to", "In Review"], {
      from: "user",
    });
    expect(output).toHaveBeenCalledWith('{"id":"T-1","status":"In Review"}\n');
  });

  it("keeps unblock, comment and label CLI routes on their shared operation handlers", async () => {
    const cwd = root();
    const image = join(cwd, "proof.png");
    writeFileSync(image, "image");
    const tracker = trackerFixture();
    const registry = openRegistry(tracker, cwd);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await command(tracker, registry).parseAsync(["ticket", "unblock", "T-1", "--by", "T-2"], {
      from: "user",
    });
    await command(tracker, registry).parseAsync(
      ["ticket", "comment", "T-1", "--body", "![Proof](./proof.png)", "--attach", image],
      { from: "user" },
    );
    await command(tracker, registry).parseAsync(
      ["ticket", "label", "T-1", "--add", "new", "--remove", "old"],
      { from: "user" },
    );
    expect(tracker.unblockTicket).toHaveBeenCalledWith("T-1", "T-2");
    expect(tracker.addComment).toHaveBeenCalledWith("T-1", "![Proof](attachment:proof.png)");
    expect(vi.mocked(tracker.removeLabel).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(tracker.addLabel).mock.invocationCallOrder[0] ?? 0,
    );
    expect(output).toHaveBeenCalledWith(JSON.stringify(comment) + "\n");
    expect(output).toHaveBeenCalledWith('{"id":"T-1","added":["new"],"removed":["old"]}\n');
  });

  it("returns attachment identities on upload failure and rejects untrusted realpaths before mutation", async () => {
    const cwd = root();
    const first = join(cwd, "first.png");
    const failed = join(cwd, "failed.png");
    writeFileSync(first, "image");
    writeFileSync(failed, "image");
    const tracker = trackerFixture();
    vi.mocked(tracker.addAttachment).mockImplementation(async (_id, path) => {
      if (path.endsWith("/failed.png")) throw new Error("upload unavailable");
      return { id: "ATT-1", filename: "first.png", mimeType: "image/png" };
    });
    const registry = openRegistry(tracker, cwd);
    await expect(
      registry.invoke("ticket-comment", {
        id: "T-1",
        body: "Proof",
        attach: [first, failed],
      }),
    ).resolves.toEqual({
      status: "partial",
      data: {
        id: "T-1",
        attachments: [
          {
            id: "ATT-1",
            filename: "first.png",
            mimeType: "image/png",
            path: realpathSync(first),
            caption: "first.png",
            referenced: false,
          },
        ],
        body: "Proof\n\n![first.png](attachment:first.png)",
        completedSteps: ["attachment-uploaded:ATT-1"],
      },
      error: { name: "Error", message: "upload unavailable" },
    });
    expect(tracker.addComment).not.toHaveBeenCalled();

    const outside = root();
    const secret = join(outside, "secret.png");
    const escape = join(cwd, "escape.png");
    writeFileSync(secret, "secret");
    symlinkSync(secret, escape);
    await expect(
      registry.invoke("ticket-comment", { id: "T-1", body: "", attach: [escape] }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("outside trusted roots") },
    });
    expect(tracker.addComment).not.toHaveBeenCalled();
  });

  it("reports confirmed label effects if a later addition fails, without replay", async () => {
    const tracker = trackerFixture();
    vi.mocked(tracker.addLabel).mockRejectedValueOnce(new Error("label service unavailable"));
    const registry = openRegistry(tracker, root());
    await expect(
      registry.invoke("ticket-label", { id: "T-1", remove: ["old"], add: ["new", "later"] }),
    ).resolves.toEqual({
      status: "partial",
      data: {
        id: "T-1",
        added: [],
        removed: ["old"],
        requestedAdd: ["new", "later"],
        requestedRemove: ["old"],
        completedSteps: ["removed:old"],
      },
      error: { name: "Error", message: "label service unavailable" },
    });
    expect(tracker.removeLabel).toHaveBeenCalledOnce();
    expect(tracker.addLabel).toHaveBeenCalledExactlyOnceWith("T-1", "new");
  });

  it("keeps a completed earlier addition in a later partial label acknowledgement", async () => {
    const tracker = trackerFixture();
    vi.mocked(tracker.addLabel).mockImplementation(async (_id, label) => {
      if (label === "later") throw new Error("second label failed");
    });
    const registry = openRegistry(tracker, root());

    await expect(
      registry.invoke("ticket-label", { id: "T-1", remove: ["old"], add: ["new", "later"] }),
    ).resolves.toEqual({
      status: "partial",
      data: {
        id: "T-1",
        added: ["new"],
        removed: ["old"],
        requestedAdd: ["new", "later"],
        requestedRemove: ["old"],
        completedSteps: ["removed:old", "added:new"],
      },
      error: { name: "Error", message: "second label failed" },
    });
    expect(tracker.addLabel).toHaveBeenCalledTimes(2);
    expect(tracker.addLabel).toHaveBeenNthCalledWith(1, "T-1", "new");
    expect(tracker.addLabel).toHaveBeenNthCalledWith(2, "T-1", "later");
  });

  it("rejects an empty label change before a tracker call", async () => {
    const tracker = trackerFixture();
    const registry = openRegistry(tracker, root());
    await expect(registry.invoke("ticket-label", { id: "T-1" })).rejects.toThrow(/at least one/);
    expect(tracker.removeLabel).not.toHaveBeenCalled();
    expect(tracker.addLabel).not.toHaveBeenCalled();
  });
});
