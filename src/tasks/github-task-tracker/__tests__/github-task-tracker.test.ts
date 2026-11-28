import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubTaskTracker } from "../github-task-tracker.js";
import { BodyMetadataService } from "../../body-metadata/body-metadata.js";
import { UnsupportedTrackerOperationError } from "../../task-tracker/unsupported-tracker-operation-error.js";
import type { TaskTrackerPartialWriteError } from "../../task-tracker/task-tracker.js";

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      request: vi.fn(),
      // Defaults to no repo labels, which is the pre-existing behaviour: with
      // nothing to reuse, transitionTicket falls back to the slug it derived.
      paginate: vi.fn().mockResolvedValue([]),
      rest: {
        issues: {
          create: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          createComment: vi.fn(),
          listComments: vi.fn(),
          listForRepo: vi.fn(),
          addLabels: vi.fn(),
          removeLabel: vi.fn(),
          listLabelsForRepo: vi.fn(),
        },
        orgs: {
          listMembers: vi.fn(),
        },
        repos: {
          get: vi.fn(),
        },
      },
    };
  }),
}));

vi.mock("@octokit/graphql", () => ({
  graphql: Object.assign(vi.fn(), {
    defaults: vi.fn().mockReturnValue(vi.fn()),
  }),
}));

const makeTracker = () => new GitHubTaskTracker({ token: "tok", owner: "acme", repo: "proj" });

describe("GitHubTracker.createEpic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a GitHub issue and returns an Epic", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create);
    mockCreate.mockResolvedValueOnce({
      data: {
        number: 42,
        state: "open",
        labels: [{ name: "epic" }],
        title: "My Epic",
        body: "Epic body",
        updated_at: "2026-01-01T00:00:00Z",
      },
    } as never);

    const epic = await tracker.createEpic({ title: "My Epic", body: "Epic body", labels: [] });

    expect(mockCreate).toHaveBeenCalledWith({
      owner: "acme",
      repo: "proj",
      title: "My Epic",
      body: "Epic body",
      labels: ["epic"],
    });
    expect(epic.id).toBe("42");
    expect(epic.title).toBe("My Epic");
    expect(epic.childIssues).toEqual([]);
    expect(epic.tdd).toBeUndefined();
  });
});

describe("GitHubTracker.getEpic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an epic with no child issues when it has no sub-issues", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments);

    mockGet.mockResolvedValueOnce({
      data: {
        number: 42,
        state: "open",
        labels: [{ name: "epic" }],
        title: "My Epic",
        body: "Epic body",
        updated_at: "2026-01-01T00:00:00Z",
        assignee: null,
      },
    } as never);

    mockListComments.mockResolvedValueOnce({ data: [] } as never);

    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    mockRequest.mockResolvedValue({ data: [] } as never);

    const epic = await tracker.getEpic("42");
    expect(epic.id).toBe("42");
    expect(epic.childIssues).toEqual([]);
    expect(epic.tdd).toBeUndefined();
  });
});

describe("GitHubTracker.getTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates blockedBy and blocking from the dependency endpoints", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockGet.mockResolvedValueOnce({
      data: {
        number: 7,
        state: "open",
        labels: [{ name: "ticket" }],
        title: "Fix login",
        body: "Details",
        updated_at: "2026-01-01T00:00:00Z",
        assignee: null,
        user: { login: "alice" },
        type: { name: "Bug" },
      },
    } as never);
    mockListComments.mockResolvedValueOnce({ data: [] } as never);
    mockRequest.mockImplementation((route: string) => {
      if (route.includes("/dependencies/blocked_by"))
        return Promise.resolve({ data: [{ number: 3 }] } as never);
      if (route.includes("/dependencies/blocking"))
        return Promise.resolve({ data: [{ number: 9 }] } as never);
      return Promise.resolve({ data: [] } as never);
    });

    const ticket = await tracker.getTicket("7");

    expect(ticket.blockedBy).toEqual(["3"]);
    expect(ticket.blocking).toEqual(["9"]);
    expect(ticket.reporter).toBe("alice");
    expect(ticket.issueType).toBe("Bug");
    expect(ticket.attachments).toEqual([]);
  });
});

describe("GitHubTracker.createTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  const createdIssue = {
    data: {
      number: 7,
      state: "open",
      labels: [{ name: "ticket" }],
      title: "Standalone",
      body: "Ticket body",
      assignee: null,
      updated_at: "2026-01-01T00:00:00Z",
    },
  };

  it("links the new ticket to its epic as a sub-issue", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);

    mockCreate.mockResolvedValueOnce(createdIssue as never);
    mockRequest.mockImplementation((route: string) => {
      if (route.startsWith("GET")) return Promise.resolve({ data: [] } as never);
      return Promise.resolve({ data: {} } as never);
    });
    mockGet.mockResolvedValueOnce({ data: { id: 999, number: 7 } } as never);

    await tracker.createTicket({
      title: "Standalone",
      body: "Ticket body",
      epicId: "10",
      labels: [],
    });

    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      { owner: "acme", repo: "proj", issue_number: 10, sub_issue_id: 999 },
    );
  });

  it("preserves the created ticket identity when linking its parent fails", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockCreate.mockResolvedValueOnce(createdIssue as never);
    mockRequest.mockRejectedValueOnce(new Error("Parent link unavailable"));

    await expect(
      tracker.createTicket({ title: "Standalone", body: "Ticket body", epicId: "10", labels: [] }),
    ).rejects.toMatchObject({
      name: "TaskTrackerPartialWriteError",
      id: "7",
      message: "Parent link unavailable",
    } satisfies Partial<TaskTrackerPartialWriteError>);
  });

  it("creates a standalone ticket without touching the sub-issue API when no epicId is given", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockCreate = vi.mocked(tracker.octokit.rest.issues.create);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockCreate.mockResolvedValueOnce(createdIssue as never);

    const ticket = await tracker.createTicket({
      title: "Standalone",
      body: "Ticket body",
      labels: [],
    });

    expect(ticket.id).toBe("7");
    expect(ticket.size).toBe("ticket");
    expect(ticket.metadata.epicId).toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe("GitHubTracker.linkTicketToEpic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds the ticket as a native sub-issue of the epic", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);

    mockRequest.mockImplementation((route: string) => {
      if (route.startsWith("GET")) return Promise.resolve({ data: [] } as never);
      return Promise.resolve({ data: {} } as never);
    });
    // resolveIssueId(7) → global id 999
    mockGet.mockResolvedValueOnce({ data: { id: 999, number: 7 } } as never);

    await tracker.linkTicketToEpic("7", "10");

    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      { owner: "acme", repo: "proj", issue_number: 10, sub_issue_id: 999 },
    );
  });

  it("does not re-add a ticket already a sub-issue", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockRequest.mockResolvedValueOnce({ data: [{ number: 7 }] } as never);

    await tracker.linkTicketToEpic("7", "10");

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      { owner: "acme", repo: "proj", issue_number: 10 },
    );
  });
});

describe("GitHubTracker.getTicketEpicId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the parent issue number from the sub-issue parent endpoint", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    mockRequest.mockResolvedValueOnce({ data: { number: 166, title: "E1" } } as never);

    await expect(tracker.getTicketEpicId("177")).resolves.toBe("166");
    expect(mockRequest).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/parent",
      {
        owner: "acme",
        repo: "proj",
        issue_number: 177,
      },
    );
  });

  it("returns null when the issue has no parent", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error("No parent issue found"), { status: 404 }),
    );

    await expect(tracker.getTicketEpicId("216")).resolves.toBeNull();
  });

  it("rethrows any other failure", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    mockRequest.mockRejectedValueOnce(Object.assign(new Error("Bad credentials"), { status: 401 }));

    await expect(tracker.getTicketEpicId("216")).rejects.toThrow("Bad credentials");
  });
});

describe("GitHubTracker.blockTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a native blocked_by dependency using the blocker global id", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockRequest.mockImplementation(((route: string) => {
      if (route.startsWith("GET")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    }) as never);
    // resolveIssueId(3) → global id 555
    mockGet.mockResolvedValueOnce({ data: { id: 555, number: 3 } } as never);

    await tracker.blockTicket("7", "3");

    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
      { owner: "acme", repo: "proj", issue_number: 7, issue_id: 555 },
    );
  });

  it("does not re-add an existing blocker", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    mockRequest.mockResolvedValueOnce({ data: [{ number: 3 }] } as never);

    await tracker.blockTicket("7", "3");

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects a self-block", async () => {
    const tracker = makeTracker();
    await expect(tracker.blockTicket("7", "7")).rejects.toThrow("cannot block itself");
  });
});

describe("GitHubTracker.unblockTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the blocked_by dependency using the blocker global id", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockGet.mockResolvedValueOnce({ data: { id: 555, number: 3 } } as never);
    mockRequest.mockResolvedValue({ data: {} } as never);

    await tracker.unblockTicket("7", "3");

    expect(mockRequest).toHaveBeenCalledWith(
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}",
      { owner: "acme", repo: "proj", issue_number: 7, issue_id: 555 },
    );
  });
});

describe("GitHubTracker.getEpic metadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates metadata from the body sentinel block", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);

    const body =
      "Epic body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\ntddId: 3\n```\n\n</details>";
    mockGet.mockResolvedValueOnce({
      data: {
        number: 42,
        state: "open",
        labels: [],
        title: "My Epic",
        body,
        updated_at: "2026-01-01T00:00:00Z",
        assignee: null,
      },
    } as never);
    mockListComments.mockResolvedValueOnce({ data: [] } as never);
    mockRequest.mockResolvedValue({ data: [] } as never);
    // getEpic sees tddId: 3 and calls getTechnicalDesign('3') — stub the gql response
    mockGql.mockResolvedValueOnce({
      repository: {
        discussion: {
          number: 3,
          body: "TDD body",
          updatedAt: "2026-01-01T00:00:00Z",
          comments: { nodes: [] },
        },
      },
    } as never);

    const epic = await tracker.getEpic("42");
    expect(epic.metadata.tddId).toBe(3);
  });
});

describe("GitHubTracker.getTicket metadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates metadata from the body sentinel block", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    const body =
      "Ticket body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>";
    mockGet.mockResolvedValueOnce({
      data: {
        number: 7,
        state: "open",
        labels: [],
        title: "Fix login",
        body,
        updated_at: "2026-01-01T00:00:00Z",
        assignee: null,
        user: { login: "bob" },
      },
    } as never);
    mockListComments.mockResolvedValueOnce({ data: [] } as never);
    mockRequest.mockResolvedValue({ data: [] } as never);

    const ticket = await tracker.getTicket("7");
    expect(ticket.metadata.epicId).toBe(10);
    expect(ticket.reporter).toBe("bob");
    expect(ticket.issueType).toBe("Issue");
  });
});

describe("GitHubTracker.updateEpicMetadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the epic body, splices the patch, and updates the issue", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update);

    mockGet.mockResolvedValueOnce({ data: { body: "Epic body" } } as never);
    mockUpdate.mockResolvedValueOnce({} as never);

    await tracker.updateEpicMetadata("42", { tddId: 7 });

    expect(mockGet).toHaveBeenCalledWith({ owner: "acme", repo: "proj", issue_number: 42 });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 42,
        body: expect.stringContaining("tddId: 7") as string,
      }),
    );
  });
});

describe("GitHubTracker.updateTicketMetadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the ticket body, splices the patch, and updates the issue", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update);

    mockGet.mockResolvedValueOnce({ data: { body: "Ticket body" } } as never);
    mockUpdate.mockResolvedValueOnce({} as never);

    await tracker.updateTicketMetadata("7", { notes: "Use JWT rotation" });

    expect(mockGet).toHaveBeenCalledWith({ owner: "acme", repo: "proj", issue_number: 7 });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 7,
        body: expect.stringContaining("Use JWT rotation") as string,
      }),
    );
  });
});

describe("GitHubTracker.updateEpicDescription", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rewrites the body preserving metadata, keeps the epic + status labels, and replaces free-form labels", async () => {
    const tracker = makeTracker();
    const existingBody = new BodyMetadataService().splice("old epic body", { notes: "keep me" });
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update);
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockGet.mockResolvedValue({
      data: {
        number: 42,
        state: "open",
        labels: [{ name: "epic" }, { name: "status:in-progress" }, { name: "stale" }],
        title: "My Epic",
        body: existingBody,
        updated_at: "2026-01-01T00:00:00Z",
        assignee: null,
      },
    } as never);
    mockUpdate.mockResolvedValue({} as never);
    mockListComments.mockResolvedValue({ data: [] } as never);
    mockRequest.mockResolvedValue({ data: [] } as never);

    await tracker.updateEpicDescription("42", { body: "brand new epic body", labels: ["bug"] });

    const call = mockUpdate.mock.calls[0]?.[0] as {
      body: string;
      labels: string[];
      issue_number: number;
    };
    expect(call.issue_number).toBe(42);
    expect(call.body).toContain("brand new epic body");
    expect(call.body).toContain("notes: keep me");
    expect(call.labels).toEqual(["epic", "status:in-progress", "bug"]);
  });

  it("leaves labels untouched when --labels is not supplied", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update);
    // @ts-expect-error — accessing private field for test setup
    const mockListComments = vi.mocked(tracker.octokit.rest.issues.listComments);
    // @ts-expect-error — accessing private field for test setup
    const mockRequest = vi.mocked(tracker.octokit.request);

    mockGet.mockResolvedValue({
      data: {
        number: 42,
        state: "open",
        labels: [{ name: "epic" }],
        title: "My Epic",
        body: "old",
        updated_at: "2026-01-01T00:00:00Z",
        assignee: null,
      },
    } as never);
    mockUpdate.mockResolvedValue({} as never);
    mockListComments.mockResolvedValue({ data: [] } as never);
    mockRequest.mockResolvedValue({ data: [] } as never);

    await tracker.updateEpicDescription("42", { body: "new" });

    const call = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("labels");
  });
});

describe("GitHubTracker.updateTddMetadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the discussion by node id and calls the update mutation", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);

    mockGql
      .mockResolvedValueOnce({
        repository: { discussion: { id: "D_kwDOABC123", body: "TDD body" } },
      } as never)
      .mockResolvedValueOnce({ updateDiscussion: { discussion: { number: 3 } } } as never);

    await tracker.updateTddMetadata("3", { epicId: 10 });

    expect(mockGql).toHaveBeenCalledTimes(2);
    const mutVars = mockGql.mock.calls[1]?.[1] as
      | { discussionId: string; body: string }
      | undefined;
    expect(mutVars?.discussionId).toBe("D_kwDOABC123");
    expect(mutVars?.body).toContain("epicId: 10");
  });
});

describe("GitHubTracker.createTechnicalDesign metadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes epicId into TDD body and tddId back to epic body", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.issues.get);
    // @ts-expect-error — accessing private field for test setup
    const mockUpdate = vi.mocked(tracker.octokit.rest.issues.update);

    mockGql
      .mockResolvedValueOnce({
        repository: { id: "R_abc", discussionCategory: { id: "DC_abc" } },
      } as never)
      .mockResolvedValueOnce({
        createDiscussion: {
          discussion: {
            number: 5,
            body: "TDD body",
            updatedAt: "2026-01-01T00:00:00Z",
            url: "https://github.com/acme/proj/discussions/5",
          },
        },
      } as never);

    mockGet.mockResolvedValueOnce({ data: { body: "Epic body" } } as never);
    mockUpdate.mockResolvedValueOnce({} as never);

    const tdd = await tracker.createTechnicalDesign({
      title: "Auth TDD",
      body: "TDD body",
      epicId: "10",
    });

    // Tickets link the design by this URL, so it must come back from create.
    expect(tdd.url).toBe("https://github.com/acme/proj/discussions/5");

    // The mutation body should contain epicId: 10 in the metadata block
    const createArgs = mockGql.mock.calls[1] as [string, Record<string, unknown>] | undefined;
    expect(createArgs?.[1]?.["body"]).toContain("epicId: 10");

    // The issues.update call should write tddId: 5 to the epic body
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("tddId: 5") as string,
      }),
    );
  });
});

describe("GitHubTracker.updateTechnicalDesign", () => {
  beforeEach(() => vi.clearAllMocks());

  const existingBody =
    "Old body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>";

  const stubDiscussion = () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);
    mockGql
      .mockResolvedValueOnce({
        repository: { discussion: { id: "D_1", title: "Old title", body: existingBody } },
      } as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({
        repository: {
          discussion: {
            number: 5,
            body: existingBody,
            updatedAt: "2026-01-01T00:00:00Z",
            comments: { nodes: [] },
          },
        },
      } as never);
    return { tracker, mockGql };
  };

  it("updates the discussion and splices the existing metadata into the new body", async () => {
    const { tracker, mockGql } = stubDiscussion();

    await tracker.updateTechnicalDesign("5", { title: "New title", body: "New body" });

    const vars = mockGql.mock.calls[1]?.[1] as Record<string, string>;
    expect(mockGql.mock.calls[1]?.[0]).toContain("updateDiscussion");
    expect(vars["discussionId"]).toBe("D_1");
    expect(vars["title"]).toBe("New title");
    expect(vars["body"]).toContain("New body");
    expect(vars["body"]).not.toContain("Old body");
    expect(vars["body"]).toContain("flight-rules:metadata");
    expect(vars["body"]).toContain("epicId: 10");
  });

  it("sends no title on a body-only edit", async () => {
    const { tracker, mockGql } = stubDiscussion();

    await tracker.updateTechnicalDesign("5", { body: "New body" });

    const vars = mockGql.mock.calls[1]?.[1] as Record<string, string>;
    expect(vars).not.toHaveProperty("title");
    expect(vars["body"]).toContain("New body");
  });

  it("sends no body on a title-only edit", async () => {
    const { tracker, mockGql } = stubDiscussion();

    await tracker.updateTechnicalDesign("5", { title: "New title" });

    const vars = mockGql.mock.calls[1]?.[1] as Record<string, string>;
    expect(vars).not.toHaveProperty("body");
    expect(vars["title"]).toBe("New title");
  });

  it("reports a partial write when the readback fails after the mutation", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);
    mockGql
      .mockResolvedValueOnce({
        repository: { discussion: { id: "D_1", body: existingBody } },
      } as never)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("readback failed"));

    await expect(tracker.updateTechnicalDesign("5", { title: "T" })).rejects.toMatchObject({
      name: "TaskTrackerPartialWriteError",
      id: "5",
    });
  });
});

describe("GitHubTracker.getTechnicalDesign metadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates metadata from the body sentinel block", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);

    const body =
      "TDD body\n\n<details>\n<summary>LLM Context</summary>\n<!-- flight-rules:metadata -->\n\n```yaml\nepicId: 10\n```\n\n</details>";
    mockGql.mockResolvedValueOnce({
      repository: {
        discussion: {
          number: 5,
          body,
          updatedAt: "2026-01-01T00:00:00Z",
          comments: { nodes: [] },
        },
      },
    } as never);

    const tdd = await tracker.getTechnicalDesign("5");
    expect(tdd.metadata.epicId).toBe(10);
    expect(tdd.epicId).toBe("10");
  });
});

describe("GitHubTracker.getTechnicalDesign comments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns discussion comments in the Comment shape, markdown preserved", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);
    const markdown = "Try:\n\n```ts\nconst x = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |";
    mockGql.mockResolvedValueOnce({
      repository: {
        discussion: {
          number: 5,
          body: "TDD body",
          updatedAt: "2026-01-01T00:00:00Z",
          comments: {
            nodes: [
              {
                id: "DC_1",
                body: markdown,
                author: { login: "alice" },
                createdAt: "2026-01-02T00:00:00Z",
                updatedAt: "2026-01-03T00:00:00Z",
              },
            ],
          },
        },
      },
    } as never);

    const tdd = await tracker.getTechnicalDesign("5");
    expect(tdd.comments).toEqual([
      {
        id: "DC_1",
        body: markdown,
        author: "alice",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
      },
    ]);
  });
});

describe("GitHubTracker.addTechnicalDesignComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the discussion node id and runs addDiscussionComment", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);
    const body = "Use a table:\n\n| a | b |\n| - | - |\n\n```ts\nconst x = 1\n```";
    mockGql
      .mockResolvedValueOnce({ repository: { discussion: { id: "D_kwDO1" } } } as never)
      .mockResolvedValueOnce({
        addDiscussionComment: {
          comment: {
            id: "DC_9",
            body,
            author: { login: "bot" },
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        },
      } as never);

    const comment = await tracker.addTechnicalDesignComment("5", body);

    expect(String(mockGql.mock.calls[1]?.[0])).toContain("addDiscussionComment");
    expect(mockGql.mock.calls[1]?.[1]).toEqual({ discussionId: "D_kwDO1", body });
    expect(comment).toEqual({
      id: "DC_9",
      body,
      author: "bot",
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
    });
  });

  it("fails when the discussion does not exist", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGql = vi.mocked(tracker.gql);
    mockGql.mockResolvedValueOnce({ repository: { discussion: null } } as never);
    await expect(tracker.addTechnicalDesignComment("5", "hi")).rejects.toThrow(
      "Discussion #5 not found",
    );
    expect(mockGql).toHaveBeenCalledTimes(1);
  });
});

describe("GitHubTracker.getUsers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns accountId/displayName pairs for all org members", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockListMembers = vi.mocked(tracker.octokit.rest.orgs.listMembers);
    mockListMembers.mockResolvedValueOnce({
      data: [{ login: "alice" }, { login: "bob" }],
    } as never);
    const result = await tracker.getUsers();
    expect(result).toEqual([
      { accountId: "alice", displayName: "alice" },
      { accountId: "bob", displayName: "bob" },
    ]);
    expect(mockListMembers).toHaveBeenCalledWith({ org: "acme", per_page: 100 });
  });

  it("returns empty array when org has no members", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockListMembers = vi.mocked(tracker.octokit.rest.orgs.listMembers);
    mockListMembers.mockResolvedValueOnce({ data: [] } as never);
    const result = await tracker.getUsers();
    expect(result).toEqual([]);
  });
});

describe("GitHubTracker initiatives (GitHub Projects)", () => {
  beforeEach(() => vi.clearAllMocks());

  const gqlOf = (tracker: GitHubTaskTracker) =>
    // @ts-expect-error — accessing private field for test setup
    vi.mocked(tracker.gql);

  const issueItem = (number: number, title: string, labels: string[], repo = "proj") => ({
    content: {
      number,
      title,
      repository: { name: repo, owner: { login: "acme" } },
      labels: { nodes: labels.map((name) => ({ name })) },
    },
  });

  const projectPage = (
    nodes: unknown[],
    pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
      hasNextPage: false,
      endCursor: null,
    },
  ) => ({
    repositoryOwner: {
      projectV2: { title: "Q3 Platform", readme: "The big push", items: { pageInfo, nodes } },
    },
  });

  it("creates a project linked to the repo and writes the body to its README", async () => {
    const tracker = makeTracker();
    const gql = gqlOf(tracker);
    gql
      .mockResolvedValueOnce({ repository: { id: "R_1", owner: { id: "O_1" } } } as never)
      .mockResolvedValueOnce({
        createProjectV2: { projectV2: { id: "PVT_7", number: 7, title: "Q3 Platform" } },
      } as never)
      .mockResolvedValueOnce({} as never);

    const initiative = await tracker.createInitiative({
      title: "Q3 Platform",
      body: "The big push",
    });

    expect(gql.mock.calls[1]?.[1]).toEqual({
      ownerId: "O_1",
      repositoryId: "R_1",
      title: "Q3 Platform",
    });
    expect(gql.mock.calls[2]?.[1]).toEqual({
      input: { projectId: "PVT_7", readme: "The big push" },
    });
    expect(initiative).toEqual({
      id: "7",
      size: "initiative",
      title: "Q3 Platform",
      body: "The big push",
      epics: [],
    });
  });

  it("reports a partial write when the README update fails after the project exists", async () => {
    const tracker = makeTracker();
    gqlOf(tracker)
      .mockResolvedValueOnce({ repository: { id: "R_1", owner: { id: "O_1" } } } as never)
      .mockResolvedValueOnce({
        createProjectV2: { projectV2: { id: "PVT_7", number: 7, title: "Q3 Platform" } },
      } as never)
      .mockRejectedValueOnce(new Error("readme denied"));

    await expect(
      tracker.createInitiative({ title: "Q3 Platform", body: "The big push" }),
    ).rejects.toMatchObject({
      name: "TaskTrackerPartialWriteError",
      id: "7",
      message: "readme denied",
    } satisfies Partial<TaskTrackerPartialWriteError>);
  });

  it("returns the project README and its epic-labelled issues from this repo, across pages", async () => {
    const tracker = makeTracker();
    const gql = gqlOf(tracker);
    gql
      .mockResolvedValueOnce(
        projectPage(
          [
            issueItem(19, "Decomposition", ["epic"]),
            issueItem(20, "A ticket", ["ticket"]),
            issueItem(21, "Other repo epic", ["epic"], "elsewhere"),
            { content: {} },
            null,
          ],
          { hasNextPage: true, endCursor: "c1" },
        ) as never,
      )
      .mockResolvedValueOnce(projectPage([issueItem(30, "Rollout", ["epic"])]) as never);

    const initiative = await tracker.getInitiative("7");

    expect(gql.mock.calls[0]?.[1]).toEqual({ owner: "acme", number: 7, after: null });
    expect(gql.mock.calls[1]?.[1]).toEqual({ owner: "acme", number: 7, after: "c1" });
    expect(initiative).toEqual({
      id: "7",
      size: "initiative",
      title: "Q3 Platform",
      body: "The big push",
      epics: [
        { id: "19", title: "Decomposition" },
        { id: "30", title: "Rollout" },
      ],
    });
  });

  it("throws when the owner has no project with that number", async () => {
    const tracker = makeTracker();
    gqlOf(tracker).mockResolvedValueOnce({ repositoryOwner: { projectV2: null } } as never);

    await expect(tracker.getInitiative("7")).rejects.toThrow(
      "initiative 7 not found: no GitHub Project #7 owned by acme",
    );
  });

  it("maps GitHub's NOT_FOUND error on projectV2 to the same message", async () => {
    const tracker = makeTracker();
    gqlOf(tracker).mockRejectedValueOnce(
      Object.assign(new Error("Could not resolve to a ProjectV2 with the number 7."), {
        errors: [{ type: "NOT_FOUND", path: ["repositoryOwner", "projectV2"] }],
      }),
    );

    await expect(tracker.linkEpicToInitiative("19", "7")).rejects.toThrow(
      "initiative 7 not found: no GitHub Project #7 owned by acme",
    );
  });

  it("rejects an initiative id that is not a project number", async () => {
    const tracker = makeTracker();
    await expect(tracker.getInitiative("PVT_7")).rejects.toThrow(
      'initiative id must be a GitHub Project number, got "PVT_7"',
    );
    expect(gqlOf(tracker)).not.toHaveBeenCalled();
  });

  it("adds the epic issue to the project", async () => {
    const tracker = makeTracker();
    const gql = gqlOf(tracker);
    gql
      .mockResolvedValueOnce({
        repositoryOwner: { projectV2: { id: "PVT_7" } },
        repository: { issue: { id: "I_19" } },
      } as never)
      .mockResolvedValueOnce({} as never);

    await tracker.linkEpicToInitiative("19", "7");

    expect(gql.mock.calls[0]?.[1]).toEqual({ owner: "acme", repo: "proj", number: 7, issue: 19 });
    expect(gql.mock.calls[1]?.[0]).toContain("addProjectV2ItemById");
    expect(gql.mock.calls[1]?.[1]).toEqual({ projectId: "PVT_7", contentId: "I_19" });
  });

  it("throws before mutating when the epic issue does not exist", async () => {
    const tracker = makeTracker();
    const gql = gqlOf(tracker);
    gql.mockResolvedValueOnce({
      repositoryOwner: { projectV2: { id: "PVT_7" } },
      repository: { issue: null },
    } as never);

    await expect(tracker.linkEpicToInitiative("19", "7")).rejects.toThrow(
      "epic 19 not found in acme/proj",
    );
    expect(gql).toHaveBeenCalledTimes(1);
  });

  it("updates the project README and title, then returns the initiative", async () => {
    const tracker = makeTracker();
    const gql = gqlOf(tracker);
    gql
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "PVT_7" } } } as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce(projectPage([]) as never);

    const initiative = await tracker.updateInitiativeDescription("7", {
      body: "new idea body",
      title: "New Idea",
    });

    expect(gql.mock.calls[1]?.[1]).toEqual({
      input: { projectId: "PVT_7", readme: "new idea body", title: "New Idea" },
    });
    expect(initiative.id).toBe("7");
    expect(initiative.size).toBe("initiative");
  });

  it("leaves the project title out of the update when no title is given", async () => {
    const tracker = makeTracker();
    const gql = gqlOf(tracker);
    gql
      .mockResolvedValueOnce({ repositoryOwner: { projectV2: { id: "PVT_7" } } } as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce(projectPage([]) as never);

    await tracker.updateInitiativeDescription("7", { body: "new idea body" });

    expect(gql.mock.calls[1]?.[1]).toEqual({
      input: { projectId: "PVT_7", readme: "new idea body" },
    });
  });
});

describe("GitHubTracker.ping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes bounded probe cancellation through to Octokit", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.repos.get);
    mockGet.mockResolvedValueOnce({ data: {} } as never);
    const signal = new AbortController().signal;
    await tracker.ping({ signal });
    expect(mockGet).toHaveBeenCalledWith({ owner: "acme", repo: "proj", request: { signal } });
  });

  it("reads the configured repo to verify reachability", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.repos.get);
    mockGet.mockResolvedValueOnce({ data: { full_name: "acme/proj" } } as never);
    await tracker.ping();
    expect(mockGet).toHaveBeenCalledWith({ owner: "acme", repo: "proj" });
  });

  it("propagates the error when the repo is unreachable", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const mockGet = vi.mocked(tracker.octokit.rest.repos.get);
    mockGet.mockRejectedValueOnce(new Error("Not Found"));
    await expect(tracker.ping()).rejects.toThrow("Not Found");
  });
});

describe("GitHubTracker.transitionTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses a repo label that differs only in case, rather than creating a duplicate", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const octokit = tracker.octokit;
    vi.mocked(octokit.paginate).mockResolvedValue([{ name: "status:Needs-QA" }] as never);
    vi.mocked(octokit.rest.issues.get).mockResolvedValueOnce({
      data: { number: 7, labels: [{ name: "ticket" }] },
    } as never);
    vi.mocked(octokit.rest.issues.addLabels).mockResolvedValue({} as never);

    await tracker.transitionTicket("7", "needs qa");

    expect(vi.mocked(octokit.rest.issues.addLabels)).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["status:Needs-QA"] }),
    );
  });

  it("does not treat the case-variant label it is about to apply as stale", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const octokit = tracker.octokit;
    vi.mocked(octokit.paginate).mockResolvedValue([{ name: "status:Needs-QA" }] as never);
    vi.mocked(octokit.rest.issues.get).mockResolvedValueOnce({
      data: { number: 7, labels: [{ name: "status:Needs-QA" }] },
    } as never);
    vi.mocked(octokit.rest.issues.addLabels).mockResolvedValue({} as never);

    await tracker.transitionTicket("7", "needs qa");

    expect(vi.mocked(octokit.rest.issues.removeLabel)).not.toHaveBeenCalled();
  });

  it("swaps any existing status label for the new status:<slug> label", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const issues = tracker.octokit.rest.issues;
    vi.mocked(issues.get).mockResolvedValueOnce({
      data: { number: 7, labels: [{ name: "ticket" }, { name: "status:to-do" }] },
    } as never);
    vi.mocked(issues.removeLabel).mockResolvedValue({} as never);
    vi.mocked(issues.addLabels).mockResolvedValue({} as never);

    await tracker.transitionTicket("7", "In Review");

    expect(vi.mocked(issues.removeLabel)).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7, name: "status:to-do" }),
    );
    expect(vi.mocked(issues.addLabels)).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7, labels: ["status:in-review"] }),
    );
  });

  it("derives Ticket.status from a status:* label over the raw issue state", async () => {
    const tracker = makeTracker();
    // @ts-expect-error — accessing private field for test setup
    const issues = tracker.octokit.rest.issues;
    vi.mocked(issues.get).mockResolvedValueOnce({
      data: {
        number: 7,
        state: "open",
        labels: [{ name: "ticket" }, { name: "status:in-progress" }],
        title: "T",
        body: "",
        assignee: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    } as never);
    vi.mocked(issues.listComments).mockResolvedValueOnce({ data: [] } as never);
    // @ts-expect-error — accessing private field for test setup
    vi.mocked(tracker.octokit.request).mockResolvedValue({ data: [] } as never);

    const ticket = await tracker.getTicket("7");
    expect(ticket.status).toBe("in-progress");
  });
});

describe("GitHubTracker.listTransitions", () => {
  beforeEach(() => vi.clearAllMocks());

  const stubLabels = (tracker: GitHubTaskTracker, names: string[]): void => {
    // @ts-expect-error — accessing private field for test setup
    vi.mocked(tracker.octokit.paginate).mockResolvedValue(names.map((name) => ({ name })) as never);
  };

  it("returns repo status labels in human form", async () => {
    const tracker = makeTracker();
    stubLabels(tracker, ["status:in-progress", "bug", "status:in-review"]);

    await expect(tracker.listTransitions()).resolves.toEqual(["in progress", "in review"]);
  });

  it("returns an empty list when the repo defines no status labels", async () => {
    const tracker = makeTracker();
    stubLabels(tracker, ["bug"]);

    await expect(tracker.listTransitions()).resolves.toEqual([]);
  });

  it("lowercases so the value round-trips through transitionTicket unchanged", async () => {
    const tracker = makeTracker();
    stubLabels(tracker, ["status:Needs-QA"]);

    await expect(tracker.listTransitions()).resolves.toEqual(["needs qa"]);
  });

  it("paginates rather than capping at one page", async () => {
    const tracker = makeTracker();
    const many = Array.from({ length: 150 }, (_, index) => `status:s${index}`);
    stubLabels(tracker, many);

    await expect(tracker.listTransitions()).resolves.toHaveLength(150);
    // @ts-expect-error — accessing private field for the assertion
    expect(tracker.octokit.paginate).toHaveBeenCalled();
  });
});

describe("GitHubTracker throws for unsupported label writes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects addLabel with UnsupportedTrackerOperationError naming the remedy", async () => {
    const tracker = makeTracker();

    await expect(tracker.addLabel("7", "qa")).rejects.toBeInstanceOf(
      UnsupportedTrackerOperationError,
    );
    await expect(tracker.addLabel("7", "qa")).rejects.toThrow(/--tracker jira/);
  });

  it("rejects removeLabel with UnsupportedTrackerOperationError naming the remedy", async () => {
    const tracker = makeTracker();

    await expect(tracker.removeLabel("7", "qa")).rejects.toBeInstanceOf(
      UnsupportedTrackerOperationError,
    );
    await expect(tracker.removeLabel("7", "qa")).rejects.toThrow(/--tracker jira/);
  });

  it("rejects addAttachment with UnsupportedTrackerOperationError naming the remedy", async () => {
    const tracker = makeTracker();

    await expect(tracker.addAttachment("7", "/tmp/a.png")).rejects.toBeInstanceOf(
      UnsupportedTrackerOperationError,
    );
    await expect(tracker.addAttachment("7", "/tmp/a.png")).rejects.toThrow(/--tracker jira/);
  });
});

describe("GitHubTracker technical design attachments", () => {
  it("fails with an error naming the limitation", async () => {
    const tracker = makeTracker();
    expect(() => tracker.assertTechnicalDesignAttachments()).toThrow(
      /GitHub tracker does not support attaching files to a technical design/,
    );
    await expect(tracker.addTechnicalDesignAttachment()).rejects.toThrow(/--tracker jira/);
  });
});
