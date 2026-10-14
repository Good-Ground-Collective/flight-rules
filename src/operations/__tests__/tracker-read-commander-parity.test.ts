import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestHost } from "../../pr/pull-request-host/pull-request-host.js";
import { createEpicCommand } from "../../tasks/commands/epic/command.js";
import { createInitiativeCommand } from "../../tasks/commands/initiative/command.js";
import { createTddCommand } from "../../tasks/commands/tdd/command.js";
import { createTicketCommand } from "../../tasks/commands/ticket/command.js";
import { createUsersCommand } from "../../tasks/commands/users/command.js";
import { UnsupportedTrackerOperationError } from "../../tasks/task-tracker/unsupported-tracker-operation-error.js";
import type {
  Epic,
  Initiative,
  TaskTracker,
  TechnicalDesign,
  Ticket,
  TrackerUser,
} from "../../tasks/task-tracker/task-tracker.js";
import type { OperationCliError, OperationRegistry } from "../operation-registry.js";
import { DefaultTrackerReadOperations } from "../tracker-read-operations.js";

const ticket = (id: string, status = "open", blockedBy: string[] = []): Ticket => ({
  id,
  size: "ticket",
  status,
  labels: ["ticket"],
  title: `Ticket ${id}`,
  body: "## Acceptance Criteria\n- [x] Shared behavior",
  comments: [],
  assignee: "reviewer",
  attachments: [],
  reporter: "author",
  issueType: "Story",
  blockedBy,
  blocking: [],
  metadata: {},
  updatedAt: "2026-10-01T00:00:00Z",
});

const epic = (id: string, tickets: Ticket[]): Epic => ({
  id,
  size: "epic",
  status: "open",
  labels: ["epic"],
  title: `Epic ${id}`,
  body: "Epic body",
  childIssues: tickets,
  comments: [],
  metadata: {},
  updatedAt: "2026-10-01T00:00:00Z",
});

const initiative: Initiative = {
  id: "DISC-1",
  size: "initiative",
  title: "Initiative DISC-1",
  body: "Initiative body",
  epics: [
    { id: "PROJ-10", title: "Epic PROJ-10" },
    { id: "PROJ-20", title: "Epic PROJ-20" },
  ],
};

const design: TechnicalDesign = {
  id: "PAGE-12",
  epicId: "PROJ-10",
  url: "https://example.test/wiki/PAGE-12",
  body: "Design body",
  comments: [],
  metadata: {},
  updatedAt: "2026-10-01T00:00:00Z",
};

const users: TrackerUser[] = [{ accountId: "reviewer", displayName: "Reviewer" }];
const epics = [
  epic("PROJ-10", [ticket("PROJ-11", "In Review"), ticket("PROJ-12", "open", ["PROJ-11"])]),
  epic("PROJ-20", [ticket("PROJ-21", "open")]),
];

const makeTracker = (overrides: Partial<TaskTracker> = {}): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(async (id: string) => epics.find((item) => item.id === id) ?? epic(id, [])),
  createTicket: vi.fn(),
  getTicket: vi.fn(async (id: string) => ticket(id)),
  linkTicketToEpic: vi.fn(),
  getTicketEpicId: vi.fn().mockResolvedValue(null),
  blockTicket: vi.fn(),
  unblockTicket: vi.fn(),
  transitionTicket: vi.fn(),
  listTransitions: vi.fn().mockResolvedValue(["In Progress", "Done"]),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  updateEpicDescription: vi.fn(),
  updateTicketDescription: vi.fn(),
  updateInitiativeDescription: vi.fn(),
  createInitiative: vi.fn(),
  getInitiative: vi.fn().mockResolvedValue(initiative),
  linkEpicToInitiative: vi.fn(),
  createTechnicalDesign: vi.fn(),
  getTechnicalDesign: vi.fn().mockResolvedValue(design),
  addComment: vi.fn(),
  addAttachment: vi.fn(),
  getUsers: vi.fn().mockResolvedValue(users),
  ping: vi.fn(),
  ...overrides,
});

const makeHost = (): PullRequestHost => ({
  createPullRequest: vi.fn(),
  commentOnPullRequest: vi.fn(),
  listOpenPullRequestsForTickets: vi.fn().mockResolvedValue([
    {
      ticket: "PROJ-11",
      number: 77,
      url: "https://example.test/pull/77",
      headRefName: "feature/proj-11",
      baseRefName: "main",
      title: "Add the shared path",
    },
  ]),
  defaultBranch: vi.fn().mockResolvedValue("main"),
  requestReviewers: vi.fn(),
});

const makeProgram = (
  registry: OperationRegistry,
  tracker: TaskTracker,
  host: PullRequestHost,
): Command => {
  const program = new Command("flight-rules");
  program.exitOverride();
  program.addCommand(
    createEpicCommand(
      () => tracker,
      () => host,
      () => ({ inReviewStatus: "In Review" }),
      registry,
    ),
  );
  program.addCommand(
    createInitiativeCommand(
      () => tracker,
      () => host,
      () => ({ inReviewStatus: "In Review" }),
      registry,
    ),
  );
  program.addCommand(createTicketCommand(() => tracker, registry));
  program.addCommand(createTddCommand(() => tracker, registry));
  program.addCommand(createUsersCommand(() => tracker, registry));
  return program;
};

const planOutput = (value: unknown) => {
  const data = value as { waves: unknown[][]; cycles: string[]; crossEpicEdges: unknown[] };
  return { waves: data.waves, cycles: data.cycles, crossEpicEdges: data.crossEpicEdges };
};

const reviewOutput = (value: unknown) => {
  const data = value as {
    epic?: { id: string; title: string };
    initiative?: { id: string; title: string };
    defaultBranch: string;
    route: string;
    reasons: string[];
    missing: string[];
    blocked: unknown[];
    unblocksOnMerge: string[];
    crossEpicEdges: unknown[];
  };
  return {
    ...(data.epic === undefined ? {} : { epic: data.epic }),
    ...(data.initiative === undefined ? {} : { initiative: data.initiative }),
    defaultBranch: data.defaultBranch,
    route: data.route,
    reasons: data.reasons,
    missing: data.missing,
    blocked: data.blocked,
    unblocksOnMerge: data.unblocksOnMerge,
    crossEpicEdges: data.crossEpicEdges,
  };
};

describe("tracker read Commander parity", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { id: "ticket-get", args: ["ticket", "get", "PROJ-11"], input: { id: "PROJ-11" } },
    {
      id: "ticket-get",
      args: ["ticket", "get", "PROJ-11", "--section", "acceptance-criteria"],
      input: { id: "PROJ-11", section: "acceptance-criteria" },
    },
    {
      id: "ticket-transitions",
      args: ["ticket", "transitions", "PROJ-11"],
      input: { id: "PROJ-11" },
    },
    { id: "users-get", args: ["users", "get"], input: {} },
    { id: "tdd-get", args: ["tdd", "get", "PAGE-12"], input: { id: "PAGE-12" } },
    { id: "epic-get", args: ["epic", "get", "PROJ-10"], input: { id: "PROJ-10" } },
    { id: "initiative-get", args: ["initiative", "get", "DISC-1"], input: { id: "DISC-1" } },
    {
      id: "epic-plan",
      args: ["epic", "plan", "PROJ-10"],
      input: { id: "PROJ-10" },
      project: planOutput,
    },
    {
      id: "epic-review-plan",
      args: ["epic", "review-plan", "PROJ-10"],
      input: { id: "PROJ-10" },
      project: reviewOutput,
    },
    {
      id: "initiative-plan",
      args: ["initiative", "plan", "DISC-1"],
      input: { id: "DISC-1" },
      project: planOutput,
    },
    {
      id: "initiative-review-plan",
      args: ["initiative", "review-plan", "DISC-1"],
      input: { id: "DISC-1" },
      project: reviewOutput,
    },
  ])("matches operation $id with its Commander route", async ({ id, args, input, project }) => {
    const tracker = makeTracker();
    const host = makeHost();
    const registry = new DefaultTrackerReadOperations({
      getTracker: () => tracker,
      getPrHost: () => host,
      getConfig: () => ({ inReviewStatus: "In Review" }),
    }).registry();
    const operation = await registry.invoke(id, input);
    expect(operation.status).toBe("success");
    if (operation.status !== "success") throw new Error(operation.error.message);

    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await makeProgram(registry, tracker, host).parseAsync(args, { from: "user" });
      const rendered = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      expect(rendered).toEqual(project === undefined ? operation.data : project(operation.data));
    } finally {
      output.mockRestore();
      errors.mockRestore();
    }
  });

  it.each([
    { id: "ticket-get", args: ["ticket", "get", ""], input: { id: "" } },
    { id: "ticket-transitions", args: ["ticket", "transitions", ""], input: { id: "" } },
    { id: "users-get", args: ["users", "get", "--unexpected"], input: { unexpected: true } },
    { id: "tdd-get", args: ["tdd", "get", ""], input: { id: "" } },
    { id: "epic-get", args: ["epic", "get", ""], input: { id: "" } },
    { id: "initiative-get", args: ["initiative", "get", ""], input: { id: "" } },
    { id: "epic-plan", args: ["epic", "plan", ""], input: { id: "" } },
    { id: "epic-review-plan", args: ["epic", "review-plan", ""], input: { id: "" } },
    { id: "initiative-plan", args: ["initiative", "plan", ""], input: { id: "" } },
    { id: "initiative-review-plan", args: ["initiative", "review-plan", ""], input: { id: "" } },
  ])(
    "rejects malformed input for $id through the operation and Commander",
    async ({ id, args, input }) => {
      const tracker = makeTracker();
      const host = makeHost();
      const registry = new DefaultTrackerReadOperations({
        getTracker: () => tracker,
        getPrHost: () => host,
        getConfig: () => ({ inReviewStatus: "In Review" }),
      }).registry();

      await expect(registry.invoke(id, input)).rejects.toThrow(/Invalid input/);
      await expect(
        makeProgram(registry, tracker, host).parseAsync(args, { from: "user" }),
      ).rejects.toThrow();
      expect(tracker.getTicket).not.toHaveBeenCalled();
      expect(tracker.getEpic).not.toHaveBeenCalled();
      expect(tracker.getInitiative).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: "ticket-get", args: ["ticket", "get", "PROJ-11"] },
    { id: "ticket-transitions", args: ["ticket", "transitions", "PROJ-11"] },
    { id: "users-get", args: ["users", "get"] },
    { id: "tdd-get", args: ["tdd", "get", "PAGE-12"] },
    { id: "epic-get", args: ["epic", "get", "PROJ-10"] },
    { id: "initiative-get", args: ["initiative", "get", "DISC-1"] },
    { id: "epic-plan", args: ["epic", "plan", "PROJ-10"] },
    { id: "epic-review-plan", args: ["epic", "review-plan", "PROJ-10"] },
    { id: "initiative-plan", args: ["initiative", "plan", "DISC-1"] },
    { id: "initiative-review-plan", args: ["initiative", "review-plan", "DISC-1"] },
  ])("preserves unsupported tracker failures for $id", async ({ id, args }) => {
    const unsupported = () =>
      Promise.reject(
        new UnsupportedTrackerOperationError({
          tracker: "Fixture",
          operation: "reading this record",
          remedy: "choose a supported tracker",
        }),
      );
    const tracker = makeTracker({
      getTicket: vi.fn(unsupported),
      listTransitions: vi.fn(unsupported),
      getUsers: vi.fn(unsupported),
      getTechnicalDesign: vi.fn(unsupported),
      getEpic: vi.fn(unsupported),
      getInitiative: vi.fn(unsupported),
    });
    const host = makeHost();
    const registry = new DefaultTrackerReadOperations({
      getTracker: () => tracker,
      getPrHost: () => host,
      getConfig: () => ({ inReviewStatus: "In Review" }),
    }).registry();
    const operation = await registry.invoke(
      id,
      id === "users-get" ? {} : { id: args.at(-1) ?? "" },
    );
    expect(operation).toMatchObject({
      status: "error",
      error: {
        name: "UnsupportedTrackerOperationError",
        message: expect.stringContaining("choose a supported tracker"),
      },
    });

    await expect(
      makeProgram(registry, tracker, host).parseAsync(args, { from: "user" }),
    ).rejects.toMatchObject({
      name: "OperationCliError",
      operationErrorName: "UnsupportedTrackerOperationError",
      message: operation.status === "error" ? operation.error.message : "",
    } satisfies Partial<OperationCliError>);
  });

  it("keeps cyclic graph output visible before the Commander failure", async () => {
    const cyclicEpic = epic("PROJ-10", [ticket("A", "open", ["B"]), ticket("B", "open", ["A"])]);
    const tracker = makeTracker({ getEpic: vi.fn().mockResolvedValue(cyclicEpic) });
    const host = makeHost();
    const registry = new DefaultTrackerReadOperations({
      getTracker: () => tracker,
      getPrHost: () => host,
      getConfig: () => ({ inReviewStatus: "In Review" }),
    }).registry();
    const operation = await registry.invoke("epic-plan", { id: "PROJ-10" });
    expect(operation).toMatchObject({ status: "success", data: { cycles: ["A", "B"] } });

    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(
        makeProgram(registry, tracker, host).parseAsync(["epic", "plan", "PROJ-10"], {
          from: "user",
        }),
      ).rejects.toThrow(/dependency cycle/);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
        cycles: ["A", "B"],
      });
    } finally {
      output.mockRestore();
      errors.mockRestore();
    }
  });
});
