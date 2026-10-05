import { type AgentFrontmatter } from "./agent-frontmatter.schema.js";
export interface AgentFrontmatterParser {
    parse(markdown: string): AgentFrontmatter;
}
export declare class MissingFrontmatterError extends Error {
    name: string;
}
/** Repo-wide agent drift checks accompany the Claude emitter so native definitions remain usable. */
export declare class YamlAgentFrontmatterParser implements AgentFrontmatterParser {
    parse(markdown: string): AgentFrontmatter;
}
export declare const agentFrontmatterParser: AgentFrontmatterParser;
