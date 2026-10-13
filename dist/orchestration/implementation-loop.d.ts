import { type HandoffRecord, type ImplementationRun, type VerificationReport } from "./implementation-loop.schema.js";
import type { DispatchRequest, OrchestrationFailure } from "./orchestration.schema.js";
export type StoppedImplementation = {
    status: "stopped";
    failure: OrchestrationFailure;
};
export type ImplementationDecision = {
    status: "implement";
    request: DispatchRequest;
    filesChanged: string[];
} | {
    status: "verified";
    report: VerificationReport;
    filesChanged: string[];
} | StoppedImplementation;
export type VerificationDecision = {
    status: "verify";
    request: DispatchRequest;
} | StoppedImplementation;
export interface ImplementationLoop {
    next(run: ImplementationRun): ImplementationDecision;
    verify(run: ImplementationRun, implementation: HandoffRecord): VerificationDecision;
}
/** Derives retries from paired, context-bound reports; worker failures never count as verifier FAILs. */
export declare class VerifiedImplementationLoop implements ImplementationLoop {
    private readonly reports;
    next(run: ImplementationRun): ImplementationDecision;
    verify(run: ImplementationRun, implementation: HandoffRecord): VerificationDecision;
    private implementationRequest;
    private verificationRequest;
    private readReport;
    private openQuestions;
}
