import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../../../shared/config-store.js";
import { createConfigCommand } from "../command.js";

describe("config command", () => {
  let root: string;
  let project: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fr-config-cmd-"));
    project = join(root, "project");
    home = join(root, "home");
    mkdirSync(join(project, ".claude"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        pluginConfigs: {
          "flight-rules@flight-rules": {
            options: { tracker: "github", repo: "acme/proj", inProgressStatus: "In Progress" },
          },
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const run = async (argv: string[]): Promise<Record<string, unknown>> => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createConfigCommand(() => new ConfigStore({ cwd: project, home, env: {} }))
      .exitOverride()
      .parseAsync(argv, { from: "user" });
    const last = output.mock.calls.at(-1)?.[0];
    return JSON.parse(String(last)) as Record<string, unknown>;
  };

  it("show prints the merged config with per-key sources", async () => {
    const report = await run(["show"]);
    expect(report["valid"]).toBe(true);
    expect(report["values"]).toMatchObject({ tracker: "github", repo: "acme/proj" });
    expect(report["sources"]).toMatchObject({ repo: { scope: "user" } });
  });

  it("show reports an incomplete config instead of failing", async () => {
    await run(["set", "tracker", "jira", "--scope", "user"]);
    const report = await run(["show"]);
    expect(report["valid"]).toBe(false);
    expect(report["error"]).toContain("jiraHost");
    expect(report["values"]).toMatchObject({ tracker: "jira", repo: "acme/proj" });
  });

  it("set writes to the scope that already holds the key", async () => {
    const result = await run(["set", "inProgressStatus", "Doing"]);
    expect(result).toMatchObject({ key: "inProgressStatus", scope: "user" });
    expect((await run(["show"]))["values"]).toMatchObject({ inProgressStatus: "Doing" });
  });

  it("set honours --scope and warns when a higher scope shadows the write", async () => {
    await run(["set", "inReviewStatus", "Review", "--scope", "local"]);
    const result = await run(["set", "inReviewStatus", "Other", "--scope", "user"]);
    expect(result["warning"]).toContain("local scope");
  });

  it("unset removes the key from a scope", async () => {
    await run(["set", "repo", "acme/override", "--scope", "local"]);
    await run(["unset", "repo", "--scope", "local"]);
    expect((await run(["show"]))["values"]).toMatchObject({ repo: "acme/proj" });
  });
});
