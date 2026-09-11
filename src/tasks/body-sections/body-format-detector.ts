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
 * Tracker placeholders for a *missing* issue type, lower-cased. Neither adapter
 * can report "no type": Jira's adapter maps an absent `issuetype` to `'unknown'`
 * and GitHub's maps an absent `type` to `'Issue'` (and TicketSchema defaults the
 * field to `'unknown'`). Both are stand-ins, not a user-assigned type, so the
 * detector treats them as "no explicit type" and lets the fallback chain run —
 * otherwise the `## Symptom` heading sniff would be dead code for real tickets.
 */
const placeholderIssueTypes: readonly string[] = ['unknown', 'issue']

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
export class PrecedenceBodyFormatDetector implements BodyFormatDetector {
  detect(input: BodyFormatDetectorInput): BodyFormat {
    const { body, metadata, issueType } = input
    if (metadata.kind === 'bug') return 'bug-report'
    if (metadata.kind === 'story') return 'layered-body'
    const explicitType = this.explicitIssueType(issueType)
    if (explicitType === 'bug') return 'bug-report'
    if (explicitType !== undefined) return 'layered-body'
    return blobSectionSource.read({ body }).format
  }

  /** The lower-cased issue type, or `undefined` when absent or a tracker placeholder. */
  private explicitIssueType(issueType: string | undefined): string | undefined {
    if (issueType === undefined) return undefined
    const lowered = issueType.toLowerCase()
    return placeholderIssueTypes.includes(lowered) ? undefined : lowered
  }
}

export const bodyFormatDetector: BodyFormatDetector = new PrecedenceBodyFormatDetector()
