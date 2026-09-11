import type { EntityMetadata } from '../task-tracker/task-tracker.js'
import { blobSectionSource, type BodyFormat } from './body-sections.js'

export interface BodyFormatDetectorInput {
  body: string
  metadata: EntityMetadata
  issueType?: string
}

export interface BodyFormatDetector {
  detect(input: BodyFormatDetectorInput): BodyFormat
}

/**
 * Answers `'layered-body' | 'bug-report'` from three signals in a fixed order of
 * authority (docs/bug-report-format.md): an explicit `metadata.kind`, then the
 * Jira issue type (`Bug`, case-insensitively, means a bug report; any other
 * defined issue type means a layered body), then the leading `## Symptom`
 * heading. The heading is the last resort — consulted only when neither an
 * override nor an issue type is present — and reuses the section reader's own
 * sniff so the two never drift.
 */
export class PrecedenceBodyFormatDetector implements BodyFormatDetector {
  detect(input: BodyFormatDetectorInput): BodyFormat {
    const { body, metadata, issueType } = input
    if (metadata.kind === 'bug') return 'bug-report'
    if (metadata.kind === 'story') return 'layered-body'
    if (issueType !== undefined && issueType.toLowerCase() === 'bug') return 'bug-report'
    if (issueType !== undefined) return 'layered-body'
    return blobSectionSource.read({ body }).format
  }
}

export const bodyFormatDetector: BodyFormatDetector = new PrecedenceBodyFormatDetector()
