import type { WorkerCapability } from "./worker-runtime-core.js";
export interface ClaudeBuiltInToolCatalog {
    toolsFor(capability: WorkerCapability): string[];
}
/** Names the Claude built-in tools that enforce a worker capability; spawn and ask have none and need an orchestration adapter. */
export declare class StandardClaudeBuiltInToolCatalog implements ClaudeBuiltInToolCatalog {
    toolsFor(capability: WorkerCapability): string[];
}
export declare const claudeBuiltInTools: ClaudeBuiltInToolCatalog;
