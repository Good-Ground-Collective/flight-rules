import { describe, expect, it, vi } from "vitest";
import type { PullRequestHost } from "../../pr/pull-request-host/pull-request-host.js";
import type {
  TaskTracker,
  Epic,
  Initiative,
  Ticket,
} from "../../tasks/task-tracker/task-tracker.js";
import { LaunchOperationAccessPolicy, MapOperationRegistry } from "../operation-registry.js";
import { DefaultTrackerReadOperations } from "../tracker-read-operations.js";

const ticket = (id: string, overrides: Partial<Ticket> = {}): Ticket => ({
  id,
  size: "ticket",
  status: "open",
  labels: [],
  title: `Ticket ${id}`,
  body: "## Acceptance Criteria\n- [x] Works",
  comments: [],
  assignee: null,
  attachments: [],
  reporter: null,
  issueType: "Story",
  blockedBy: [],
  blocking: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const epic = (
  id: string,
  childIssues: Ticket[] = [],
): Epic & { trackerField: { key: string } } => ({
  id,
  size: "epic",
  status: "open",
  labels: ["epic"],
  title: `Epic ${id}`,
  body: "Epic body",
  childIssues,
  comments: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
  trackerField: { key: `EPIC-${id}` },
});

const initiative: Initiative = {
  id: "I-1",
  size: "initiative",
  title: "Initiative 1",
  body: "Initiative body",
  epics: [
    { id: "E-1", title: "Epic E-1" },
    { id: "E-2", title: "Epic E-2" },
  ],
};

const makeTracker = (epics: Epic[] = [epic("E-1")]): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(async (id: string) => epics.find((item) => item.id === id) ?? epic(id)),
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
  getTechnicalDesign: vi.fn().mockResolvedValue({
    id: "TDD-1",
    epicId: "E-1",
    body: "Design",
    comments: [],
    metadata: {},
    updatedAt: "2026-01-01T00:00:00Z",
    trackerField: "preserved",
  }),
  addComment: vi.fn(),
  addAttachment: vi.fn(),
  getUsers: vi
    .fn()
    .mockResolvedValue([
      { accountId: "acct-1", displayName: "Reviewer", trackerField: "preserved" },
    ]),
  ping: vi.fn(),
});

const makeHost = (
  open: Awaited<ReturnType<PullRequestHost["listOpenPullRequestsForTickets"]>> = [],
): PullRequestHost => ({
  createPullRequest: vi.fn(),
  commentOnPullRequest: vi.fn(),
  listOpenPullRequestsForTickets: vi.fn().mockResolvedValue(open),
  defaultBranch: vi.fn().mockResolvedValue("main"),
  requestReviewers: vi.fn(),
});

const makeRegistry = (tracker: TaskTracker, host = makeHost()) =>
  new MapOperationRegistry({
    operations: new DefaultTrackerReadOperations({
      getTracker: () => tracker,
      getPrHost: () => host,
      getConfig: () => ({ inReviewStatus: "In Review" }),
    }).operations(),
    policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network", "process"] }),
  });

describe("tracker read operations", () => {
  it("registers the six reads and four plans with executable handlers", async () => {
    const tracker = makeTracker();
    const registry = makeRegistry(tracker);
    const ids = [
      "ticket-get",
      "ticket-transitions",
      "users-get",
      "tdd-get",
      "epic-get",
      "initiative-get",
      "epic-plan",
      "epic-review-plan",
      "initiative-plan",
      "initiative-review-plan",
    ];

    expect(registry.list().map(({ id }) => id)).toEqual(ids);
    await expect(registry.invoke("ticket-get", { id: "GS-7" })).resolves.toMatchObject({
      status: "success",
      data: { id: "GS-7", body: expect.any(String) },
    });
    await expect(registry.invoke("ticket-transitions", { id: "GS-7" })).resolves.toMatchObject({
      status: "success",
      data: { id: "GS-7", transitions: ["In Progress", "Done"] },
    });
    await expect(registry.invoke("users-get", {})).resolves.toMatchObject({
      status: "success",
      data: [{ accountId: "acct-1", trackerField: "preserved" }],
    });
    await expect(registry.invoke("tdd-get", { id: "TDD-1" })).resolves.toMatchObject({
      status: "success",
      data: { id: "TDD-1", trackerField: "preserved" },
    });
    await expect(registry.invoke("epic-get", { id: "E-1" })).resolves.toMatchObject({
      status: "success",
      data: { id: "E-1", trackerField: { key: "EPIC-E-1" } },
    });
    await expect(registry.invoke("initiative-get", { id: "I-1" })).resolves.toMatchObject({
      status: "success",
      data: { id: "I-1", epics: [{ id: "E-1" }, { id: "E-2" }] },
    });
    await expect(registry.invoke("epic-plan", { id: "E-1" })).resolves.toMatchObject({
      status: "success",
    });
    await expect(registry.invoke("epic-review-plan", { id: "E-1" })).resolves.toMatchObject({
      status: "success",
    });
    await expect(registry.invoke("initiative-plan", { id: "I-1" })).resolves.toMatchObject({
      status: "success",
    });
    await expect(registry.invoke("initiative-review-plan", { id: "I-1" })).resolves.toMatchObject({
      status: "success",
    });
  });

  it("rejects malformed inputs before tracker calls and returns unsupported tracker failures", async () => {
    const tracker = makeTracker();
    const registry = makeRegistry(tracker);

    await expect(registry.invoke("ticket-get", { id: "GS-7", section: "unknown" })).rejects.toThrow(
      /unknown section/,
    );
    await expect(registry.invoke("initiative-plan", { id: "I-1", extra: true })).rejects.toThrow(
      /Invalid input/,
    );
    await expect(registry.invoke("missing-route", {})).rejects.toThrow(/Unknown operation/);
    expect(tracker.getTicket).not.toHaveBeenCalled();

    const unsupported = makeTracker();
    vi.mocked(unsupported.getUsers).mockRejectedValue(
      new Error("Unsupported tracker operation: users"),
    );
    await expect(makeRegistry(unsupported).invoke("users-get", {})).resolves.toMatchObject({
      status: "error",
      error: { name: "Error", message: "Unsupported tracker operation: users" },
    });
  });

  it("aggregates initiative cycles, cross-epic warnings, and missing pull requests", async () => {
    const tracker = makeTracker([
      epic("E-1", [
        ticket("A", { blockedBy: ["B", "OUTSIDE"] }),
        ticket("B", { blockedBy: ["A"] }),
      ]),
      epic("E-2", [
        ticket("C", { status: "In Review", blockedBy: ["A"] }),
        ticket("D", { status: "In Review" }),
      ]),
    ]);
    const registry = makeRegistry(tracker);
    const plan = await registry.invoke("initiative-plan", { id: "I-1" });
    expect(plan).toMatchObject({
      status: "success",
      data: {
        cycles: ["A", "B", "C"],
        crossEpicEdges: [
          {
            ticket: "A",
            ticketEpic: "E-1",
            blockedBy: "OUTSIDE",
            blockerEpic: null,
            justification: null,
          },
          {
            ticket: "C",
            ticketEpic: "E-2",
            blockedBy: "A",
            blockerEpic: "E-1",
            justification: null,
          },
        ],
        warnings: [
          expect.stringContaining("A (epic E-1)"),
          expect.stringContaining("no justification recorded"),
        ],
      },
    });

    const review = await registry.invoke("initiative-review-plan", { id: "I-1" });
    expect(review).toMatchObject({
      status: "success",
      data: {
        initiative: { id: "I-1" },
        route: "incomplete",
        missing: ["D"],
        cycles: ["A", "B", "C"],
        crossEpicEdges: [
          expect.objectContaining({ ticket: "A", blockerEpic: null }),
          expect.objectContaining({ ticket: "C", justification: null }),
        ],
      },
    });
  });
});
