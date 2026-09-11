import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { createQaCommand } from "../command.js";
import type { Config } from "../../../../shared/config.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

const mockExistsSync = vi.mocked(existsSync);

const config: Config = {
  tracker: "github",
  repo: "acme/proj",
  defaultLabels: [],
  rfcStorage: "local",
  competencies: [],
};

const run = (args: string[], cfg: Config = config) =>
  createQaCommand(
    () => cfg,
    () => "/repo/.claude/flight-rules.local.md",
  )
    .exitOverride()
    .parseAsync(args, { from: "user" });

describe("qa recipe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prints the default recipe path when the file exists", async () => {
    mockExistsSync.mockReturnValue(true);
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await run(["recipe"]);
    expect(output).toHaveBeenCalledWith("/repo/.claude/flight-rules.qa.md\n");
  });

  it("prints the configured relative recipe path resolved against the config dir", async () => {
    mockExistsSync.mockReturnValue(true);
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await run(["recipe"], { ...config, qaRecipe: "../docs/x.md" });
    expect(output).toHaveBeenCalledWith("/repo/docs/x.md\n");
  });

  it("throws a not-found error when the recipe file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(run(["recipe"])).rejects.toThrow(/QA recipe not found at/);
  });
});
