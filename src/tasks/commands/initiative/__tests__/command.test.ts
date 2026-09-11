import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommanderError } from "commander";
import type { TaskTracker, Initiative, Epic, Ticket } from "../../../task-tracker/task-tracker.js";
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

const run = (tracker: InitiativeTracker, args: string[]) =>
  createInitiativeCommand(() => tracker as TaskTracker)
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
});
