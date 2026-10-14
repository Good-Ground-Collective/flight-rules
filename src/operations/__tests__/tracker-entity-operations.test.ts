import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEpicCommand } from "../../tasks/commands/epic/command.js";
import { createInitiativeCommand } from "../../tasks/commands/initiative/command.js";
import { createTddCommand } from "../../tasks/commands/tdd/command.js";
import { createTicketCommand } from "../../tasks/commands/ticket/command.js";
import type { TaskTracker } from "../../tasks/task-tracker/task-tracker.js";
import { TaskTrackerPartialWriteError } from "../../tasks/task-tracker/task-tracker.js";
import { LaunchOperationAccessPolicy } from "../operation-registry.js";
import { DefaultTrackerEntityOperations } from "../tracker-entity-operations.js";

const epic = {
  id: "EPIC-1",
  size: "epic" as const,
  status: "open",
  labels: ["epic"],
  title: "A portable epic",
  body: "Epic body",
  childIssues: [],
  comments: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
};
const initiative = {
  id: "INIT-1",
  size: "initiative" as const,
  title: "Initiative",
  body: "Initiative body",
  epics: [],
};
const ticket = {
  id: "TICKET-1",
  size: "ticket" as const,
  status: "open",
  labels: ["feature"],
  title: "Ticket",
  body: "Ticket body",
  comments: [],
  assignee: null,
  attachments: [],
  reporter: null,
  issueType: "Story",
  blockedBy: [],
  blocking: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
};
const tdd = {
  id: "TDD-1",
  epicId: "EPIC-1",
  body: "Design body",
  comments: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
};

const temporaryRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "tracker-entity-"));
  temporaryRoots.push(root);
  return root;
};

const makeTracker = (): TaskTracker =>
  ({
    createEpic: vi.fn().mockResolvedValue(epic),
    getEpic: vi.fn().mockResolvedValue(epic),
    createTicket: vi.fn().mockResolvedValue(ticket),
    getTicket: vi.fn().mockResolvedValue(ticket),
    linkTicketToEpic: vi.fn(),
    getTicketEpicId: vi.fn().mockResolvedValue(null),
    blockTicket: vi.fn(),
    unblockTicket: vi.fn(),
    transitionTicket: vi.fn(),
    listTransitions: vi.fn().mockResolvedValue([]),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    updateEpicMetadata: vi.fn(),
    updateTicketMetadata: vi.fn(),
    updateTddMetadata: vi.fn(),
    updateEpicDescription: vi.fn().mockResolvedValue(epic),
    updateTicketDescription: vi.fn().mockResolvedValue(ticket),
    updateInitiativeDescription: vi.fn().mockResolvedValue(initiative),
    createInitiative: vi.fn().mockResolvedValue(initiative),
    getInitiative: vi.fn().mockResolvedValue(initiative),
    linkEpicToInitiative: vi.fn(),
    createTechnicalDesign: vi.fn().mockResolvedValue(tdd),
    getTechnicalDesign: vi.fn().mockResolvedValue(tdd),
    addComment: vi.fn(),
    addAttachment: vi
      .fn()
      .mockResolvedValue({ id: "ATT-1", filename: "proof.png", mimeType: "image/png" }),
    getUsers: vi.fn().mockResolvedValue([]),
    ping: vi.fn(),
  }) as TaskTracker;

const createProgram = (
  registry: ReturnType<DefaultTrackerEntityOperations["registry"]>,
  tracker: TaskTracker,
) => {
  const program = new Command("flight-rules");
  program.exitOverride();
  program.addCommand(
    createEpicCommand(
      () => tracker,
      () => ({
        createPullRequest: vi.fn(),
        commentOnPullRequest: vi.fn(),
        listOpenPullRequestsForTickets: vi.fn().mockResolvedValue([]),
        defaultBranch: vi.fn().mockResolvedValue("main"),
        requestReviewers: vi.fn(),
      }),
      () => ({ inReviewStatus: "In Review" }),
      registry,
    ),
  );
  program.addCommand(
    createInitiativeCommand(
      () => tracker,
      () => ({
        createPullRequest: vi.fn(),
        commentOnPullRequest: vi.fn(),
        listOpenPullRequestsForTickets: vi.fn().mockResolvedValue([]),
        defaultBranch: vi.fn().mockResolvedValue("main"),
        requestReviewers: vi.fn(),
      }),
      () => ({ inReviewStatus: "In Review" }),
      registry,
    ),
  );
  program.addCommand(createTicketCommand(() => tracker, registry));
  program.addCommand(createTddCommand(() => tracker, registry));
  return program;
};

describe("tracker entity operations", () => {
  it.each([
    {
      id: "epic-create",
      input: { title: "A portable epic", body: "Epic body", labels: [" epic ", "epic", " "] },
      args: [
        "epic",
        "create",
        "--title",
        "A portable epic",
        "--body",
        "Epic body",
        "--labels",
        " epic ,epic, ",
      ],
      result: epic,
    },
    {
      id: "epic-edit",
      input: { id: "EPIC-1", body: "Revised epic", title: "Renamed" },
      args: ["epic", "edit", "EPIC-1", "--body", "Revised epic", "--title", "Renamed"],
      result: epic,
    },
    {
      id: "epic-link-initiative",
      input: { epicId: "EPIC-1", initiativeId: "INIT-1" },
      args: ["epic", "link-initiative", "EPIC-1", "--initiative", "INIT-1"],
      result: { epicId: "EPIC-1", initiativeId: "INIT-1" },
    },
    {
      id: "initiative-create",
      input: { title: "Initiative", body: "Initiative body" },
      args: ["initiative", "create", "--title", "Initiative", "--body", "Initiative body"],
      result: initiative,
    },
    {
      id: "initiative-edit",
      input: { id: "INIT-1", body: "Updated initiative", title: "Updated" },
      args: ["initiative", "edit", "INIT-1", "--body", "Updated initiative", "--title", "Updated"],
      result: initiative,
    },
    {
      id: "ticket-create",
      input: {
        title: "Ticket",
        body: "Ticket body",
        epicId: "EPIC-1",
        labels: [" bug ", "feature"],
        assignee: "alice",
      },
      args: [
        "ticket",
        "create",
        "--title",
        "Ticket",
        "--body",
        "Ticket body",
        "--epic-id",
        "EPIC-1",
        "--labels",
        " bug ,feature",
        "--assignee",
        "alice",
      ],
      result: ticket,
    },
    {
      id: "ticket-edit",
      input: { id: "TICKET-1", body: "Edited ticket" },
      args: ["ticket", "edit", "TICKET-1", "--body", "Edited ticket"],
      result: ticket,
    },
    {
      id: "tdd-create",
      input: { title: "Design", body: "Design body", epicId: "EPIC-1" },
      args: ["tdd", "create", "--title", "Design", "--body", "Design body", "--epic-id", "EPIC-1"],
      result: tdd,
    },
  ])(
    "serves $id through its shared handler and Commander route",
    async ({ id, input, args, result }) => {
      const root = makeRoot();
      const tracker = makeTracker();
      const writes = new DefaultTrackerEntityOperations({ getTracker: () => tracker, cwd: root });
      const registry = writes.registry(
        new LaunchOperationAccessPolicy({
          allowedEffects: ["read", "write", "network", "process"],
        }),
      );
      const operation = await registry.invoke(id, input);
      expect(operation).toEqual({ status: "success", data: result });
      if (operation.status !== "success") throw new Error("Expected a successful entity operation");

      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await createProgram(registry, tracker).parseAsync(args, { from: "user" });
      if (id === "epic-link-initiative") {
        expect(output).not.toHaveBeenCalled();
      } else {
        expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual(operation.data);
      }
    },
  );

  it("denies writes before resolving the tracker and defaults to read-only access", async () => {
    const getTracker = vi.fn(() => makeTracker());
    const registry = new DefaultTrackerEntityOperations({ getTracker, cwd: makeRoot() }).registry();

    await expect(
      registry.invoke("ticket-create", { title: "T", body: "B" }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationAccessDeniedError" },
    });
    expect(getTracker).not.toHaveBeenCalled();
  });

  it("rejects nonportable bodies before tracker mutation unless the caller declares local-path intent", async () => {
    const tracker = makeTracker();
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: makeRoot(),
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-create", { title: "T", body: "See ~/planning/notes.md" }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("references files on this machine") },
    });
    expect(tracker.createTicket).not.toHaveBeenCalled();
    await expect(
      registry.invoke("ticket-create", {
        title: "T",
        body: "The local file is the subject: ~/planning/notes.md",
        allowLocalPaths: true,
        trustedRoots: ["/"],
      }),
    ).rejects.toThrow(/Unrecognized key/);
  });

  it("checks attachment realpaths under launch roots before upload", async () => {
    const root = makeRoot();
    const outside = makeRoot();
    const realAttachment = join(outside, "secret.png");
    const escape = join(root, "escape.png");
    writeFileSync(realAttachment, "image");
    symlinkSync(realAttachment, escape);
    const tracker = makeTracker();
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: root,
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-edit", {
        id: "TICKET-1",
        body: "No attachment marker yet",
        attach: [escape],
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("outside trusted roots") },
    });
    expect(tracker.addAttachment).not.toHaveBeenCalled();
    expect(tracker.updateTicketDescription).not.toHaveBeenCalled();
  });

  it("rewrites an absolute trusted attachment reference before checking body portability", async () => {
    const root = makeRoot();
    const image = join(root, "proof.png");
    writeFileSync(image, "image");
    const tracker = makeTracker();
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: root,
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-edit", {
        id: "TICKET-1",
        body: `![proof](${image})`,
        attach: [image],
      }),
    ).resolves.toMatchObject({ status: "success" });
    expect(tracker.addAttachment).toHaveBeenCalledOnce();
    expect(tracker.updateTicketDescription).toHaveBeenCalledWith("TICKET-1", {
      body: "![proof](attachment:proof.png)",
    });
  });

  it("rejects unrelated local body paths before uploading a trusted attachment", async () => {
    const root = makeRoot();
    const image = join(root, "proof.png");
    writeFileSync(image, "image");
    const tracker = makeTracker();
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: root,
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-edit", {
        id: "TICKET-1",
        body: "Unrelated context: /Users/alice/private/notes.md",
        attach: [image],
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("references files on this machine") },
    });
    expect(tracker.addAttachment).not.toHaveBeenCalled();
    expect(tracker.updateTicketDescription).not.toHaveBeenCalled();
  });

  it("does not treat a different absolute file with the same basename as an attachment", async () => {
    const root = makeRoot();
    const attachment = join(root, "proof.png");
    writeFileSync(attachment, "image");
    const unrelated = "/Users/alice/private/proof.png";
    const tracker = makeTracker();
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: root,
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-edit", {
        id: "TICKET-1",
        body: `![proof](${unrelated})`,
        attach: [attachment],
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("references files on this machine") },
    });
    expect(tracker.addAttachment).not.toHaveBeenCalled();
    expect(tracker.updateTicketDescription).not.toHaveBeenCalled();
  });

  it("returns uploaded attachment identity when the later ticket edit fails without retrying", async () => {
    const root = makeRoot();
    const image = join(root, "proof.png");
    writeFileSync(image, "image");
    const tracker = makeTracker();
    vi.mocked(tracker.updateTicketDescription).mockRejectedValueOnce(
      new Error("tracker write failed"),
    );
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: root,
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-edit", { id: "TICKET-1", body: "Evidence", attach: [image] }),
    ).resolves.toEqual({
      status: "partial",
      data: {
        id: "TICKET-1",
        attachments: [{ id: "ATT-1", filename: "proof.png", mimeType: "image/png" }],
        body: "Evidence\n\n![proof.png](attachment:proof.png)",
      },
      error: { name: "Error", message: "tracker write failed" },
    });
    expect(tracker.addAttachment).toHaveBeenCalledOnce();
    expect(tracker.updateTicketDescription).toHaveBeenCalledOnce();
  });

  it("returns a created ticket identity when its parent link fails", async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.createTicket).mockRejectedValueOnce(
      new TaskTrackerPartialWriteError({
        id: "TICKET-901",
        cause: new Error("Parent link unavailable"),
      }),
    );
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: makeRoot(),
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-create", {
        title: "Created once",
        body: "Portable body",
        epicId: "EPIC-77",
      }),
    ).resolves.toEqual({
      status: "partial",
      data: { id: "TICKET-901", title: "Created once" },
      error: { name: "TaskTrackerPartialWriteError", message: "Parent link unavailable" },
    });
    expect(tracker.createTicket).toHaveBeenCalledOnce();
  });

  it.each([
    {
      id: "epic-create",
      setup: (tracker: TaskTracker) =>
        vi
          .mocked(tracker.createEpic)
          .mockRejectedValueOnce(
            new TaskTrackerPartialWriteError({ id: "EPIC-901", cause: new Error("read failed") }),
          ),
      input: { title: "Created epic", body: "Body" },
      data: { id: "EPIC-901", title: "Created epic", body: "Body" },
    },
    {
      id: "epic-edit",
      setup: (tracker: TaskTracker) =>
        vi
          .mocked(tracker.updateEpicDescription)
          .mockRejectedValueOnce(
            new TaskTrackerPartialWriteError({ id: "EPIC-1", cause: new Error("read failed") }),
          ),
      input: { id: "EPIC-1", body: "Edited epic" },
      data: { id: "EPIC-1", body: "Edited epic" },
    },
    {
      id: "initiative-create",
      setup: (tracker: TaskTracker) =>
        vi
          .mocked(tracker.createInitiative)
          .mockRejectedValueOnce(
            new TaskTrackerPartialWriteError({ id: "INIT-901", cause: new Error("read failed") }),
          ),
      input: { title: "Created initiative", body: "Body" },
      data: { id: "INIT-901", title: "Created initiative", body: "Body" },
    },
    {
      id: "initiative-edit",
      setup: (tracker: TaskTracker) =>
        vi
          .mocked(tracker.updateInitiativeDescription)
          .mockRejectedValueOnce(
            new TaskTrackerPartialWriteError({ id: "INIT-1", cause: new Error("read failed") }),
          ),
      input: { id: "INIT-1", body: "Edited initiative" },
      data: { id: "INIT-1", body: "Edited initiative" },
    },
    {
      id: "ticket-edit",
      setup: (tracker: TaskTracker) =>
        vi
          .mocked(tracker.updateTicketDescription)
          .mockRejectedValueOnce(
            new TaskTrackerPartialWriteError({ id: "TICKET-1", cause: new Error("read failed") }),
          ),
      input: { id: "TICKET-1", body: "Edited ticket" },
      data: { id: "TICKET-1", attachments: [], body: "Edited ticket" },
    },
    {
      id: "tdd-create",
      setup: (tracker: TaskTracker) =>
        vi.mocked(tracker.createTechnicalDesign).mockRejectedValueOnce(
          new TaskTrackerPartialWriteError({
            id: "TDD-901",
            cause: new Error("metadata write failed"),
          }),
        ),
      input: { title: "Created design", body: "Body", epicId: "EPIC-1" },
      data: { id: "TDD-901", epicId: "EPIC-1", body: "Body" },
    },
  ])("preserves identity for a partial $id operation", async ({ id, setup, input, data }) => {
    const tracker = makeTracker();
    setup(tracker);
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: makeRoot(),
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(registry.invoke(id, input)).resolves.toEqual({
      status: "partial",
      data,
      error: { name: "TaskTrackerPartialWriteError", message: expect.any(String) },
    });
  });

  it("returns identities from earlier uploads when a later attachment upload fails", async () => {
    const root = makeRoot();
    const first = join(root, "first.png");
    const second = join(root, "second.png");
    writeFileSync(first, "image");
    writeFileSync(second, "image");
    const tracker = makeTracker();
    vi.mocked(tracker.addAttachment)
      .mockResolvedValueOnce({ id: "ATT-1", filename: "first.png", mimeType: "image/png" })
      .mockRejectedValueOnce(new Error("upload failed"));
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: root,
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("ticket-edit", {
        id: "TICKET-1",
        body: "Evidence",
        attach: [first, second],
      }),
    ).resolves.toEqual({
      status: "partial",
      data: {
        id: "TICKET-1",
        attachments: [{ id: "ATT-1", filename: "first.png", mimeType: "image/png" }],
        body: "Evidence",
      },
      error: { name: "Error", message: "upload failed" },
    });
    expect(tracker.addAttachment).toHaveBeenCalledTimes(2);
    expect(tracker.updateTicketDescription).not.toHaveBeenCalled();
  });

  it("rejects attachment and label-only invalid inputs before handler invocation", async () => {
    const tracker = makeTracker();
    const registry = new DefaultTrackerEntityOperations({
      getTracker: () => tracker,
      cwd: makeRoot(),
    }).registry(new LaunchOperationAccessPolicy({ allowedEffects: ["write", "network"] }));

    await expect(
      registry.invoke("epic-create", { title: "E", body: "B", labels: [1] }),
    ).rejects.toMatchObject({
      name: "OperationInputError",
    });
    expect(tracker.createEpic).not.toHaveBeenCalled();
  });
});
