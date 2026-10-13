import { z } from "zod";
import {
  DispatchRequestSchema,
  OrchestrationTextSchema,
  RunContextSchema,
} from "./orchestration.schema.js";

export const ImplementationReportSchema = z.strictObject({
  summary: OrchestrationTextSchema,
  filesChanged: z.array(
    z.strictObject({ path: OrchestrationTextSchema, why: OrchestrationTextSchema }),
  ),
  testsRun: z.array(
    z.strictObject({ command: OrchestrationTextSchema, result: OrchestrationTextSchema }),
  ),
  approach: OrchestrationTextSchema,
  openQuestions: z.array(OrchestrationTextSchema).optional(),
});
export const CriterionResultSchema = z.strictObject({
  criterion: OrchestrationTextSchema,
  verdict: z.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
  evidence: OrchestrationTextSchema,
});
export const VerificationReportSchema = z
  .strictObject({
    summary: OrchestrationTextSchema,
    criteria: z.array(CriterionResultSchema).min(1),
    charterConcerns: z.array(OrchestrationTextSchema).optional(),
    openQuestions: z.array(OrchestrationTextSchema).optional(),
    verified: z.boolean(),
  })
  .refine(
    (report) =>
      report.verified === report.criteria.every((criterion) => criterion.verdict === "PASS"),
    "verified must agree with every itemized verdict",
  );
export const HandoffRecordSchema = z.strictObject({
  request: DispatchRequestSchema,
  outcome: z.unknown(),
});
export const ImplementationRunSchema = z.strictObject({
  context: RunContextSchema,
  criteria: z
    .array(OrchestrationTextSchema)
    .min(1)
    .refine((criteria) => new Set(criteria).size === criteria.length, "criteria must be distinct"),
  implementationInput: z
    .record(z.string(), z.json())
    .refine(
      (input) => !Object.hasOwn(input, "verifierFailures"),
      "verifierFailures is reserved for validated retry evidence",
    ),
  history: z
    .array(
      z.strictObject({ implementation: HandoffRecordSchema, verification: HandoffRecordSchema }),
    )
    .max(3),
});

export type ImplementationReport = z.infer<typeof ImplementationReportSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type HandoffRecord = z.infer<typeof HandoffRecordSchema>;
export type ImplementationRun = z.infer<typeof ImplementationRunSchema>;
