import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAgentRegistry } from "../../agents/agent-registry/agent-registry.js";
import { sourceFailures, unresolvedWorkers, workerReferences } from "./source-drift-helpers.js";

const root = join(import.meta.dirname, "../../..");
const sources = ["skills", "agents"].flatMap((directory) =>
  readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name)),
);
const agents = new FileAgentRegistry().load(join(root, "agents"));

describe("canonical agent and skill sources", () => {
  it.each(sources)("%s names capabilities and tiers rather than native tools/models", (file) => {
    const failures = sourceFailures(relative(root, file), readFileSync(file, "utf8"));
    expect(failures).toEqual([]);
  });

  it("reserves expert tier and grants no orchestration capabilities to current workers", () => {
    for (const agent of agents) {
      if (agent.frontmatter.model === "expert") {
        expect(agent.frontmatter.modelReason?.trim()).not.toBe("");
        expect(agent.frontmatter.modelReason).toBeDefined();
      }
      expect(agent.frontmatter.capabilities).not.toContain("spawn");
      expect(agent.frontmatter.capabilities).not.toContain("ask");
    }
    for (const host of ["claude", "codex"]) {
      const bindings = JSON.parse(readFileSync(join(root, "adapters", host, "model-tiers.json"), "utf8"));
      expect(Object.keys(bindings).sort()).toEqual(["escalated", "expert", "standard"]);
      expect(Object.values(bindings).every((value) => typeof value === "string" && value.trim() !== "")).toBe(true);
    }
  });

  it("all named worker references resolve, including tier variants", () => {
    const names = new Set(agents.map((agent) => agent.frontmatter.name));
    const references = sources.flatMap((file) =>
      workerReferences(relative(root, file), readFileSync(file, "utf8"), names),
    );
    expect(references.length).toBeGreaterThan(0);
    expect(unresolvedWorkers(references, names)).toEqual([]);
    expect(references.some((reference) => reference.name === "code-implementation-escalated")).toBe(true);
    expect(references.some((reference) => reference.name === "qa-engineer-verify")).toBe(true);
  });

  // Native prompt/registration parity belongs to the in-process compiler suite;
  // do not read a previously built target as the source guard's oracle.

  it("ships the native registrations and bindings in npm and the marketplace release commit", () => {
    const cache = mkdtempSync(join(tmpdir(), "flight-rules-pack-"));
    try {
      const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", "--cache", cache], { cwd: root, encoding: "utf8" });
      const packed: { files: { path: string }[] }[] = JSON.parse(output);
      const paths = new Set(packed[0]?.files.map((file) => file.path));
      for (const agent of agents) {
        expect(paths.has(`dist/claude/agents/${agent.frontmatter.name}.md`)).toBe(true);
        expect(paths.has(`dist/codex/.codex/agents/${agent.frontmatter.name}.toml`)).toBe(true);
      }
      for (const path of ["agents/variants.json", "adapters/claude/model-tiers.json", "adapters/codex/model-tiers.json", "dist/review.js"]) {
        expect(paths.has(path)).toBe(true);
      }
      for (const path of ["dist/claude/.claude-plugin/plugin.json", "dist/codex/.codex-plugin/plugin.json", "dist/codex/plugin.json", ".agents/plugins/marketplace.json"]) {
        expect(paths.has(path)).toBe(true);
      }

      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const releaseGit = pkg.release.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "@semantic-release/git");
      expect(releaseGit[1].assets).toContain("dist/**");
      expect(releaseGit[1].assets).toContain("bin/**");
      expect(releaseGit[1].assets).toContain("contracts/code-review/*.schema.json");
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
