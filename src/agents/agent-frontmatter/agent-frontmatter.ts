import { parse as parseYaml } from "yaml";
import { AgentFrontmatterSchema, type AgentFrontmatter } from "./agent-frontmatter.schema.js";

export interface AgentFrontmatterParser {
  parse(markdown: string): AgentFrontmatter;
}

export class MissingFrontmatterError extends Error {
  override name = "MissingFrontmatterError";
}

/** Repo-wide agent drift checks accompany the Claude emitter so native definitions remain usable. */
export class YamlAgentFrontmatterParser implements AgentFrontmatterParser {
  parse(markdown: string): AgentFrontmatter {
    const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(markdown);
    if (match === null || match.index !== 0 || match[1] === undefined) {
      throw new MissingFrontmatterError("agent file has no leading --- frontmatter block");
    }

    const raw: unknown = parseYaml(match[1]);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new MissingFrontmatterError("frontmatter is not a YAML mapping");
    }

    return AgentFrontmatterSchema.parse(raw);
  }
}

export const agentFrontmatterParser: AgentFrontmatterParser = new YamlAgentFrontmatterParser();
