import { describe, it, expect, vi, beforeEach } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../jira-client.js", () => ({
  JiraClient: class {
    request = request;
  },
}));

import { JiraTaskTracker } from "../jira-task-tracker.js";

const makeTracker = () =>
  new JiraTaskTracker({
    token: "tok",
    host: "acme.atlassian.net",
    email: "me@acme.com",
    project: "PROJ",
  });

const blocksType = {
  id: "10000",
  name: "Blocks",
  inward: "is blocked by",
  outward: "blocks",
  self: "https://acme.atlassian.net/rest/api/3/issueLinkType/10000",
};

// Recorded from Jira Cloud (GET /issue/{key}?fields=issuelinks), keys renamed. The Jira UI shows
// this issue as "PROJ-33 blocks PROJ-61" and "PROJ-33 is blocked by PROJ-4, PROJ-64": in an
// issue's own link list, the partner under outwardIssue is the issue it blocks.
const recordedIssue = {
  id: "53570",
  key: "PROJ-33",
  fields: {
    summary: "Add and remove a case involvement",
    issuelinks: [
      {
        id: "23763",
        type: blocksType,
        outwardIssue: { id: "53074", key: "PROJ-61", fields: { summary: "S" } },
      },
      {
        id: "23764",
        type: blocksType,
        inwardIssue: { id: "53536", key: "PROJ-4", fields: { summary: "S" } },
      },
      {
        id: "23765",
        type: blocksType,
        inwardIssue: { id: "53077", key: "PROJ-64", fields: { summary: "S" } },
      },
    ],
  },
};

const postLinkBody = (): Record<string, unknown> => {
  const call = request.mock.calls.find(
    ([method, path]) => method === "POST" && path === "/issueLink",
  );
  return call?.[2] as Record<string, unknown>;
};

describe("Jira Blocks link direction, against a recorded Jira response", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation((method: string, path: string) => {
      if (method === "GET" && path === "/issueLinkType")
        return Promise.resolve({ issueLinkTypes: [blocksType] });
      if (method === "GET" && path === "/issue/PROJ-33") return Promise.resolve(recordedIssue);
      if (method === "POST" && path === "/issueLink") return Promise.resolve(undefined);
      if (method === "DELETE" && path.startsWith("/issueLink/")) return Promise.resolve(undefined);
      throw new Error(`unexpected ${method} ${path}`);
    });
  });

  it("reads the issues a ticket is blocked by from inwardIssue and the issues it blocks from outwardIssue", async () => {
    const ticket = await makeTracker().getTicket("PROJ-33");

    expect(ticket.blockedBy).toEqual(["PROJ-4", "PROJ-64"]);
    expect(ticket.blocking).toEqual(["PROJ-61"]);
  });

  it('creates a link Jira shows as "blocker blocks ticket": the blocker goes in inwardIssue on POST', async () => {
    await makeTracker().blockTicket("PROJ-33", "PROJ-7");

    expect(postLinkBody()).toEqual({
      type: { name: "Blocks" },
      inwardIssue: { key: "PROJ-7" },
      outwardIssue: { key: "PROJ-33" },
    });
  });

  it("treats an existing blocker in the recorded response as already linked", async () => {
    await makeTracker().blockTicket("PROJ-33", "PROJ-4");

    expect(request.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("unblocks by deleting the link to the blocker, not the link to an issue the ticket blocks", async () => {
    await makeTracker().unblockTicket("PROJ-33", "PROJ-4");
    await makeTracker().unblockTicket("PROJ-33", "PROJ-61");

    const deletes = request.mock.calls
      .filter(([method]) => method === "DELETE")
      .map(([, path]) => path);
    expect(deletes).toEqual(["/issueLink/23764"]);
  });
});
