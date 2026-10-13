import type { FindingRecord, ReviewState, StoredFinding } from "./review.schema.js";
export interface ReviewCodec {
    finding(record: FindingRecord): string;
    state(state: ReviewState): string;
    readFindings(input: {
        body: string;
        authorId: number;
        trustedAuthorIds: number[];
    }): FindingRecord[];
    readState(input: {
        body: string;
        authorId: number;
        trustedAuthorIds: number[];
    }): ReviewState | undefined;
    render(record: FindingRecord): string;
    fingerprint(finding: StoredFinding): string;
}
/** Full markers preserve actionable state independently of GitHub thread resolution or rendered prose. */
export declare class JsonReviewCodec implements ReviewCodec {
    finding(record: FindingRecord): string;
    state(state: ReviewState): string;
    readFindings(input: {
        body: string;
        authorId: number;
        trustedAuthorIds: number[];
    }): FindingRecord[];
    readState(input: {
        body: string;
        authorId: number;
        trustedAuthorIds: number[];
    }): ReviewState | undefined;
    render(record: FindingRecord): string;
    fingerprint(finding: StoredFinding): string;
    private marker;
    private readMarkers;
}
