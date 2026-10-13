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
