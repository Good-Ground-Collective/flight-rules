import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { agentFrontmatterParser } from "../agent-frontmatter/agent-frontmatter.js";
import { AgentFrontmatterSchema, AgentRegistrationSchema, ModelTierSchema, type AgentFrontmatter } from "../agent-frontmatter/agent-frontmatter.schema.js";

const AgentNameSchema = AgentFrontmatterSchema.shape.name;
const AgentVariantSchema = z.strictObject({
  name: AgentNameSchema,
  extends: AgentNameSchema,
  description: AgentFrontmatterSchema.shape.description,
  model: ModelTierSchema,
  modelReason: z.string().trim().min(1).optional(),
});
const AgentVariantsSchema = z.array(AgentVariantSchema);

export interface AgentDefinition {
  frontmatter: AgentFrontmatter;
  body: string;
}

export interface AgentRegistry {
  load(directory: string): AgentDefinition[];
}

export class InvalidAgentDefinitionError extends Error {
  override name = "InvalidAgentDefinitionError";
}

/** Named tier variants reuse a canonical prompt instead of authoring a second agent body. */
export class FileAgentRegistry implements AgentRegistry {
  load(directory: string): AgentDefinition[] {
    const agents = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const markdown = readFileSync(join(directory, entry.name), "utf8");
        const frontmatter = AgentRegistrationSchema.parse(agentFrontmatterParser.parse(markdown));
        const body = markdown.replace(/^---\r?\n[\s\S]*?^---(?:\r?\n|$)/m, "");
        if (frontmatter.name !== basename(entry.name, ".md") || body.trim() === "") {
          throw new InvalidAgentDefinitionError(`Agent ${entry.name} needs a matching name and a nonempty prompt`);
        }
        return { frontmatter, body };
      });
    const canonical = new Map(agents.map((agent) => [agent.frontmatter.name, agent]));
    const names = new Set(canonical.keys());
    const variants = AgentVariantsSchema.parse(JSON.parse(readFileSync(join(directory, "variants.json"), "utf8")));

    for (const variant of variants) {
      const base = canonical.get(variant.extends);
      if (base === undefined || names.has(variant.name)) {
        throw new InvalidAgentDefinitionError(`Variant ${variant.name} needs a unique name and canonical base ${variant.extends}`);
      }

      const { name, description, model, modelReason } = variant;
      const frontmatter = AgentRegistrationSchema.parse({
        ...base.frontmatter,
        name,
        description,
        model,
        modelReason,
      });
      agents.push({ frontmatter, body: base.body });
      names.add(variant.name);
    }

    return agents.sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));
  }
}
