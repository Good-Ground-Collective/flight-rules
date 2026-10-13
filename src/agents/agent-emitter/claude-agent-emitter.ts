import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { AgentFrontmatter } from "../agent-frontmatter/agent-frontmatter.schema.js";
import type { AgentDefinition } from "../agent-registry/agent-registry.js";
import { type AgentEmitter, UnsupportedAgentSettingError } from "./agent-emitter.js";
import { AgentDefinitionSchema, ModelBindingsSchema } from "./agent-emitter.schema.js";

const ClaudeAgentEmitterPropsSchema = z.strictObject({ models: ModelBindingsSchema });
type ClaudeAgentEmitterProps = z.infer<typeof ClaudeAgentEmitterPropsSchema>;

/** Host bindings are separate from canonical prompts and do not silently weaken execution restrictions. */
export class MarkdownClaudeAgentEmitter implements AgentEmitter {
  private readonly models: z.infer<typeof ModelBindingsSchema>;

  constructor(props: ClaudeAgentEmitterProps) {
    this.models = ClaudeAgentEmitterPropsSchema.parse(props).models;
  }

  emit(agent: AgentDefinition): string {
    const { frontmatter, body } = AgentDefinitionSchema.parse(agent);
    if (frontmatter.sandbox !== undefined || frontmatter.dispatch !== undefined) {
      throw new UnsupportedAgentSettingError(`${frontmatter.name}: sandbox and dispatch restrictions need a runtime adapter`);
    }

    const native = {
      name: frontmatter.name,
      description: frontmatter.description,
      tools: frontmatter.capabilities.flatMap((capability) => this.tools(capability)).join(", "),
      model: this.models[frontmatter.model],
      ...(frontmatter.reasoning === undefined ? {} : { effort: frontmatter.reasoning }),
      ...(frontmatter["x-claude"]?.color === undefined ? {} : { color: frontmatter["x-claude"].color }),
    };
    return `---\n${stringifyYaml(native, { lineWidth: 0 })}---\n${body}`;
  }

  private tools(capability: AgentFrontmatter["capabilities"][number]): string[] {
    if (capability === "read") return ["Glob", "Grep", "Read"];
    if (capability === "edit") return ["Write", "Edit"];
    if (capability === "shell") return ["Bash"];
    if (capability === "web") return ["WebSearch", "WebFetch"];

    throw new UnsupportedAgentSettingError(`Worker agent capability ${capability} needs an orchestration adapter`);
  }
}
