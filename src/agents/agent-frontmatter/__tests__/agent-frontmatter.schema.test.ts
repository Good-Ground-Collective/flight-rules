import { describe, expect, it } from "vitest";
import { AgentFrontmatterSchema, agentCapabilities, modelTiers, reasoningLevels, claudeAgentColors } from "../agent-frontmatter.schema.js";

const minimal = {
  name: "example-agent",
  description: "Reads project context.",
  capabilities: ["read"],
  model: "standard",
};

describe("AgentFrontmatterSchema", () => {
  it("accepts minimal and full definitions without adding defaults", () => {
    expect(AgentFrontmatterSchema.parse(minimal)).toEqual(minimal);
    const full = {
      ...minimal,
      capabilities: [...agentCapabilities],
      model: "escalated",
      reasoning: "high",
      sandbox: { fs: "workspace-write", network: "enabled" },
      dispatch: { maxConcurrent: 8, maxDepth: 1 },
      "x-claude": { color: "cyan" },
    };
    expect(AgentFrontmatterSchema.parse(full)).toEqual(full);
  });

  it.each(modelTiers)("accepts model tier %s", (model) => {
    expect(AgentFrontmatterSchema.parse({ ...minimal, model }).model).toBe(model);
  });

  it.each(reasoningLevels)("accepts reasoning %s", (reasoning) => {
    expect(AgentFrontmatterSchema.parse({ ...minimal, reasoning }).reasoning).toBe(reasoning);
  });

  it.each(claudeAgentColors)("accepts Claude color %s", (color) => {
    expect(AgentFrontmatterSchema.parse({ ...minimal, "x-claude": { color } })["x-claude"]).toEqual({ color });
  });

  it("accepts restrictive sandbox settings and an empty Claude extension", () => {
    const input = { ...minimal, sandbox: { fs: "read-only", network: "none" }, "x-claude": {} };
    expect(AgentFrontmatterSchema.parse(input)).toEqual(input);
  });

  it.each([
    ["unknown top-level key", { foo: true }],
    ["native tools", { tools: "Glob, Read" }],
    ["native color", { color: "cyan" }],
    ["sonnet alias", { model: "sonnet" }],
    ["opus alias", { model: "opus" }],
    ["empty capabilities", { capabilities: [] }],
    ["duplicate capabilities", { capabilities: ["read", "read"] }],
    ["unknown capability", { capabilities: ["bash"] }],
    ["uppercase name", { name: "Code-Verifier" }],
    ["numeric initial", { name: "1x" }],
    ["empty name", { name: "" }],
    ["name with underscore", { name: "code_verifier" }],
    ["empty description", { description: "" }],
    ["unknown reasoning", { reasoning: "max" }],
    ["missing sandbox network", { sandbox: { fs: "read-only" } }],
    ["missing sandbox filesystem", { sandbox: { network: "none" } }],
    ["invalid filesystem", { sandbox: { fs: "full", network: "none" } }],
    ["invalid network", { sandbox: { fs: "read-only", network: "allowed" } }],
    ["unknown sandbox key", { sandbox: { fs: "read-only", network: "none", extra: 1 } }],
    ["zero concurrency", { dispatch: { maxConcurrent: 0, maxDepth: 1 } }],
    ["negative concurrency", { dispatch: { maxConcurrent: -1, maxDepth: 1 } }],
    ["fractional concurrency", { dispatch: { maxConcurrent: 1.5, maxDepth: 1 } }],
    ["zero depth", { dispatch: { maxConcurrent: 1, maxDepth: 0 } }],
    ["negative depth", { dispatch: { maxConcurrent: 1, maxDepth: -1 } }],
    ["fractional depth", { dispatch: { maxConcurrent: 1, maxDepth: 1.5 } }],
    ["missing concurrency", { dispatch: { maxDepth: 1 } }],
    ["missing depth", { dispatch: { maxConcurrent: 1 } }],
    ["unknown dispatch key", { dispatch: { maxConcurrent: 1, maxDepth: 1, extra: true } }],
    ["unknown Claude key", { "x-claude": { colour: "cyan" } }],
    ["invalid Claude color", { "x-claude": { color: "teal" } }],
  ])("rejects %s", (_name, patch) => {
    expect(() => AgentFrontmatterSchema.parse({ ...minimal, ...patch })).toThrow();
  });

  it.each(["name", "description", "capabilities", "model"])("requires %s", (key) => {
    const input: Record<string, unknown> = { ...minimal };
    delete input[key];
    expect(() => AgentFrontmatterSchema.parse(input)).toThrow();
  });
});
