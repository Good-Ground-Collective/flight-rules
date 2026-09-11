import { describe, it, expect } from 'vitest'
import type { EntityMetadata } from '../../task-tracker/task-tracker.js'
import { bodyFormatDetector, PrecedenceBodyFormatDetector } from '../body-format-detector.js'
import type { BodyFormat } from '../body-sections.js'

const symptomBody = '## Symptom\n\nThe page 500s on save.\n'
const layeredBody = '## Problem Statement\n\nSomething is wrong.\n'

type Row = {
  name: string
  metadata: EntityMetadata
  issueType?: string
  body: string
  expected: BodyFormat
}

// The full precedence truth table from docs/bug-report-format.md: metadata.kind
// wins first, then a Bug issue type (any other *real* type means layered), then
// the leading `## Symptom` heading, defaulting to layered body. Tracker
// placeholder types ('unknown' from Jira, 'Issue' from GitHub) count as no type,
// so the heading fallback still runs. Each row that also carries a contradicting
// lower-precedence signal proves the order of authority, not just the happy path.
const rows: Row[] = [
  { name: 'kind=bug overrides a Story issue type and a layered body', metadata: { kind: 'bug' }, issueType: 'Story', body: layeredBody, expected: 'bug-report' },
  { name: 'kind=bug overrides a Symptom heading is moot but stays bug', metadata: { kind: 'bug' }, body: symptomBody, expected: 'bug-report' },
  { name: 'kind=story overrides a Bug issue type', metadata: { kind: 'story' }, issueType: 'Bug', body: layeredBody, expected: 'layered-body' },
  { name: 'kind=story overrides a Symptom heading', metadata: { kind: 'story' }, body: symptomBody, expected: 'layered-body' },
  { name: 'issueType Bug with no kind', metadata: {}, issueType: 'Bug', body: layeredBody, expected: 'bug-report' },
  { name: 'issueType bug (lowercase) with no kind', metadata: {}, issueType: 'bug', body: layeredBody, expected: 'bug-report' },
  { name: 'issueType BUG (uppercase) with no kind', metadata: {}, issueType: 'BUG', body: layeredBody, expected: 'bug-report' },
  { name: 'issueType Story overrides a contradictory Symptom heading', metadata: {}, issueType: 'Story', body: symptomBody, expected: 'layered-body' },
  { name: 'issueType Task (a real non-bug type) is layered', metadata: {}, issueType: 'Task', body: symptomBody, expected: 'layered-body' },
  { name: "Jira placeholder 'unknown' is not authoritative: sniffs a Symptom heading to bug", metadata: {}, issueType: 'unknown', body: symptomBody, expected: 'bug-report' },
  { name: "Jira placeholder 'unknown' with a layered body still sniffs to layered", metadata: {}, issueType: 'unknown', body: layeredBody, expected: 'layered-body' },
  { name: "GitHub placeholder 'Issue' is not authoritative: sniffs a Symptom heading to bug", metadata: {}, issueType: 'Issue', body: symptomBody, expected: 'bug-report' },
  { name: "GitHub placeholder 'issue' (lowercase) is not authoritative either", metadata: {}, issueType: 'issue', body: symptomBody, expected: 'bug-report' },
  { name: "GitHub placeholder 'Issue' with a layered body sniffs to layered", metadata: {}, issueType: 'Issue', body: layeredBody, expected: 'layered-body' },
  { name: "kind=story still overrides the 'unknown' placeholder and a Symptom heading", metadata: { kind: 'story' }, issueType: 'unknown', body: symptomBody, expected: 'layered-body' },
  { name: 'no kind, no issueType, Symptom heading falls back to bug', metadata: {}, body: symptomBody, expected: 'bug-report' },
  { name: 'no kind, no issueType, Problem Statement heading is layered', metadata: {}, body: layeredBody, expected: 'layered-body' },
  { name: 'no signal at all defaults to layered', metadata: {}, body: '', expected: 'layered-body' },
]

describe('PrecedenceBodyFormatDetector', () => {
  it.each(rows)('$name', ({ metadata, issueType, body, expected }) => {
    const input = { body, metadata, ...(issueType !== undefined ? { issueType } : {}) }
    expect(bodyFormatDetector.detect(input)).toBe(expected)
  })

  it('exposes the interface → class → singleton shape', () => {
    expect(new PrecedenceBodyFormatDetector().detect({ body: symptomBody, metadata: {} })).toBe('bug-report')
  })

  it('does not sniff once an issue type is present, even a buried Symptom', () => {
    const buried = '## Overview\n\n```md\n## Symptom\n```\n'
    expect(bodyFormatDetector.detect({ body: buried, metadata: {}, issueType: 'Task' })).toBe('layered-body')
  })
})
