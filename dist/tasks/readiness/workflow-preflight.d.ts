import { z } from "zod";
import { type ReadinessCheck, type Workflow, type WorkflowEvidence } from "./readiness.schema.js";
declare const WorkflowPreflightPropsSchema: z.ZodObject<{
    cwd: z.ZodString;
    env: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
    timeoutMs: z.ZodDefault<z.ZodInt>;
}, z.core.$strip>;
export interface WorkflowPreflight {
    inspect(workflow: Workflow, evidence?: WorkflowEvidence): Promise<ReadinessCheck[]>;
}
/** Read-only observations supplement explicit host evidence; no probe attempts the workflow's mutations. */
export declare class NodeWorkflowPreflight implements WorkflowPreflight {
    private readonly cwd;
    private readonly env;
    private readonly timeoutMs;
    constructor(props: z.input<typeof WorkflowPreflightPropsSchema>);
    inspect(workflow: Workflow, evidence?: WorkflowEvidence): Promise<ReadinessCheck[]>;
    private command;
    private remoteRead;
    private checkoutContext;
    private localWrite;
    private gitWrite;
}
export {};
