import { z } from "zod";
import { AgentRegistrationSchema } from "../../agents/agent-frontmatter/agent-frontmatter.schema.js";
import {
  CallerContextSchema,
  CapabilityEvidenceSchema,
  RuntimeSnapshotSchema,
} from "../../orchestration/orchestration.schema.js";

export const WorkflowSchema = z.enum([
  "execute-work",
  "execute-wave",
  "break-down-work",
  "reproduce-bug",
  "verify-ticket",
]);
export const WorkflowEvidenceSchema = z.strictObject({
  context: CallerContextSchema,
  callerCapabilities: z.record(z.string(), CapabilityEvidenceSchema),
  workers: z
    .array(
      z.strictObject({ registration: AgentRegistrationSchema, runtime: RuntimeSnapshotSchema }),
    )
    .refine(
      (workers) =>
        new Set(workers.map((worker) => worker.registration.name)).size === workers.length,
      "duplicate worker evidence",
    ),
});
export const ReadinessOptionsSchema = z
  .strictObject({
    workflow: WorkflowSchema.optional(),
    evidence: WorkflowEvidenceSchema.optional(),
  })
  .refine(
    (value) => value.evidence === undefined || value.workflow !== undefined,
    "workflow is required with capability evidence",
  );
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowEvidence = z.infer<typeof WorkflowEvidenceSchema>;
export type ReadinessOptions = z.infer<typeof ReadinessOptionsSchema>;
export type ReadinessCheck = {
  name: string;
  ok: boolean;
  detail: string;
  required?: boolean;
  code?: string | undefined;
  remedy?: string | undefined;
};
export type ReadinessReport = {
  tracker: string | null;
  repo: string | null | undefined;
  checks: ReadinessCheck[];
  ok: boolean;
  workflow?: Workflow;
  scope: "environment" | "workflow";
};
