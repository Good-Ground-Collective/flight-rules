import { z } from "zod";
import { OrchestrationTextSchema } from "./orchestration.schema.js";

const FindingDispositionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    id: OrchestrationTextSchema,
    disposition: z.literal("fix"),
    evidence: OrchestrationTextSchema,
    criterion: OrchestrationTextSchema,
  }),
  z.strictObject({
    id: OrchestrationTextSchema,
    disposition: z.literal("ignore"),
    evidence: OrchestrationTextSchema,
  }),
  z.strictObject({
    id: OrchestrationTextSchema,
    disposition: z.literal("needs_input"),
    evidence: OrchestrationTextSchema,
    question: OrchestrationTextSchema,
  }),
]);

export const ReviewTriageReportSchema = z
  .strictObject({
    summary: OrchestrationTextSchema,
    headSha: z.string().regex(/^[a-f0-9]{40}$/),
    findings: z
      .array(FindingDispositionSchema)
      .refine(
        (findings) => new Set(findings.map((finding) => finding.id)).size === findings.length,
        "Each finding must have exactly one disposition",
      ),
    openQuestions: z.array(OrchestrationTextSchema).optional(),
  })
  .refine(
    (report) =>
      report.findings.every(
        (finding) =>
          finding.disposition !== "needs_input" || report.openQuestions?.includes(finding.question),
      ),
    "Every needs_input question must also appear in openQuestions",
  );

export type ReviewTriageReport = z.infer<typeof ReviewTriageReportSchema>;
