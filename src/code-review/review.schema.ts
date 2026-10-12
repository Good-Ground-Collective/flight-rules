import { z } from "zod";

/** The v1 wire contract is shared with Actions; snake_case is intentionally preserved at this boundary. */
export const reviewContractVersion = 1;
export const reviewSchemaRevision = 1;
export const ReviewOutcomeSchema = z.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]);
export const FindingIdSchema = z.string().regex(/^f-[a-f0-9]{10}$/);
export const HeadShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const ReviewPathSchema = z
  .string()
  .max(400)
  .regex(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\p{Cc}]*$/u);
const TextSchema = z.string().min(1).max(16000);
const LineTextSchema = z
  .string()
  .min(1)
  .max(400)
  .regex(/^[^\r\n]+$/);
const PositiveIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const HttpsUrlSchema = z.url().regex(/^https:\/\//);
const CategorySchema = z.enum([
  "security",
  "correctness",
  "data",
  "deployment",
  "design",
  "testing",
  "performance",
  "readability",
  "docs",
]);
const ActionLabelSchema = z.enum([
  "issue",
  "todo",
  "suggestion",
  "question",
  "chore",
  "nitpick",
  "typo",
  "polish",
]);
const InformationLabelSchema = z.enum(["praise", "note", "thought"]);
const SeveritySchema = z.enum(["critical", "major", "minor", "trivial"]);
const DecisionOptionsSchema = z
  .array(
    z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), description: TextSchema }),
  )
  .min(2);
const findingFields = {
  path: ReviewPathSchema,
  line: z.number().int().nonnegative(),
  start_line: z.number().int().positive().optional(),
  category: CategorySchema.optional(),
  subject: LineTextSchema,
  discussion: TextSchema,
  related_finding_id: FindingIdSchema.optional(),
};
const actionFields = {
  ...findingFields,
  label: ActionLabelSchema,
  type: z.enum(["fix", "clarify"]),
  blocking: z.boolean(),
  severity: SeveritySchema,
  details: TextSchema,
  resolved_when: TextSchema,
};
const decisionFields = {
  ...actionFields,
  type: z.literal("decide"),
  decision_owner: LineTextSchema,
  decision_options: DecisionOptionsSchema,
};
const informationFields = {
  ...findingFields,
  label: InformationLabelSchema,
  blocking: z.literal(false),
  details: TextSchema.optional(),
};
export const NewFindingSchema = z.union([
  z.strictObject(actionFields),
  z.strictObject(decisionFields),
  z.strictObject(informationFields),
]);
export const ActionableFindingSchema = z.union([
  z.strictObject({ ...actionFields, id: FindingIdSchema }),
  z.strictObject({ ...decisionFields, id: FindingIdSchema }),
]);
export const StoredFindingSchema = z.union([
  ...ActionableFindingSchema.options,
  z.strictObject({ ...informationFields, id: FindingIdSchema }),
]);
export const ReviewEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("github_comment"),
    comment_id: PositiveIdSchema,
    url: HttpsUrlSchema,
  }),
  z.strictObject({
    kind: z.literal("code"),
    commit_sha: HeadShaSchema,
    path: ReviewPathSchema.min(1),
    line: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal("commit"), sha: HeadShaSchema }),
  z.strictObject({
    kind: z.literal("check_run"),
    check_run_id: PositiveIdSchema,
    commit_sha: HeadShaSchema,
  }),
  z.strictObject({ kind: z.literal("document"), url: HttpsUrlSchema }),
  z.strictObject({
    kind: z.literal("verification"),
    commit_sha: HeadShaSchema,
    command: TextSchema,
    result: z.literal("passed"),
    report_url: HttpsUrlSchema,
  }),
  z.strictObject({
    kind: z.literal("thread_resolution"),
    thread_id: z.string().min(1),
    author_id: PositiveIdSchema,
  }),
]);
export const DecisionAnswerSchema = z.strictObject({
  comment_id: PositiveIdSchema,
  author_id: PositiveIdSchema,
  option_id: z.string().min(1),
});
const transitionFields = {
  id: FindingIdSchema,
  reason: TextSchema,
  reply: TextSchema.optional(),
  decision: DecisionAnswerSchema.optional(),
};
export const PriorFindingSchema = z.union([
  z.strictObject({
    ...transitionFields,
    status: z.literal("resolved"),
    evidence: z.array(ReviewEvidenceSchema).min(1),
  }),
  z.strictObject({
    ...transitionFields,
    status: z.literal("withdrawn"),
    evidence: z.array(ReviewEvidenceSchema).min(1),
    withdrawal_basis: z.enum(["incorrect", "no_longer_applicable", "dismissed"]),
  }),
  z.strictObject({
    ...transitionFields,
    status: z.literal("still_open"),
    evidence: z.array(ReviewEvidenceSchema).optional(),
    updated_finding: ActionableFindingSchema.optional(),
  }),
]);
const reviewFields = {
  contract_version: z.literal(reviewContractVersion),
  schema_revision: z.literal(reviewSchemaRevision),
  head_sha: HeadShaSchema,
  review_complete: z.boolean(),
  incomplete_reason: z.string().max(16000).optional(),
  summary: TextSchema,
  outcome: ReviewOutcomeSchema,
  outcome_reason: TextSchema,
  remaining_risk: TextSchema,
  extensions: z.record(z.string(), z.json()).optional(),
};
export const ReviewSchema = z.strictObject({
  ...reviewFields,
  findings: z.array(NewFindingSchema),
  prior_findings: z.array(PriorFindingSchema),
});
export const FindingRecordSchema = z.strictObject({
  v: z.literal(reviewContractVersion),
  schema_revision: z.literal(reviewSchemaRevision),
  finding: ActionableFindingSchema,
  status: z.enum(["open", "resolved", "withdrawn"]),
  evidence: z.array(ReviewEvidenceSchema),
  decision: DecisionAnswerSchema.optional(),
});
export const ReviewStateSchema = z.strictObject({
  v: z.literal(reviewContractVersion),
  schema_revision: z.literal(reviewSchemaRevision),
  sha: HeadShaSchema,
  outcome: ReviewOutcomeSchema,
  records: z.array(
    z.union([
      z.strictObject({
        id: FindingIdSchema,
        status: z.enum(["open", "resolved", "withdrawn"]),
        location: z.union([
          z.strictObject({ kind: z.literal("review_comment"), comment_id: PositiveIdSchema }),
          z.strictObject({ kind: z.literal("review_body"), review_id: PositiveIdSchema }),
        ]),
      }),
      z.strictObject({
        id: FindingIdSchema,
        status: z.literal("informational"),
        fingerprint: z.string().min(1),
        finding: z.strictObject({ ...informationFields, id: FindingIdSchema }).optional(),
      }),
    ]),
  ),
});

/** A model-facing superset; the full schema and planner validate variants before any writes. */
export const TransportReviewSchema = z.strictObject({
  ...reviewFields,
  findings: z.array(
    z.strictObject({
      ...actionFields,
      type: z.enum(["fix", "clarify", "decide"]).optional(),
      label: z.enum([...ActionLabelSchema.options, ...InformationLabelSchema.options]),
      severity: SeveritySchema.optional(),
      details: TextSchema.optional(),
      resolved_when: TextSchema.optional(),
      decision_owner: LineTextSchema.optional(),
      decision_options: DecisionOptionsSchema.optional(),
    }),
  ),
  prior_findings: z.array(
    z.strictObject({
      ...transitionFields,
      status: z.enum(["resolved", "still_open", "withdrawn"]),
      evidence: z.array(ReviewEvidenceSchema).optional(),
      withdrawal_basis: z.enum(["incorrect", "no_longer_applicable", "dismissed"]).optional(),
      updated_finding: StoredFindingSchema.optional(),
    }),
  ),
});
export type Review = z.infer<typeof ReviewSchema>;
export type NewFinding = z.infer<typeof NewFindingSchema>;
export type ActionableFinding = z.infer<typeof ActionableFindingSchema>;
export type StoredFinding = z.infer<typeof StoredFindingSchema>;
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;
export type FindingRecord = z.infer<typeof FindingRecordSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;
export type PriorFinding = z.infer<typeof PriorFindingSchema>;
