import { z } from "zod";
import { reasoningLevels } from "../agent-frontmatter/agent-frontmatter.schema.js";
import type { AgentDefinition } from "../agent-registry/agent-registry.js";
import { AgentDefinitionSchema, ModelBindingsSchema } from "./agent-emitter.schema.js";
import { type AgentEmitter, UnsupportedAgentSettingError } from "./agent-emitter.js";

const ReasoningBindingsSchema = z.strictObject({
  standard: z.enum(reasoningLevels),
  escalated: z.enum(reasoningLevels),
  expert: z.enum(reasoningLevels),
});
const CodexAgentEmitterPropsSchema = z.strictObject({
  models: ModelBindingsSchema,
  reasoning: ReasoningBindingsSchema,
});
type CodexAgentEmitterProps = z.infer<typeof CodexAgentEmitterPropsSchema>;

/** Serializes native configuration without turning a capability declaration into a permission grant. */
export class TomlCodexAgentEmitter implements AgentEmitter {
  private readonly props: CodexAgentEmitterProps;

  constructor(props: CodexAgentEmitterProps) {
    this.props = CodexAgentEmitterPropsSchema.parse(props);
  }

  emit(agent: AgentDefinition): string {
    const { frontmatter, body } = AgentDefinitionSchema.parse(agent);
    if (frontmatter.dispatch !== undefined || frontmatter.capabilities.some((capability) => capability === "spawn" || capability === "ask")) {
      throw new UnsupportedAgentSettingError(`${frontmatter.name}: worker orchestration needs a runtime adapter`);
    }
    if (frontmatter.sandbox !== undefined) {
      throw new UnsupportedAgentSettingError(`${frontmatter.name}: explicit filesystem/network restrictions need a runtime permission adapter`);
    }

    const settings = [
      ["name", frontmatter.name],
      ["description", frontmatter.description],
      ["model", this.props.models[frontmatter.model]],
      ["model_reasoning_effort", frontmatter.reasoning ?? this.props.reasoning[frontmatter.model]],
      ["sandbox_mode", frontmatter.capabilities.includes("edit") ? "workspace-write" : "read-only"],
      ["web_search", frontmatter.capabilities.includes("web") ? "live" : "disabled"],
      ["developer_instructions", body],
    ];
    return settings.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n") + "\n";
  }

  diagnostics(agent: AgentDefinition): string[] {
    const { frontmatter } = AgentDefinitionSchema.parse(agent);
    const diagnostics = [
      "Codex has no equivalent per-agent tool allowlist; capabilities remain instruction constraints and host permissions govern tools.",
      "The parent session can override agent sandbox defaults; evidence directories need writable access from the runtime adapter.",
    ];
    if (frontmatter["x-claude"]?.color !== undefined) diagnostics.push("Claude display color has no Codex mapping and is omitted.");
    return diagnostics;
  }
}
