import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQaCommand } from "../command.js";
import type { Config } from "../../../../shared/config.js";

const config: Config = {
  tracker: "github",
  repo: "acme/proj",
  defaultLabels: [],
  rfcStorage: "local",
  competencies: [],
};

let repo: string;

beforeEach(() => {
  vi.restoreAllMocks();
  repo = mkdtempSync(join(tmpdir(), "fr-qa-"));
  mkdirSync(join(repo, ".git"));
  vi.spyOn(process, "cwd").mockReturnValue(repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const configPath = (): string => join(repo, ".claude", "flight-rules.local.md");

const run = (args: string[], getConfig: () => Config = () => config) =>
  createQaCommand(getConfig, configPath).exitOverride().parseAsync(args, { from: "user" });

const captureStdout = () => vi.spyOn(process.stdout, "write").mockImplementation(() => true);

const lastJson = (output: ReturnType<typeof captureStdout>) =>
  JSON.parse(String(output.mock.calls.at(-1)?.[0])) as {
    found: boolean;
    sources: { path: string; kind: string; dir: string; content: string; legacy?: boolean }[];
  };

describe("qa instructions", () => {
  it("prints found false and exits cleanly when nothing exists", async () => {
    const output = captureStdout();
    await run(["instructions"]);
    expect(lastJson(output)).toEqual({ found: false, sources: [] });
  });

  it("prints QA.md from the working directory", async () => {
    writeFileSync(join(repo, "QA.md"), "Use staging.\n");
    const output = captureStdout();
    await run(["instructions"]);
    expect(lastJson(output).sources).toEqual([
      { path: join(repo, "QA.md"), kind: "qa-md", dir: repo, content: "Use staging." },
    ]);
  });

  it("starts from --from and returns nearer sources first", async () => {
    writeFileSync(join(repo, "QA.md"), "root");
    mkdirSync(join(repo, "packages", "web"), { recursive: true });
    writeFileSync(join(repo, "packages", "web", "AGENTS.md"), "# Web\n\n## QA\n\nweb notes\n");
    const output = captureStdout();
    await run(["instructions", "--from", join(repo, "packages", "web")]);
    expect(lastJson(output).sources.map((s) => s.content)).toEqual(["web notes", "root"]);
  });

  it("falls back to the legacy recipe beside the config", async () => {
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude", "flight-rules.qa.md"), "old recipe");
    const output = captureStdout();
    await run(["instructions"]);
    const [source] = lastJson(output).sources;
    expect(source).toMatchObject({ kind: "legacy-recipe", legacy: true, content: "old recipe" });
  });

  it("works without any flight-rules config", async () => {
    writeFileSync(join(repo, "QA.md"), "no config needed");
    const output = captureStdout();
    await run(["instructions"], () => {
      throw new Error("config not found");
    });
    expect(lastJson(output).found).toBe(true);
  });

  it("rejects a blank qaRecipe value", async () => {
    await expect(run(["instructions"], () => ({ ...config, qaRecipe: "   " }))).rejects.toThrow(
      /qaRecipe is set to a blank value/,
    );
  });
});

describe("qa recipe (deprecated)", () => {
  it("prints the nearest source's path and a deprecation note", async () => {
    writeFileSync(join(repo, "QA.md"), "notes");
    const output = captureStdout();
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await run(["recipe"]);
    expect(output).toHaveBeenCalledWith(`${join(repo, "QA.md")}\n`);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
  });

  it("throws when no instructions exist", async () => {
    await expect(run(["recipe"])).rejects.toThrow(/No QA instructions found/);
  });
});
