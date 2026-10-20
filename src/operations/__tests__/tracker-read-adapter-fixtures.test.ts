import { beforeEach, describe, expect, it, vi } from "vitest";

const githubApi = vi.hoisted(() => ({
  issueGet: vi.fn(),
  comments: vi.fn(),
  request: vi.fn(),
}));
const jiraApi = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    rest = {
      issues: {
        get: githubApi.issueGet,
        listComments: githubApi.comments,
      },
    };
    request = githubApi.request;
    paginate = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("@octokit/graphql", () => ({
  graphql: Object.assign(vi.fn(), { defaults: vi.fn(() => vi.fn()) }),
}));

vi.mock("../../tasks/jira-task-tracker/jira-client.js", () => ({
  JiraClient: class {
    request = jiraApi.request;
  },
}));

vi.mock("../../tasks/jira-task-tracker/confluence-client.js", () => ({
  ConfluenceClient: class {
    siteBaseUrl = "https://acme.atlassian.net/wiki";
  },
}));

import { GitHubTaskTracker } from "../../tasks/github-task-tracker/github-task-tracker.js";
import { JiraTaskTracker } from "../../tasks/jira-task-tracker/jira-task-tracker.js";
import { DefaultTrackerReadOperations } from "../tracker-read-operations.js";

describe("tracker read operations with backend read fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    githubApi.issueGet.mockResolvedValue({
      data: {
        number: 7,
        state: "open",
        labels: [{ name: "bug" }, { name: "status:In Progress" }],
        title: "Fix GitHub sign in",
        body: "## Fixed When\n- [ ] sign in works",
        updated_at: "2026-10-01T10:00:00Z",
        assignee: { login: "ada" },
        user: { login: "grace" },
        type: { name: "Bug" },
      },
    });
    githubApi.comments.mockResolvedValue({ data: [] });
    githubApi.request.mockImplementation((route: string) =>
      Promise.resolve({ data: route.includes("blocked_by") ? [{ number: 3 }] : [] }),
    );
    jiraApi.request.mockImplementation((_method: string, path: string) => {
      if (path === "/issueLinkType") {
        return Promise.resolve({
          issueLinkTypes: [
            { id: "100", name: "Blocks", inward: "is blocked by", outward: "blocks" },
          ],
        });
      }
      if (path === "/issue/PROJ-35") {
        return Promise.resolve({
          id: "10435",
          key: "PROJ-35",
          fields: {
            summary: "Fix Jira sign in",
            status: { name: "In Review" },
            labels: ["story", "security"],
            assignee: { accountId: "jira-account-ada" },
            reporter: { accountId: "jira-account-grace", displayName: "Grace" },
            issuetype: { name: "Bug" },
            attachment: [{ id: "att-1", filename: "screen.png", mimeType: "image/png", size: 128 }],
            updated: "2026-10-02T11:00:00Z",
            issuelinks: [
              {
                id: "link-1",
                type: { name: "Blocks" },
                inwardIssue: { key: "PROJ-12" },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected Jira fixture request: ${path}`);
    });
  });

  it("retains GitHub issue identity and mapped fields through the shared result schema", async () => {
    const tracker = new GitHubTaskTracker({
      token: "fixture",
      owner: "acme",
      repo: "flight-rules",
    });
    const registry = new DefaultTrackerReadOperations({ getTracker: () => tracker }).registry();

    await expect(registry.invoke("ticket-get", { id: "7" })).resolves.toMatchObject({
      status: "success",
      data: {
        id: "7",
        title: "Fix GitHub sign in",
        status: "In Progress",
        labels: ["bug", "status:In Progress"],
        assignee: "ada",
        reporter: "grace",
        issueType: "Bug",
        blockedBy: ["3"],
        blocking: [],
        updatedAt: "2026-10-01T10:00:00Z",
      },
    });
  });

  it("retains Jira keys and mapped fields through the shared result schema", async () => {
    const tracker = new JiraTaskTracker({
      token: "fixture",
      host: "acme.atlassian.net",
      email: "fixture@example.com",
      project: "PROJ",
    });
    const registry = new DefaultTrackerReadOperations({ getTracker: () => tracker }).registry();

    await expect(registry.invoke("ticket-get", { id: "PROJ-35" })).resolves.toMatchObject({
      status: "success",
      data: {
        id: "PROJ-35",
        title: "Fix Jira sign in",
        status: "In Review",
        labels: ["story", "security"],
        assignee: "jira-account-ada",
        reporter: "jira-account-grace",
        issueType: "Bug",
        blockedBy: ["PROJ-12"],
        blocking: [],
        attachments: [{ id: "att-1", filename: "screen.png", mimeType: "image/png", size: 128 }],
        updatedAt: "2026-10-02T11:00:00Z",
      },
    });
  });
});
