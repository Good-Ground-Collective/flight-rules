import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAgentRegistry, InvalidAgentDefinitionError } from "../agent-registry.js";

const root = join(import.meta.dirname, "../../../..");
const registry = new FileAgentRegistry();
const directories: string[] = [];
const scratch = (variants: unknown): string => {
  const directory = mkdtempSync(join(tmpdir(), "flight-rules-agents-"));
  directories.push(directory);
  writeFileSync(join(directory, "code-implementation.md"), readFileSync(join(root, "agents/code-implementation.md")));
  writeFileSync(join(directory, "variants.json"), JSON.stringify(variants));
  return directory;
};
const variant = {
  name: "code-implementation-escalated",
  extends: "code-implementation",
  description: "Final implementation attempt after two rejected verifications.",
  model: "escalated",
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("FileAgentRegistry", () => {
  it("loads five canonical prompts and two named tier variants without copying their bodies", () => {
    const agents = registry.load(join(root, "agents"));
    const names = agents.map((agent) => agent.frontmatter.name);
    expect(names).toEqual([
      "code-implementation", "code-implementation-escalated", "code-verifier",
      "qa-engineer", "qa-engineer-verify", "research-agent", "tech-writer",
    ]);
    for (const [baseName, variantName, baseTier, variantTier] of [
      ["code-implementation", "code-implementation-escalated", "standard", "escalated"],
      ["qa-engineer", "qa-engineer-verify", "escalated", "standard"],
    ]) {
      const base = agents.find((agent) => agent.frontmatter.name === baseName);
      const derived = agents.find((agent) => agent.frontmatter.name === variantName);
      expect(derived?.body).toBe(base?.body);
      expect(base?.frontmatter.model).toBe(baseTier);
      expect(derived?.frontmatter.model).toBe(variantTier);
      expect(derived?.frontmatter.capabilities).toEqual(base?.frontmatter.capabilities);
      expect(derived?.frontmatter["x-claude"]).toEqual(base?.frontmatter["x-claude"]);
    }
  });

  it.each([
    ["missing base", [{ ...variant, extends: "missing-agent" }]],
    ["canonical name collision", [{ ...variant, name: "code-implementation" }]],
    ["duplicate variant", [variant, variant]],
    ["variant inheritance", [variant, { ...variant, name: "another-agent", extends: variant.name }]],
  ])("rejects %s", (_name, variants) => {
    expect(() => registry.load(scratch(variants))).toThrow(InvalidAgentDefinitionError);
  });

  it.each([
    [{ ...variant, tools: "Bash" }],
    [{ ...variant, capabilities: ["edit"] }],
    [{ ...variant, model: "opus" }],
    [{ ...variant, model: "expert" }],
    [{ ...variant, model: "expert", modelReason: " " }],
  ])("rejects invalid variant metadata %j", (variants) => {
    expect(() => registry.load(scratch(variants))).toThrow();
  });

  it("allows a documented expert variant without changing the base registration", () => {
    const agents = registry.load(scratch([{ ...variant, model: "expert", modelReason: "Owner chose this for an exceptional investigation." }]));
    expect(agents[0]?.frontmatter.model).toBe("standard");
    expect(agents[1]?.frontmatter.modelReason).toContain("Owner chose");
  });

  it("rejects filename/name disagreement and empty canonical prompts", () => {
    const directory = scratch([]);
    writeFileSync(join(directory, "wrong-name.md"), readFileSync(join(root, "agents/code-implementation.md")));
    expect(() => registry.load(directory)).toThrow(InvalidAgentDefinitionError);
    rmSync(join(directory, "wrong-name.md"));
    const source = readFileSync(join(directory, "code-implementation.md"), "utf8");
    const frontmatter = /^---\n[\s\S]*?^---\n/m.exec(source)?.[0] ?? "";
    writeFileSync(join(directory, "code-implementation.md"), frontmatter);
    expect(() => registry.load(directory)).toThrow(InvalidAgentDefinitionError);
  });
});
