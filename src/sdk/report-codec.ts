import { z } from "zod";
import { parse as parseYaml } from "yaml";
import {
  ImplementationReportSchema,
  VerificationReportSchema,
} from "../orchestration/implementation-loop.schema.js";
import { OrchestrationTextSchema } from "../orchestration/orchestration.schema.js";

const reportText = OrchestrationTextSchema;
const JsonReportValueSchema = z.json();
const InternalResearchSchema = z.strictObject({
  files: z.array(z.strictObject({ path: reportText, why: reportText })),
  patterns: z.array(reportText),
  integrationPoints: z.array(reportText),
  risks: z.array(reportText),
});
const ExternalResearchSchema = z.strictObject({
  answer: reportText,
  sources: z.array(z.strictObject({ url: z.url(), title: reportText })),
  exampleUsage: reportText.nullable(),
  caveats: z.array(reportText),
});
const ResearchReportSchema = z.strictObject({
  summary: reportText,
  confidence: z.enum(["low", "med", "high"]),
  internal: InternalResearchSchema.optional(),
  external: ExternalResearchSchema.optional(),
});
const EvidenceSchema = z.strictObject({
  dir: reportText,
  items: z.array(
    z.strictObject({
      path: reportText,
      kind: z.enum(["image", "video", "text"]),
      phase: z.enum(["before", "after"]),
      caption: reportText,
    }),
  ),
});
const QaReproduceSchema = z.discriminatedUnion("reproduced", [
  z.strictObject({
    summary: reportText,
    reproduced: z.literal(true),
    needs: z.array(reportText).optional(),
    steps: z.array(reportText),
    after: z.array(reportText),
    rootCause: reportText,
    trapForQA: reportText,
    fixedWhen: z.array(reportText),
    evidence: EvidenceSchema,
    openQuestions: z.array(reportText).optional(),
  }),
  z.strictObject({
    summary: reportText,
    reproduced: z.literal(false),
    reason: reportText,
    needs: z.array(reportText).optional(),
    evidence: EvidenceSchema,
    openQuestions: z.array(reportText).optional(),
  }),
]);
const QaVerifySchema = z
  .strictObject({
    summary: reportText,
    items: z.array(
      z.strictObject({
        item: reportText,
        verdict: z.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
        evidence: reportText,
      }),
    ),
    evidence: EvidenceSchema,
    verified: z.boolean(),
    needs: z.array(reportText).optional(),
    openQuestions: z.array(reportText).optional(),
  })
  .refine(
    (report) => report.verified === report.items.every((item) => item.verdict === "PASS"),
    "verified must agree with every item verdict",
  );
const WriterFindingSchema = z.strictObject({
  excerpt: reportText,
  location: reportText,
  mandate: reportText,
  problem: reportText,
  suggestion: reportText,
});
const WriterFeedbackSchema = z.strictObject({
  summary: reportText,
  verdict: z.enum(["CLEAN", "MINOR", "HEAVY"]),
  findings: z.array(WriterFindingSchema),
  strengths: z.array(reportText),
  openQuestions: z.array(reportText).optional(),
});
const WriterChangeSchema = z.strictObject({
  before: reportText,
  after: reportText,
  mandate: reportText,
  why: reportText,
});
const WriterRewriteSchema = z.strictObject({
  summary: reportText,
  verdict: z.enum(["CLEAN", "MINOR", "HEAVY"]),
  changes: z.array(WriterChangeSchema).optional(),
  rewritten: reportText.optional(),
  preserved: z.array(reportText),
  openQuestions: z.array(reportText).optional(),
}).refine(
  (report) => (report.changes === undefined) !== (report.rewritten === undefined),
  "rewrite reports must contain either file changes or inline rewritten text",
);
const WriterAuthorSchema = z.strictObject({
  summary: reportText,
  whatWasChanged: z.array(reportText.max(256)).min(1).max(5),
  whyWasItChanged: reportText,
  otsMaterials: reportText,
  openQuestions: z.array(reportText).optional(),
});

export const ReportModeSchema = z.union([
  z.strictObject({ agent: z.literal("code-implementation"), mode: z.literal("implement") }),
  z.strictObject({
    agent: z.literal("code-implementation-escalated"),
    mode: z.literal("implement"),
  }),
  z.strictObject({ agent: z.literal("code-verifier"), mode: z.literal("verify") }),
  z.strictObject({
    agent: z.literal("research-agent"),
    mode: z.enum(["internal", "external", "mixed"]),
  }),
  z.strictObject({ agent: z.literal("qa-engineer"), mode: z.literal("reproduce") }),
  z.strictObject({ agent: z.literal("qa-engineer"), mode: z.literal("verify") }),
  z.strictObject({ agent: z.literal("qa-engineer-verify"), mode: z.literal("verify") }),
  z.strictObject({ agent: z.literal("tech-writer"), mode: z.literal("feedback") }),
  z.strictObject({ agent: z.literal("tech-writer"), mode: z.literal("rewrite") }),
  z.strictObject({ agent: z.literal("tech-writer"), mode: z.literal("author") }),
]);
export type ReportMode = z.infer<typeof ReportModeSchema>;
export type ValidatedWorkerReport =
  | z.infer<typeof ImplementationReportSchema>
  | z.infer<typeof VerificationReportSchema>
  | z.infer<typeof ResearchReportSchema>
  | z.infer<typeof QaReproduceSchema>
  | z.infer<typeof QaVerifySchema>
  | z.infer<typeof WriterFeedbackSchema>
  | z.infer<typeof WriterRewriteSchema>
  | z.infer<typeof WriterAuthorSchema>;
export class InvalidWorkerReportError extends Error {
  override name = "InvalidWorkerReportError";
}

export interface WorkerReportParser {
  parse(input: string, requested: ReportMode): ValidatedWorkerReport;
}

/** Validates the worker's final YAML report against the registration's requested report shape. */
export class WorkerReportCodec implements WorkerReportParser {
  parse(input: string, requested: ReportMode): ValidatedWorkerReport {
    let mode: ReportMode;
    try {
      mode = ReportModeSchema.parse(requested);
    } catch (cause) {
      throw new InvalidWorkerReportError(cause instanceof Error ? cause.message : String(cause));
    }

    const report = this.pipelineFor(mode).safeParse(input);
    if (!report.success) throw new InvalidWorkerReportError(report.error.message);
    return report.data;
  }

  private pipelineFor(mode: ReportMode): z.ZodType<ValidatedWorkerReport, string> {
    return z
      .string()
      .transform((input, context) => {
        const blocks = [...input.matchAll(/```yaml\s*\r?\n([\s\S]*?)\r?\n```/gi)];
        const block = blocks.at(0);
        const before = block === undefined ? "" : input.slice(0, block.index);
        const after = block === undefined ? input : input.slice(block.index + block[0].length);

        if (
          blocks.length !== 1 ||
          block === undefined ||
          after.trim() !== "" ||
          (before.trim() !== "" && mode.agent !== "research-agent") ||
          before.includes("```")
        ) {
          context.addIssue({
            code: "custom",
            message: "Return one final fenced YAML report; only research reports may have prose before it",
          });
          return z.NEVER;
        }

        return block[1] ?? "";
      })
      .transform((yaml, context) => {
        try {
          return parseYaml(yaml);
        } catch (cause) {
          context.addIssue({
            code: "custom",
            message: `Malformed YAML report: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
          return z.NEVER;
        }
      })
      .pipe(JsonReportValueSchema)
      .pipe(z.preprocess((report) => report, this.schemaFor(mode)));
  }

  private schemaFor(mode: ReportMode): z.ZodType<ValidatedWorkerReport> {
    if (mode.agent === "code-implementation" || mode.agent === "code-implementation-escalated")
      return ImplementationReportSchema;
    if (mode.agent === "code-verifier") return VerificationReportSchema;
    if (mode.agent === "research-agent")
      return ResearchReportSchema.refine(
        (report) =>
          (mode.mode === "external" || report.internal !== undefined) &&
          (mode.mode === "internal" || report.external !== undefined),
        `research report must include the ${mode.mode} findings slots`,
      );
    if (mode.agent === "qa-engineer" || mode.agent === "qa-engineer-verify")
      return mode.mode === "reproduce" ? QaReproduceSchema : QaVerifySchema;
    if (mode.mode === "feedback") return WriterFeedbackSchema;
    if (mode.mode === "rewrite") return WriterRewriteSchema;
    return WriterAuthorSchema;
  }
}

export const workerReportCodec: WorkerReportParser = new WorkerReportCodec();
