import { z } from "zod";
import type { Config } from "../shared/config.js";
import type { ConfigStore } from "../shared/config-store.js";
import type { CharterCatalog } from "../bundled-docs/charter-catalog/charter-catalog.js";
import type { RepositoryPaths } from "../bundled-docs/charter-catalog/repository-paths.js";
import type { EvidenceLocation } from "../tasks/evidence/evidence-location.js";
import { QaInstructionsFinder } from "../tasks/qa-instructions/qa-instructions.js";
import type { RepositoryReadiness } from "../tasks/readiness/repository-readiness.js";
import { type WorkflowEvidenceSchema } from "../tasks/readiness/readiness.schema.js";
import type { TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import type { ToolProbe } from "../tasks/tool-probe/tool-probe.js";
import type { OperationDescriptor } from "./operation-registry.js";
declare const LocalDiscoveryPropsSchema: z.ZodObject<{
    cwd: z.ZodString;
    getConfig: z.ZodCustom<() => Config, () => Config>;
    getConfigStore: z.ZodCustom<() => ConfigStore, () => ConfigStore>;
    getCharters: z.ZodCustom<() => CharterCatalog, () => CharterCatalog>;
    getRepositoryPaths: z.ZodCustom<() => RepositoryPaths, () => RepositoryPaths>;
    getEvidence: z.ZodCustom<() => EvidenceLocation, () => EvidenceLocation>;
    getReadiness: z.ZodCustom<() => RepositoryReadiness, () => RepositoryReadiness>;
    getProbe: z.ZodCustom<() => ToolProbe, () => ToolProbe>;
    getTracker: z.ZodCustom<() => TaskTracker, () => TaskTracker>;
    getConfigPath: z.ZodCustom<() => string, () => string>;
    getQaFinder: z.ZodOptional<z.ZodCustom<() => QaInstructionsFinder, () => QaInstructionsFinder>>;
}, z.core.$strip>;
export interface LocalDiscoveryOperations {
    operations(): OperationDescriptor[];
    configStore(): ConfigStore;
}
/** Shared local discovery and readiness behavior used by CLI and programmatic hosts. */
export declare class DefaultLocalDiscoveryOperations implements LocalDiscoveryOperations {
    private readonly props;
    constructor(props: z.input<typeof LocalDiscoveryPropsSchema>);
    operations(): OperationDescriptor[];
    configStore(): ConfigStore;
    private descriptor;
    private charter;
    private nextRfcId;
    private qaInstructions;
    private qaRecipe;
    private check;
    private safeConfig;
}
export declare class QaInstructionsNotFoundError extends Error {
    name: string;
}
export declare class BlankQaRecipeError extends Error {
    name: string;
}
export type LocalWorkflowEvidence = z.infer<typeof WorkflowEvidenceSchema>;
export {};
