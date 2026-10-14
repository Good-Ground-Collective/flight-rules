export {
  FileInstructionCatalog,
  instructionCatalog,
  UnknownInstructionError,
  InstructionsUnavailableError,
  UnsafeInstructionPathError,
} from "./instruction-catalog.js";
export type { InstructionCatalog, CanonicalInstruction } from "./instruction-catalog.js";
export {
  WorkerReportCodec,
  workerReportCodec,
  InvalidWorkerReportError,
  ReportModeSchema,
} from "./report-codec.js";
export type { WorkerReportParser } from "./report-codec.js";
export type { ReportMode, ValidatedWorkerReport } from "./report-codec.js";
export {
  ImplementationReportSchema,
  VerificationReportSchema,
} from "../orchestration/implementation-loop.schema.js";
export { VerifiedImplementationLoop } from "../orchestration/implementation-loop.js";
export type { ImplementationLoop } from "../orchestration/implementation-loop.js";
export type {
  HandoffRecord,
  ImplementationReport,
  ImplementationRun,
  VerificationReport,
} from "../orchestration/implementation-loop.schema.js";
export {
  RunContextSchema,
  CallerContextSchema,
  RuntimeSnapshotSchema,
  DispatchRequestSchema,
  DispatchOutcomeSchema,
  QuestionRequestSchema,
  SiblingSkillRequestSchema,
} from "../orchestration/orchestration.schema.js";
export type {
  RunContext,
  CallerContext,
  RuntimeSnapshot,
  DispatchRequest,
  DispatchOutcome,
  QuestionRequest,
  SiblingSkillRequest,
} from "../orchestration/orchestration.schema.js";

import type {
  CallerContext,
  DispatchOutcome,
  DispatchRequest,
  QuestionRequest,
  SiblingSkillRequest,
} from "../orchestration/orchestration.schema.js";

export {
  MapOperationRegistry,
  LaunchOperationAccessPolicy,
  OperationInputError,
  OperationOutputError,
  OperationAccessDeniedError,
  UnknownOperationError,
  DuplicateOperationIdError,
  OperationCliError,
} from "../operations/operation-registry.js";
export type {
  OperationDescriptor,
  OperationAccessPolicy,
  OperationHandlerResult,
  OperationSummary,
  OperationCatalog,
  OperationRegistry,
} from "../operations/operation-registry.js";
export {
  OperationEffectSchema,
  OperationIdSchema,
  CliRouteSchema,
  OperationEnvelopeSchema,
  OperationErrorSchema,
} from "../operations/operation.schema.js";
export type {
  OperationEffect,
  OperationEnvelope,
  CliRoute,
} from "../operations/operation.schema.js";
export {
  DocOperation,
  DocOperationInputSchema,
  DocOperationOutputSchema,
} from "../operations/doc-operation.js";
export {
  DefaultLocalDiscoveryOperations,
  BlankQaRecipeError,
  QaInstructionsNotFoundError,
} from "../operations/local-discovery-operations.js";
export type {
  LocalWorkflowEvidence,
  LocalDiscoveryOperations,
} from "../operations/local-discovery-operations.js";
export {
  CommanderLocalDiscoveryCli,
  CharterSelectionError,
} from "../operations/local-discovery-cli.js";
export type {
  LocalDiscoveryCommandAdapter,
  LocalDiscoveryCliProps,
} from "../operations/local-discovery-cli.js";
export {
  WorkflowSchema,
  WorkflowEvidenceSchema,
  ReadinessOptionsSchema,
} from "../tasks/readiness/readiness.schema.js";
export type {
  Workflow,
  WorkflowEvidence,
  ReadinessOptions,
  ReadinessReport,
  ReadinessCheck,
} from "../tasks/readiness/readiness.schema.js";
export {
  ManifestCliRouteCoverage,
  CliRouteCoverageError,
  cliRouteCoverage,
} from "../operations/cli-coverage.js";
export type { RouteDisposition, CliRouteCoverage } from "../operations/cli-coverage.js";
export { DefaultTrackerEntityOperations } from "../operations/tracker-entity-operations.js";
export type { TrackerEntityOperations } from "../operations/tracker-entity-operations.js";
export { DefaultTicketLifecycleOperations } from "../operations/ticket-lifecycle-operations.js";
export type { TicketLifecycleOperations } from "../operations/ticket-lifecycle-operations.js";
export { DefaultTrackerReadOperations } from "../operations/tracker-read-operations.js";
export { DefaultPrOperations } from "../operations/pr-operations.js";
export { DefaultAriadneOperations } from "../operations/ariadne-operations.js";
export type { AriadneOperations } from "../operations/ariadne-operations.js";
export { DefaultGitConfigOperations } from "../operations/git-config-operations.js";
export type { GitConfigOperations } from "../operations/git-config-operations.js";
export { DefaultReviewOperations } from "../operations/review-operations.js";
export type { ReviewOperations } from "../operations/review-operations.js";

export interface OrderedDispatch<T> {
  index: number;
  request: DispatchRequest;
  outcome: DispatchOutcome<T>;
}
export interface OrderedBatch<T> {
  results: OrderedDispatch<T>[];
}
export type HumanQuestion = QuestionRequest;
export type HumanQuestionResult =
  | { status: "answered"; requestId: string; context: CallerContext; answer: string }
  | { status: "unavailable"; requestId: string; context: CallerContext; reason: string };
export interface SiblingSkillInvocation<TReport = unknown> {
  request: SiblingSkillRequest;
  result: SkillInvocationResult<TReport>;
}
export interface OrchestrationRuntime<TReport = unknown> {
  dispatch(request: DispatchRequest): Promise<DispatchOutcome<TReport>>;
  dispatchMany(
    requests: DispatchRequest[],
    options: { maxConcurrent: number },
  ): Promise<OrderedBatch<TReport>>;
  invokeSibling(request: SiblingSkillRequest): Promise<SkillInvocationResult<TReport>>;
  askHuman(request: HumanQuestion): Promise<HumanQuestionResult>;
}
export type SkillInvocationResult<TReport = unknown> =
  | { status: "completed"; context: CallerContext; report: TReport }
  | { status: "paused"; context: CallerContext; pauseId: string; question: string }
  | { status: "failed"; context: CallerContext; reason: string };
