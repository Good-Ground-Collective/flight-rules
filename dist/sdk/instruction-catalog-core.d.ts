import { z } from "zod";
import { type AgentDefinition } from "../agents/agent-registry/agent-registry.js";
declare const CatalogPropsSchema: z.ZodObject<{
    moduleUrl: z.ZodString;
    env: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
}, z.core.$strict>;
export interface CanonicalInstruction {
    name: string;
    path: string;
    contents: string;
}
export interface InstructionCatalog {
    listSkills(): string[];
    loadSkill(name: string): CanonicalInstruction;
    listAgents(): string[];
    loadAgent(name: string): AgentDefinition;
}
export declare class UnknownInstructionError extends Error {
    name: string;
}
export declare class InstructionsUnavailableError extends Error {
    name: string;
}
export declare class UnsafeInstructionPathError extends Error {
    name: string;
}
/** Loads canonical worker prompts and skills from the installed package, independent of cwd. */
export declare class FileInstructionCatalog implements InstructionCatalog {
    private readonly skillDir;
    private readonly agentDir;
    private readonly agents;
    constructor(props: z.input<typeof CatalogPropsSchema>);
    listSkills(): string[];
    loadSkill(name: string): CanonicalInstruction;
    listAgents(): string[];
    loadAgent(name: string): AgentDefinition;
    private findResourceDirectory;
    private safePath;
}
export {};
