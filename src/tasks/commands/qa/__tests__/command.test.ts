import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, statSync } from "node:fs";
import { createQaCommand } from "../command.js";
import type { Config } from "../../../../shared/config.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), statSync: vi.fn() }));

const mockExistsSync = vi.mocked(existsSync);
const mockStatSync = vi.mocked(statSync);

const asFile = (isFile: boolean) =>
  ({ isFile: () => isFile }) as ReturnType<typeof statSync>;

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatSync.mockReturnValue(asFile(true));
  });

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

  it("rejects a blank qaRecipe value without touching the filesystem", async () => {
    await expect(run(["recipe"], { ...config, qaRecipe: "   " })).rejects.toThrow(
      /qaRecipe is set to a blank value/,
    );
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("rejects a recipe path that resolves to a directory", async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue(asFile(false));
    await expect(
      run(["recipe"], { ...config, qaRecipe: "/repo/some-dir" }),
    ).rejects.toThrow(/is not a regular file/);
  });

  it("throws a not-found error when a configured recipe file is missing", async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(
      run(["recipe"], { ...config, qaRecipe: "/repo/missing.md" }),
    ).rejects.toThrow(/QA recipe not found at/);
  });
});
