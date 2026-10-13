import { type AgentFrontmatter } from "../agent-frontmatter/agent-frontmatter.schema.js";
export interface AgentDefinition {
    frontmatter: AgentFrontmatter;
    body: string;
}
export interface AgentRegistry {
    load(directory: string): AgentDefinition[];
}
export declare class InvalidAgentDefinitionError extends Error {
    name: string;
}
/** Named tier variants reuse a canonical prompt instead of authoring a second agent body. */
export declare class FileAgentRegistry implements AgentRegistry {
    load(directory: string): AgentDefinition[];
}
