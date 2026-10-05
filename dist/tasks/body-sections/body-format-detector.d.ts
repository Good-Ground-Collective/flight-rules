import type { EntityMetadata } from '../task-tracker/task-tracker.js';
import { type BodyFormat } from './body-sections.js';
export interface BodyFormatDetectorInput {
    body: string;
    metadata: EntityMetadata;
    issueType?: string;
}
export interface BodyFormatDetector {
    detect(input: BodyFormatDetectorInput): BodyFormat;
}
/**
 * Answers `'layered-body' | 'bug-report'` from three signals in a fixed order of
 * authority (docs/bug-report-format.md): an explicit `metadata.kind`, then the
 * issue type (`Bug`, case-insensitively, means a bug report; any other *real*
 * type means a layered body), then the leading `## Symptom` heading. Tracker
 * placeholder types (see `placeholderIssueTypes`) count as no type, so the
 * heading fallback still runs for untyped tickets. The heading is the last
 * resort — consulted only when neither an override nor a real type is present —
 * and reuses the section reader's own sniff so the two never drift.
 */
export declare class PrecedenceBodyFormatDetector implements BodyFormatDetector {
    detect(input: BodyFormatDetectorInput): BodyFormat;
    /** The lower-cased issue type, or `undefined` when absent or a tracker placeholder. */
    private explicitIssueType;
}
export declare const bodyFormatDetector: BodyFormatDetector;
