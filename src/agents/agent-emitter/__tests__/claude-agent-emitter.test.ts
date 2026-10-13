import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { FileAgentRegistry } from "../../agent-registry/agent-registry.js";
import { MarkdownClaudeAgentEmitter } from "../claude-agent-emitter.js";
import { UnsupportedAgentSettingError } from "../agent-emitter.js";

const root = join(import.meta.dirname, "../../../..");
const models = JSON.parse(readFileSync(join(root, "adapters/claude/model-tiers.json"), "utf8"));
const emitter = new MarkdownClaudeAgentEmitter({ models });
const agents = new FileAgentRegistry().load(join(root, "agents"));
const implementation = agents.find((agent) => agent.frontmatter.name === "code-implementation");
if (implementation === undefined) throw new Error("Missing implementation fixture");

describe("MarkdownClaudeAgentEmitter", () => {
  it.each(agents)("maps $frontmatter.name to native metadata while preserving its prompt bytes", (agent) => {
    const emitted = emitter.emit(agent);
    const header = /^---\n([\s\S]*?)^---\n/m.exec(emitted);
    const native = parseYaml(header?.[1] ?? "");
    const expectedTools = agent.frontmatter.capabilities.flatMap((capability) => ({
      read: ["Glob", "Grep", "Read"], edit: ["Write", "Edit"], shell: ["Bash"], web: ["WebSearch", "WebFetch"],
      spawn: [], ask: [],
    })[capability]);
    expect(native).toEqual({
      name: agent.frontmatter.name,
      description: agent.frontmatter.description,
      tools: expectedTools.join(", "),
      model: models[agent.frontmatter.model],
      color: agent.frontmatter["x-claude"]?.color,
    });
    expect(emitted.slice(header?.[0].length)).toBe(agent.body);
  });

  it("uses supplied model bindings rather than changing canonical instructions", () => {
    const custom = new MarkdownClaudeAgentEmitter({ models: { standard: "custom-standard", escalated: "custom-escalated", expert: "custom-expert" } });
    expect(custom.emit(implementation)).toContain("model: custom-standard");
    expect(emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, reasoning: "high" } })).toContain("effort: high");
  });

  it("requires bindings for all tiers, including the reserved expert tier", () => {
    expect(() => new MarkdownClaudeAgentEmitter({ models: { standard: "sonnet", escalated: "opus" } } as never)).toThrow();
    expect(() => new MarkdownClaudeAgentEmitter({ models: { ...models, expert: " " } })).toThrow();
  });

  it("rejects empty prompts and undocumented expert use", () => {
    expect(() => emitter.emit({ ...implementation, body: " " })).toThrow(/prompt/);
    expect(() => emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, model: "expert" } })).toThrow(/modelReason/);
  });

  it.each([
    { sandbox: { fs: "read-only", network: "none" } },
    { dispatch: { maxConcurrent: 2, maxDepth: 1 } },
    { capabilities: ["read", "spawn"] },
    { capabilities: ["read", "ask"] },
  ])("rejects restrictions/capabilities it cannot implement: %j", (metadata) => {
    expect(() => emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, ...metadata } } as never)).toThrow(UnsupportedAgentSettingError);
  });
});
