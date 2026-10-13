import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { FileAgentRegistry } from "../../agent-registry/agent-registry.js";
import { TomlCodexAgentEmitter } from "../codex-agent-emitter.js";
import { UnsupportedAgentSettingError } from "../agent-emitter.js";

const root = join(import.meta.dirname, "../../../..");
const models = JSON.parse(readFileSync(join(root, "adapters/codex/model-tiers.json"), "utf8"));
const reasoning = JSON.parse(readFileSync(join(root, "adapters/codex/reasoning-tiers.json"), "utf8"));
const emitter = new TomlCodexAgentEmitter({ models, reasoning });
const agents = new FileAgentRegistry().load(join(root, "agents"));
const implementation = agents.find((agent) => agent.frontmatter.name === "code-implementation");
if (implementation === undefined) throw new Error("Missing implementation fixture");

describe("TomlCodexAgentEmitter", () => {
  it.each(agents)("serializes $frontmatter.name as native TOML with its exact prompt body", (agent) => {
    const result = parse(emitter.emit(agent));
    expect(result).toEqual({
      name: agent.frontmatter.name,
      description: agent.frontmatter.description,
      model: models[agent.frontmatter.model],
      model_reasoning_effort: reasoning[agent.frontmatter.model],
      sandbox_mode: agent.frontmatter.capabilities.includes("edit") ? "workspace-write" : "read-only",
      web_search: agent.frontmatter.capabilities.includes("web") ? "live" : "disabled",
      developer_instructions: agent.body,
    });
  });

  it("round-trips quotes, backslashes, Unicode, CRLF and embedded multiline delimiters", () => {
    const body = '\nA "quoted" path C:\\project\\files and café.\r\nA triple quote: """ and apostrophes: \'\'\'.\n';
    const description = 'A "quote": C:\\path\nwith another line.';
    const encoded = emitter.emit({ ...implementation, body, frontmatter: { ...implementation.frontmatter, description } });
    expect(parse(encoded).developer_instructions).toBe(body);
    expect(parse(encoded).description).toBe(description);
  });

  it("allows explicit reasoning to override a tier's adapter default", () => {
    const result = parse(emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, reasoning: "medium" } }));
    expect(result.model_reasoning_effort).toBe("medium");
    expect(result.model).toBe(models.standard);
  });

  it("selects the reserved expert binding only with recorded rationale", () => {
    expect(() => emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, model: "expert" } })).toThrow(/modelReason/);
    const result = parse(emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, model: "expert", modelReason: "Owner requested the expert profile for this investigation." } }));
    expect(result.model).toBe(models.expert);
    expect(result.model_reasoning_effort).toBe(reasoning.expert);
  });

  it.each([
    { sandbox: { fs: "read-only", network: "none" } },
    { sandbox: { fs: "workspace-write", network: "enabled" } },
    { dispatch: { maxConcurrent: 2, maxDepth: 1 } },
    { capabilities: ["read", "spawn"] },
    { capabilities: ["read", "ask"] },
  ])("rejects explicit settings that need runtime enforcement: %j", (metadata) => {
    expect(() => emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, ...metadata } } as never)).toThrow(UnsupportedAgentSettingError);
  });

  it("rejects missing tier bindings, invalid definitions and empty prompts", () => {
    expect(() => new TomlCodexAgentEmitter({ models: { standard: "one", escalated: "two" }, reasoning } as never)).toThrow();
    expect(() => new TomlCodexAgentEmitter({ models, reasoning: { ...reasoning, standard: "unsupported" } })).toThrow();
    expect(() => emitter.emit({ ...implementation, body: " " })).toThrow(/prompt/);
    expect(() => emitter.emit({ ...implementation, frontmatter: { ...implementation.frontmatter, tools: "Bash" } } as never)).toThrow();
  });

  it("reports host permission and presentation limits without adding them to prompts", () => {
    const diagnostics = emitter.diagnostics(implementation);
    expect(diagnostics.some((message) => message.includes("tool allowlist"))).toBe(true);
    expect(diagnostics.some((message) => message.includes("evidence directories"))).toBe(true);
    expect(diagnostics.some((message) => message.includes("color"))).toBe(true);
    expect(emitter.emit(implementation)).not.toContain("x-claude");
    expect(parse(emitter.emit(implementation)).developer_instructions).toBe(implementation.body);
  });
});
