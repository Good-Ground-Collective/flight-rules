import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommanderError } from "commander";
import type { TaskTracker, Initiative, Epic, Ticket } from "../../../task-tracker/task-tracker.js";
import type { PullRequestHost, OpenPullRequest } from "../../../../pr/pull-request-host/pull-request-host.js";
import { createInitiativeCommand } from "../command.js";

const mockInitiative: Initiative = {
  id: "7",
  size: "initiative",
  title: "Q3 Platform",
  body: "The big push",
  epics: [{ id: "19", title: "Decomposition" }],
};

const epicWith = (id: string, childIssues: Ticket[]): Epic => ({
  id,
  size: "epic",
  status: "open",
  labels: ["epic"],
  title: `Epic ${id}`,
  body: "B",
  childIssues,
  comments: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
});

const child = (id: string, blockedBy: string[] = [], status = "open"): Ticket => ({
  id,
  size: "ticket",
  status,
  labels: ["ticket"],
  title: `Ticket ${id}`,
  body: "B",
  comments: [],
  assignee: null,
  attachments: [],
  reporter: null,
  issueType: "Story",
  blockedBy,
  blocking: [],
  metadata: {},
  updatedAt: "2026-01-01T00:00:00Z",
});

type InitiativeTracker = Pick<
  TaskTracker,
  "createInitiative" | "getInitiative" | "getEpic" | "updateInitiativeDescription"
>;

const makeTracker = (): InitiativeTracker => ({
  createInitiative: vi.fn().mockResolvedValue(mockInitiative),
  getInitiative: vi.fn().mockResolvedValue(mockInitiative),
  getEpic: vi.fn().mockResolvedValue(epicWith("19", [])),
  updateInitiativeDescription: vi.fn().mockResolvedValue(mockInitiative),
});

const makeHost = (open: OpenPullRequest[] = []): PullRequestHost => ({
  createPullRequest: vi.fn(),
  commentOnPullRequest: vi.fn(),
  listOpenPullRequestsForTickets: vi.fn().mockResolvedValue(open),
  defaultBranch: vi.fn().mockResolvedValue("main"),
  requestReviewers: vi.fn(),
});

const run = (tracker: InitiativeTracker, args: string[], host: PullRequestHost = makeHost()) =>
  createInitiativeCommand(() => tracker as TaskTracker, () => host)
    .exitOverride()
    .parseAsync(args, { from: "user" });

describe("initiative command", () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls createInitiative and prints JSON for "create"', async () => {
    const tracker = makeTracker();
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await run(tracker, ["create", "--title", "Q3 Platform", "--body", "The big push"]);
    expect(tracker.createInitiative).toHaveBeenCalledWith({
      title: "Q3 Platform",
      body: "The big push",
    });
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + "\n");
    output.mockRestore();
  });

  it('rejects "create" when the body references a machine-local path', async () => {
    const tracker = makeTracker();
    await expect(
      run(tracker, ["create", "--title", "T", "--body", "Plan in /home/pm/plan.md"]),
    ).rejects.toThrow("references files on this machine");
    expect(tracker.createInitiative).not.toHaveBeenCalled();
  });

  it('calls getInitiative and prints JSON for "get"', async () => {
    const tracker = makeTracker();
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await run(tracker, ["get", "7"]);
    expect(tracker.getInitiative).toHaveBeenCalledWith("7");
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + "\n");
    output.mockRestore();
  });

  it('calls updateInitiativeDescription and prints JSON for "edit"', async () => {
    const tracker = makeTracker()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(tracker, ['edit', '7', '--body', 'Rewritten body', '--title', 'New Title'])
    expect(tracker.updateInitiativeDescription).toHaveBeenCalledWith('7', {
      body: 'Rewritten body',
      title: 'New Title',
    })
    expect(output).toHaveBeenCalledWith(JSON.stringify(mockInitiative) + '\n')
    output.mockRestore()
  })

  it('rejects "edit" when neither --body nor --body-file is given', async () => {
    const tracker = makeTracker()
    await expect(run(tracker, ['edit', '7'])).rejects.toThrow('one of --body or --body-file')
    expect(tracker.updateInitiativeDescription).not.toHaveBeenCalled()
  })

  it('rejects "create" when --title is missing', async () => {
    const tracker = makeTracker();
    const errOutput = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(run(tracker, ["create", "--body", "B"])).rejects.toThrow(CommanderError);
    expect(tracker.createInitiative).not.toHaveBeenCalled();
    errOutput.mockRestore();
  });

  it('rejects "create" when neither --body nor --body-file is given', async () => {
    const tracker = makeTracker();
    await expect(run(tracker, ["create", "--title", "T"])).rejects.toThrow(
      "one of --body or --body-file",
    );
    expect(tracker.createInitiative).not.toHaveBeenCalled();
  });

  it('plans every epic\'s tickets in one graph for "plan"', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getInitiative).mockResolvedValue({
      ...mockInitiative,
      epics: [
        { id: "19", title: "First" },
        { id: "20", title: "Second" },
      ],
    });
    vi.mocked(tracker.getEpic).mockImplementation(async (id: string) =>
      id === "19" ? epicWith("19", [child("1")]) : epicWith("20", [child("2")]),
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await run(tracker, ["plan", "7"]);

    expect(tracker.getEpic).toHaveBeenCalledWith("19");
    expect(tracker.getEpic).toHaveBeenCalledWith("20");
    const parsed: { waves: { id: string }[][]; cycles: string[] } = JSON.parse(
      String(vi.mocked(output).mock.calls[0]?.[0]),
    );
    expect(parsed.waves.map((w) => w.map((t) => t.id))).toEqual([["1", "2"]]);
    expect(parsed.cycles).toEqual([]);
    output.mockRestore();
  });

  it('honours a blocker that lives in a sibling epic for "plan"', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getInitiative).mockResolvedValue({
      ...mockInitiative,
      epics: [
        { id: "19", title: "First" },
        { id: "20", title: "Second" },
      ],
    });
    vi.mocked(tracker.getEpic).mockImplementation(async (id: string) =>
      id === "19" ? epicWith("19", [child("1")]) : epicWith("20", [child("2", ["1"])]),
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await run(tracker, ["plan", "7"]);

    const parsed: { waves: { id: string }[][] } = JSON.parse(
      String(vi.mocked(output).mock.calls[0]?.[0]),
    );
    expect(parsed.waves.map((w) => w.map((t) => t.id))).toEqual([["1"], ["2"]]);
    output.mockRestore();
  });

  it('exits non-zero when a cycle spans two epics for "plan"', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getInitiative).mockResolvedValue({
      ...mockInitiative,
      epics: [
        { id: "19", title: "First" },
        { id: "20", title: "Second" },
      ],
    });
    vi.mocked(tracker.getEpic).mockImplementation(async (id: string) =>
      id === "19" ? epicWith("19", [child("1", ["2"])]) : epicWith("20", [child("2", ["1"])]),
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(run(tracker, ["plan", "7"])).rejects.toThrow("dependency cycle");

    expect(output).toHaveBeenCalled();
    output.mockRestore();
  });

  it('returns empty waves for an initiative with no epics for "plan"', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getInitiative).mockResolvedValue({ ...mockInitiative, epics: [] });
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await run(tracker, ["plan", "7"]);

    expect(tracker.getEpic).not.toHaveBeenCalled();
    const parsed: { waves: unknown[]; cycles: string[] } = JSON.parse(
      String(vi.mocked(output).mock.calls[0]?.[0]),
    );
    expect(parsed.waves).toEqual([]);
    expect(parsed.cycles).toEqual([]);
    output.mockRestore();
  });

  it('plans reviews across epics and applies the route rule once for "review-plan"', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getInitiative).mockResolvedValue({
      ...mockInitiative,
      epics: [
        { id: "19", title: "First" },
        { id: "20", title: "Second" },
      ],
    });
    vi.mocked(tracker.getEpic).mockImplementation(async (id: string) =>
      id === "19"
        ? epicWith("19", [child("1", [], "In Review")])
        : epicWith("20", [child("2", ["1"], "In Review"), child("3", ["2"])]),
    );
    const host = makeHost([
      { ticket: "1", number: 11, url: "https://x/pull/11", headRefName: "feat/1-a", baseRefName: "main", title: "feat(1): a" },
      { ticket: "2", number: 12, url: "https://x/pull/12", headRefName: "feat/2-b", baseRefName: "main", title: "feat(2): b" },
    ]);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await run(tracker, ["review-plan", "7"], host);

    expect(host.listOpenPullRequestsForTickets).toHaveBeenCalledWith(["1", "2"]);
    const parsed: {
      initiative: { id: string };
      route: string;
      reasons: string[];
      missing: string[];
      blocked: { ticketId: string; wave: number; blockedBy: string[] }[];
      unblocksOnMerge: string[];
    } = JSON.parse(String(vi.mocked(output).mock.calls[0]?.[0]));
    expect(parsed.initiative.id).toBe("7");
    expect(parsed.blocked.map((b) => [b.ticketId, b.wave, b.blockedBy])).toEqual([
      ["1", 0, []],
      ["2", 1, ["1"]],
    ]);
    expect(parsed.route).toBe("complex");
    expect(parsed.reasons).toHaveLength(1);
    expect(parsed.reasons[0]).toContain("spans more than one wave");
    expect(parsed.missing).toEqual([]);
    expect(parsed.unblocksOnMerge).toEqual(["3"]);
    output.mockRestore();
  });

  it('reports an incomplete route when a blocked ticket has no PR for "review-plan"', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getEpic).mockResolvedValue(epicWith("19", [child("1", [], "In Review")]));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await run(tracker, ["review-plan", "7"]);

    const parsed: { route: string; missing: string[] } = JSON.parse(String(vi.mocked(output).mock.calls[0]?.[0]));
    expect(parsed.route).toBe("incomplete");
    expect(parsed.missing).toEqual(["1"]);
    output.mockRestore();
  });

  it('throws after printing when "review-plan" finds a cycle across epics', async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.getInitiative).mockResolvedValue({
      ...mockInitiative,
      epics: [
        { id: "19", title: "First" },
        { id: "20", title: "Second" },
      ],
    });
    vi.mocked(tracker.getEpic).mockImplementation(async (id: string) =>
      id === "19" ? epicWith("19", [child("1", ["2"])]) : epicWith("20", [child("2", ["1"])]),
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(run(tracker, ["review-plan", "7"])).rejects.toThrow("dependency cycle");

    expect(output).toHaveBeenCalled();
    output.mockRestore();
  });
});
