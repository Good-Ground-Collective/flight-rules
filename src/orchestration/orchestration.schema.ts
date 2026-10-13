import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import { AgentFrontmatterSchema } from "../agents/agent-frontmatter/agent-frontmatter.schema.js";

export const OrchestrationTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be blank");
const AbsolutePathSchema = OrchestrationTextSchema.refine(
  isAbsolute,
  "must be an absolute path on this host",
);
const CapabilityNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9:.-]*$/);
const RunContextObjectSchema = z.strictObject({
  runId: OrchestrationTextSchema,
  taskId: OrchestrationTextSchema,
  cwd: AbsolutePathSchema,
  repositoryRoot: AbsolutePathSchema,
  baseRef: OrchestrationTextSchema,
  skill: OrchestrationTextSchema,
});

/** Context identifies the active checkout, including a linked worktree, rather than a user's main checkout. */
export const RunContextSchema = RunContextObjectSchema.refine((value) => {
  const path = relative(value.repositoryRoot, value.cwd);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}, "working directory must be inside the active repository root");
export const CallerContextSchema = RunContextSchema.safeExtend({ attempt: z.int().positive() });

/** Evidence describes observed access; parsing it cannot authenticate the observation or grant access. */
export const CapabilityEvidenceSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), evidence: OrchestrationTextSchema }),
  z.strictObject({
    state: z.enum(["denied", "unknown"]),
    evidence: OrchestrationTextSchema,
    remedy: OrchestrationTextSchema,
  }),
]);
export const AdapterLimitsSchema = z.strictObject({
  maxConcurrent: z.int().nonnegative().nullable(),
  activeWorkers: z.int().nonnegative(),
  currentDepth: z.int().nonnegative(),
  maxDepth: z.int().nonnegative().nullable(),
  source: OrchestrationTextSchema,
});
export const RuntimeSnapshotSchema = z.strictObject({
  context: CallerContextSchema,
  host: z.strictObject({ name: OrchestrationTextSchema, version: OrchestrationTextSchema }),
  observedAt: z.iso.datetime(),
  agent: AgentFrontmatterSchema.shape.name.nullable(),
  spawn: CapabilityEvidenceSchema,
  ask: CapabilityEvidenceSchema,
  permissions: z.record(CapabilityNameSchema, CapabilityEvidenceSchema),
  limits: AdapterLimitsSchema,
});
export const DispatchRequestSchema = z.strictObject({
  id: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema,
  input: z.record(z.string(), z.json()),
  requiredCapabilities: z.array(CapabilityNameSchema).optional(),
});
export const OrchestrationFailureSchema = z.strictObject({
  code: z.enum([
    "UNKNOWN_AGENT",
    "UNSUPPORTED_AGENT_SETTINGS",
    "CONTEXT_MISMATCH",
    "CAPABILITY_DENIED",
    "CAPABILITY_UNKNOWN",
    "DISPATCH_UNAVAILABLE",
    "LIMITS_UNKNOWN",
    "CAPACITY_EXHAUSTED",
    "DEPTH_EXCEEDED",
    "QUESTIONS_DISABLED",
    "QUESTIONS_UNAVAILABLE",
    "INVALID_HANDOFF",
    "INVALID_REPORT",
    "INVALID_HISTORY",
    "OPEN_QUESTIONS",
    "UNVERIFIABLE",
    "ATTEMPTS_EXHAUSTED",
    "EXECUTION_FAILED",
    "CANCELLED",
  ]),
  message: OrchestrationTextSchema,
  remedy: OrchestrationTextSchema,
  capability: CapabilityNameSchema.optional(),
});
const OutcomeIdentitySchema = z.strictObject({
  dispatchId: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema,
});
export const DispatchOutcomeSchema = z.discriminatedUnion("status", [
  OutcomeIdentitySchema.extend({
    status: z.literal("completed"),
    report: z.record(z.string(), z.json()),
  }),
  OutcomeIdentitySchema.extend({
    status: z.enum(["failed", "unavailable"]),
    failure: OrchestrationFailureSchema,
  }),
]);
export const QuestionRequestSchema = z.strictObject({
  context: CallerContextSchema,
  question: OrchestrationTextSchema,
  allowHumanQuestions: z.boolean(),
});
export const SiblingSkillRequestSchema = z.strictObject({
  context: CallerContextSchema,
  skill: OrchestrationTextSchema,
  input: z.record(z.string(), z.json()),
});

export type RunContext = z.infer<typeof RunContextSchema>;
export type CallerContext = z.infer<typeof CallerContextSchema>;
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;
export type AdapterLimits = z.infer<typeof AdapterLimitsSchema>;
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;
export type OrchestrationFailure = z.infer<typeof OrchestrationFailureSchema>;
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;
export type SiblingSkillRequest = z.infer<typeof SiblingSkillRequestSchema>;
export type DispatchOutcome<T> =
  | { status: "completed"; dispatchId: string; agent: string; context: CallerContext; report: T }
  | {
      status: "failed" | "unavailable";
      dispatchId: string;
      agent: string;
      context: CallerContext;
      failure: OrchestrationFailure;
    };
