import { z } from "zod";
import type { ActionableFinding, DecisionAnswer, FindingRecord, Review, ReviewEvidence, ReviewOutcome, StoredFinding } from "./review.schema.js";
export interface ReviewVerifier {
    verify(evidence: ReviewEvidence, headSha: string): Promise<boolean>;
    authorize(answer: DecisionAnswer, finding: ActionableFinding): Promise<boolean>;
    dismissal(evidence: ReviewEvidence): Promise<boolean>;
}
export interface ReviewPlan {
    review: Review;
    records: FindingRecord[];
    informational: StoredFinding[];
    outcome: ReviewOutcome;
    problems: string[];
}
export interface ReviewPlannerProps {
    verifier: ReviewVerifier;
}
export interface ReviewPlanner {
    plan(input: {
        review: unknown;
        records: unknown[];
        headSha: string;
    }): Promise<ReviewPlan>;
}
/** Applies only evidence-checked transitions; caller adapters persist the plan before approving. */
export declare class EvidenceReviewPlanner implements ReviewPlanner {
    private readonly verifier;
    constructor(props: ReviewPlannerProps);
    plan(input: {
        review: unknown;
        records: unknown[];
        headSha: string;
    }): Promise<ReviewPlan>;
    private newId;
    private outcome;
}
declare const ValidatedEvidencePropsSchema: z.ZodObject<{
    verified: z.ZodArray<z.ZodString>;
    authorizedDecisions: z.ZodArray<z.ZodString>;
    dismissals: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type ValidatedEvidenceProps = z.infer<typeof ValidatedEvidencePropsSchema>;
/** Adapter-supplied attestations are trusted input, gathered before the model run, never model output. */
export declare class ValidatedReviewVerifier implements ReviewVerifier {
    private readonly props;
    constructor(props: ValidatedEvidenceProps);
    verify(evidence: ReviewEvidence): Promise<boolean>;
    authorize(answer: DecisionAnswer, finding: ActionableFinding): Promise<boolean>;
    dismissal(evidence: ReviewEvidence): Promise<boolean>;
}
export {};
