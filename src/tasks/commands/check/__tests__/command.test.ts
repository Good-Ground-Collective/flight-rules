import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckCommand } from "../command.js";
import type { Config } from "../../../../shared/config.js";
import type { TaskTracker } from "../../../task-tracker/task-tracker.js";
import { NodeToolProbe } from "../../../tool-probe/tool-probe.js";
import type { ToolCheck, ToolProbe } from "../../../tool-probe/tool-probe.js";
import { QaInstructionsFinder } from "../../../qa-instructions/qa-instructions.js";

const config: Config = {
  tracker: "github",
  repo: "acme/proj",
  defaultLabels: [],
  rfcStorage: "local",
  competencies: [],
};

const makeTracker = (
  ping: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
): Pick<TaskTracker, "ping"> => ({ ping });

const noToolChecks: ToolCheck[] = [];
const makeProbe = (checks: ToolCheck[] = noToolChecks): ToolProbe => ({
  probe: vi.fn().mockResolvedValue(checks),
});

const run = (
  getConfig: () => Config,
  tracker: Pick<TaskTracker, "ping">,
  probe: ToolProbe = makeProbe(),
) =>
  createCheckCommand(
    getConfig,
    () => tracker as TaskTracker,
    () => "/tmp/does-not-exist/.claude/flight-rules.local.md",
    () => probe,
  )
    .exitOverride()
    .parseAsync([], { from: "user" });

const lastJson = (output: ReturnType<typeof vi.spyOn>) =>
  JSON.parse(String(vi.mocked(output).mock.calls[0]?.[0])) as {
    tracker: string | null;
    repo: string | null;
    ok: boolean;
    checks: { name: string; ok: boolean; detail: string }[];
  };

describe("check command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports discovered QA instructions and tells the probe they exist", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const repo = mkdtempSync(join(tmpdir(), "fr-check-qa-"));
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, "QA.md"), "Log in through the SSO bypass.\n");
    const finder = new QaInstructionsFinder();
    const discover = vi
      .spyOn(finder, "discover")
      .mockImplementation((input) =>
        QaInstructionsFinder.prototype.discover.call(finder, {
          ...input,
          from: repo,
        }),
      );
    const probe = makeProbe();
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await createCheckCommand(
      () => config,
      () => makeTracker() as TaskTracker,
      () => join(repo, ".claude", "flight-rules.local.md"),
      () => probe,
      () => finder,
    )
      .exitOverride()
      .parseAsync([], { from: "user" });

    expect(discover).toHaveBeenCalled();
    const qa = lastJson(output).checks.find((c) => c.name === "qa-instructions");
    expect(qa?.ok).toBe(true);
    expect(qa?.detail).toBe(join(repo, "QA.md"));
    expect(probe.probe).toHaveBeenCalledWith({
      repo: "acme/proj",
      qaInstructionsFound: true,
    });
    output.mockRestore();
  });

  it("passes when no QA instructions exist, reporting them as optional", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const finder = new QaInstructionsFinder();
    vi.spyOn(finder, "discover").mockReturnValue({ found: false, sources: [] });
    const probe = makeProbe();
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await createCheckCommand(
      () => config,
      () => makeTracker() as TaskTracker,
      () => "/tmp/does-not-exist/.claude/flight-rules.local.md",
      () => probe,
      () => finder,
    )
      .exitOverride()
      .parseAsync([], { from: "user" });

    const parsed = lastJson(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.find((c) => c.name === "qa-instructions")?.ok).toBe(false);
    expect(probe.probe).toHaveBeenCalledWith({
      repo: "acme/proj",
      qaInstructionsFound: false,
    });
    output.mockRestore();
  });

  it("reports all-ok when config, credentials, and reachability pass", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await run(() => config, makeTracker());
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tracker).toBe("github");
    expect(parsed.repo).toBe("acme/proj");
    expect(
      parsed.checks
        .filter((c) => c.name !== "qa-instructions")
        .every((c) => c.ok),
    ).toBe(true);
    output.mockRestore();
  });

  it("fails and throws when GITHUB_TOKEN is missing", async () => {
    vi.stubEnv("GITHUB_TOKEN", undefined);
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const ping = vi.fn().mockResolvedValue(undefined);
    await expect(run(() => config, makeTracker(ping))).rejects.toThrow(
      "check failed",
    );
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.find((c) => c.name === "credentials")?.ok).toBe(false);
    expect(ping).not.toHaveBeenCalled(); // probe skipped when creds missing
    output.mockRestore();
  });

  it("fails and throws when the tracker is unreachable", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const tracker = makeTracker(
      vi.fn().mockRejectedValue(new Error("Not Found")),
    );
    await expect(run(() => config, tracker)).rejects.toThrow("check failed");
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.find((c) => c.name === "reachable")?.detail).toContain(
      "Not Found",
    );
    output.mockRestore();
  });

  it("appends the tool probe entries to the checks", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const probe = makeProbe([
      { name: "tools:gh", ok: true, detail: "gh 2.99.0", required: true },
    ]);
    await run(() => config, makeTracker(), probe);
    const parsed = lastJson(output);
    expect(parsed.checks.find((c) => c.name === "tools:gh")).toEqual({
      name: "tools:gh",
      ok: true,
      detail: "gh 2.99.0",
      required: true,
    });
    output.mockRestore();
  });

  it("does not fail check when a non-required tool probe reports not ok", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const probe = makeProbe([
      { name: "tools:ffmpeg", ok: false, detail: "not installed", required: false },
    ]);
    await run(() => config, makeTracker(), probe);
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(true);
    output.mockRestore();
  });

  it("treats the QA tools as required when only an overridden recipe exists", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    // A recipe outside the config dir, referenced via qaRecipe; no default
    // flight-rules.qa.md beside the config exists.
    const dir = mkdtempSync(join(tmpdir(), "fr-check-"));
    const recipePath = join(dir, "custom-recipe.md");
    writeFileSync(recipePath, "capture evidence from op://vault/item\n");
    const configPath = join(dir, ".claude", "flight-rules.local.md");
    const overridden: Config = { ...config, qaRecipe: recipePath };

    // Real probe so the recipe is actually read; stub the spawns so no binary
    // is required and every tool reports missing.
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    const probe = new NodeToolProbe({
      execFileFn: () => Promise.reject(enoent),
    });

    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await expect(
      createCheckCommand(
        () => overridden,
        () => makeTracker() as TaskTracker,
        () => configPath,
        () => probe,
      )
        .exitOverride()
        .parseAsync([], { from: "user" }),
    ).rejects.toThrow("check failed");

    const parsed = lastJson(output);
    const playwright = parsed.checks.find(
      (c) => c.name === "tools:playwright-cli",
    ) as (ToolCheck & { required: boolean }) | undefined;
    expect(playwright?.required).toBe(true);
    expect(parsed.checks.map((c) => c.name)).not.toContain("tools:op");
    output.mockRestore();
  });

  it("fails check when a required tool probe reports not ok", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const probe = makeProbe([
      { name: "tools:gh", ok: false, detail: "gh 2.98.0 is older than required", required: true },
    ]);
    await expect(run(() => config, makeTracker(), probe)).rejects.toThrow(
      "check failed",
    );
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(false);
    output.mockRestore();
  });
});

const jiraConfig: Config = {
  tracker: "jira",
  jiraHost: "acme.atlassian.net",
  jiraEmail: "me@acme.com",
  jiraProject: "PROJ",
  defaultLabels: [],
  rfcStorage: "local",
  competencies: [],
};

describe("check command (jira)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports all-ok when JIRA_TOKEN is present and the probe succeeds", async () => {
    vi.stubEnv("JIRA_TOKEN", "tok");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await run(() => jiraConfig, makeTracker());
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tracker).toBe("jira");
    output.mockRestore();
  });

  it("fails and skips the probe when JIRA_TOKEN and its aliases are missing", async () => {
    vi.stubEnv("JIRA_TOKEN", undefined);
    vi.stubEnv("JIRA_API_TOKEN", undefined);
    vi.stubEnv("JIRA_API_KEY", undefined);
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const ping = vi.fn().mockResolvedValue(undefined);
    await expect(run(() => jiraConfig, makeTracker(ping))).rejects.toThrow(
      "check failed",
    );
    const parsed = lastJson(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.find((c) => c.name === "credentials")?.ok).toBe(false);
    expect(
      parsed.checks.find((c) => c.name === "credentials")?.detail,
    ).toContain("JIRA_TOKEN");
    expect(ping).not.toHaveBeenCalled();
    output.mockRestore();
  });

  it("fails credentials when neither JIRA_EMAIL nor jiraEmail is set", async () => {
    vi.stubEnv("JIRA_TOKEN", "tok");
    vi.stubEnv("JIRA_EMAIL", undefined);
    const withoutEmail: Config = { ...jiraConfig };
    delete withoutEmail.jiraEmail;
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await expect(run(() => withoutEmail, makeTracker())).rejects.toThrow(
      "check failed",
    );
    const credentials = lastJson(output).checks.find(
      (c) => c.name === "credentials",
    );
    expect(credentials?.ok).toBe(false);
    expect(credentials?.detail).toContain("JIRA_EMAIL");
    expect(credentials?.detail).not.toContain("JIRA_TOKEN");
    output.mockRestore();
  });
});
