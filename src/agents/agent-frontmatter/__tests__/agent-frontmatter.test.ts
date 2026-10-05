import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { agentFrontmatterParser, MissingFrontmatterError } from "../agent-frontmatter.js";

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("YamlAgentFrontmatterParser", () => {
  it("parses a full definition", () => {
    expect(agentFrontmatterParser.parse(fixture("valid-full.md"))).toEqual({
      name: "full-agent",
      description: "Implements and verifies work.",
      capabilities: ["read", "edit", "shell", "web", "spawn", "ask"],
      model: "escalated",
      reasoning: "high",
      sandbox: { fs: "workspace-write", network: "enabled" },
      dispatch: { maxConcurrent: 8, maxDepth: 1 },
      "x-claude": { color: "cyan" },
    });
  });

  it("parses minimal frontmatter and ignores prose", () => {
    expect(agentFrontmatterParser.parse(fixture("valid-minimal.md"))).toEqual({
      name: "example-agent",
      description: "Reads project context.",
      capabilities: ["read"],
      model: "standard",
    });
  });

  it("rejects Claude-native definitions with a tools diagnostic", () => {
    const parse = (): unknown => agentFrontmatterParser.parse(fixture("claude-native.md"));
    expect(parse).toThrow(ZodError);
    expect(parse).toThrow(/tools/);
  });

  it("rejects unknown nested keys", () => {
    expect(() => agentFrontmatterParser.parse(fixture("unknown-nested-key.md"))).toThrow(ZodError);
  });

  it.each([
    "No frontmatter.",
    "Text before\n---\nname: example\n---\n",
    "---\nname: example\n",
    "---\n- list\n- item\n---\n",
    "---\nscalar\n---\n",
    "---\nnull\n---\n",
    "---\n---\n",
  ])("rejects missing or non-mapping frontmatter: %j", (markdown) => {
    expect(() => agentFrontmatterParser.parse(markdown)).toThrow(MissingFrontmatterError);
  });

  it("accepts CRLF line endings", () => {
    expect(agentFrontmatterParser.parse(fixture("valid-full.md").replaceAll("\n", "\r\n")).name).toBe("full-agent");
  });

  it("accepts a closing delimiter at end of file", () => {
    const markdown = fixture("valid-minimal.md").split("---\n\n")[0] + "---";
    expect(agentFrontmatterParser.parse(markdown).name).toBe("example-agent");
  });

  it("rejects malformed YAML", () => {
    expect(() => agentFrontmatterParser.parse("---\nname: [broken\n---\n")).toThrow();
  });
});
