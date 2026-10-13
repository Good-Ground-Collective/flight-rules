import { z } from "zod";
import type { ReviewVerifier } from "./review-planner.js";
import type { ActionableFinding, DecisionAnswer, ReviewEvidence } from "./review.schema.js";
export interface ReviewGitHubApi {
    get(path: string): Promise<unknown>;
    graphql(query: string, variables: Record<string, string | number>): Promise<unknown>;
}
export declare class GhReviewGitHubApi implements ReviewGitHubApi {
    get(path: string): Promise<unknown>;
    graphql(query: string, variables: Record<string, string | number>): Promise<unknown>;
    private run;
}
declare const GitHubReviewVerifierPropsSchema: z.ZodObject<{
    repo: z.ZodString;
    prNumber: z.ZodNumber;
    prAuthorId: z.ZodNumber;
    owners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    requireMapping: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type GitHubReviewVerifierProps = z.input<typeof GitHubReviewVerifierPropsSchema> & {
    api?: ReviewGitHubApi;
};
/** Checks GitHub artifact provenance and authority; the reviewer still judges the answer's meaning. */
export declare class GitHubReviewVerifier implements ReviewVerifier {
    private readonly props;
    private readonly api;
    constructor(props: GitHubReviewVerifierProps);
    verify(evidence: ReviewEvidence, headSha: string): Promise<boolean>;
    authorize(answer: DecisionAnswer, finding: ActionableFinding): Promise<boolean>;
    dismissal(evidence: ReviewEvidence): Promise<boolean>;
    private comment;
}
export {};
