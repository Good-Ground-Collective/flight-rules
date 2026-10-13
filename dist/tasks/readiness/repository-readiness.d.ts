import { z } from "zod";
import { type Config } from "../../shared/config.js";
import type { TaskTracker } from "../task-tracker/task-tracker.js";
import type { ToolProbe } from "../tool-probe/tool-probe.js";
import type { QaDiscoverInput, QaInstructions } from "../qa-instructions/qa-instructions.js";
import { type ReadinessOptions, type ReadinessReport } from "./readiness.schema.js";
declare const RepositoryReadinessPropsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>>;
    timeoutMs: z.ZodDefault<z.ZodInt>;
}, z.core.$strip>;
export interface ReadinessInputs {
    config(): Config;
    tracker(): TaskTracker;
    configPath(): string;
    probe: ToolProbe;
    finder: {
        discover(input: QaDiscoverInput): QaInstructions;
    };
    options?: ReadinessOptions;
}
export interface RepositoryReadiness {
    inspect(input: ReadinessInputs): Promise<ReadinessReport>;
}
/** Combines existing environment checks with optional workflow evidence while preserving checks/ok consumers. */
export declare class NodeRepositoryReadiness implements RepositoryReadiness {
    private readonly cwd;
    private readonly env;
    private readonly timeoutMs;
    constructor(props?: z.input<typeof RepositoryReadinessPropsSchema>);
    inspect(input: ReadinessInputs): Promise<ReadinessReport>;
    private missingCredentials;
}
export {};
