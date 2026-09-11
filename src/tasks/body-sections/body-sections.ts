const headingLine = /^##\s+(.+?)\s*$/
const detailsOpen = /^<details/
const detailsClose = /^<\/details>/
const checklistItem = /^-\s+\[( |x|X)\]\s+(.*)$/
const fenceLine = /^(`{3,}|~{3,})/

/** Level-2 heading text → section key for a layered body (docs/layered-body-format.md). */
const layeredHeadingKeys: Record<string, SectionKey> = {
  'Problem Statement': 'problemStatement',
  Solution: 'solution',
  'Acceptance Criteria': 'acceptanceCriteria',
  'High-level technical writeup': 'technicalWriteup',
}

/** Level-2 heading text → section key for a bug report (docs/bug-report-format.md). */
const bugReportHeadingKeys: Record<string, SectionKey> = {
  Symptom: 'symptom',
  Environment: 'environment',
  'Steps To Reproduce': 'stepsToReproduce',
  'Expected vs Actual': 'expectedVsActual',
  'Root Cause': 'rootCause',
  'Fixed When': 'fixedWhen',
  Evidence: 'evidence',
}

/** Section keys backed by prose or a checklist; every one is an optional string on BodySections. */
const stringSectionKeys: SectionKey[] = [
  'problemStatement',
  'solution',
  'acceptanceCriteria',
  'technicalWriteup',
  'guidedWalkthrough',
  'symptom',
  'environment',
  'stepsToReproduce',
  'expectedVsActual',
  'rootCause',
  'fixedWhen',
  'evidence',
  'reproductionNotes',
]

export type BodyFormat = 'layered-body' | 'bug-report'

export type SectionKey =
  | 'problemStatement'
  | 'solution'
  | 'acceptanceCriteria'
  | 'technicalWriteup'
  | 'guidedWalkthrough'
  | 'symptom'
  | 'environment'
  | 'stepsToReproduce'
  | 'expectedVsActual'
  | 'rootCause'
  | 'fixedWhen'
  | 'evidence'
  | 'reproductionNotes'

export interface AcceptanceCriterion {
  text: string
  done: boolean
}

export interface SectionSourceInput {
  body: string
  format?: BodyFormat
}

export interface BodySections {
  format: BodyFormat
  problemStatement?: string
  solution?: string
  acceptanceCriteria?: string
  technicalWriteup?: string
  guidedWalkthrough?: string
  symptom?: string
  environment?: string
  stepsToReproduce?: string
  expectedVsActual?: string
  rootCause?: string
  fixedWhen?: string
  evidence?: string
  reproductionNotes?: string
  acceptanceCriteriaItems: AcceptanceCriterion[]
  fixedWhenItems: AcceptanceCriterion[]
}

export interface SectionReadResult {
  id: string
  section: string
  format: BodyFormat
  markdown: string | null
  items?: AcceptanceCriterion[]
}

export interface SectionSource {
  read(input: SectionSourceInput): BodySections
}

/**
 * Reads a body blob into its named prose sections and the two checklists it can
 * carry. It recognizes both the layered-body headings (docs/layered-body-format.md)
 * and the Bug Report headings (docs/bug-report-format.md), choosing the map from
 * the caller-supplied `format` or, when absent, from a leading `## Symptom` sniff.
 * Sections are delimited strictly between one heading (or a matching details
 * block) and the next boundary, so the raw LLM-Context YAML that GitHub bodies
 * carry — and Jira bodies strip — is consumed and never bleeds into a section.
 * The Guided Walkthrough and Reproduction Notes blocks may be hint-only or
 * absent; that is a valid state, not an error. A field-backed source that reads
 * the same sections straight from tracker fields is the planned sibling.
 */
export class BlobSectionSource implements SectionSource {
  read(input: SectionSourceInput): BodySections {
    const lines = input.body.replace(/\r\n/g, '\n').split('\n')
    const format = input.format ?? this.sniff(lines)
    const headingKeys = format === 'bug-report' ? bugReportHeadingKeys : layeredHeadingKeys

    const raw: Partial<Record<SectionKey, string[]>> = {}
    let current: SectionKey | undefined
    let i = 0

    while (i < lines.length) {
      const line = lines[i] ?? ''

      const heading = line.match(headingLine)
      if (heading?.[1] !== undefined) {
        current = headingKeys[heading[1]]
        if (current !== undefined) raw[current] = []
        i++
        continue
      }

      if (detailsOpen.test(line.trim())) {
        const block = this.consumeDetails(lines, i)
        if (/guided walkthrough/i.test(block.title)) {
          raw.guidedWalkthrough = block.inner.split('\n')
        } else if (/reproduction notes/i.test(block.title)) {
          raw.reproductionNotes = block.inner.split('\n')
        }
        current = undefined
        i = block.next
        continue
      }

      if (current !== undefined) raw[current]?.push(line)
      i++
    }

    const text = (key: SectionKey): string | undefined => {
      const joined = (raw[key] ?? []).join('\n').trim()
      return joined.length > 0 ? joined : undefined
    }

    const sections: BodySections = {
      format,
      acceptanceCriteriaItems: this.checklistItems(raw.acceptanceCriteria),
      fixedWhenItems: this.checklistItems(raw.fixedWhen),
    }
    for (const key of stringSectionKeys) {
      const value = text(key)
      if (value !== undefined) sections[key] = value
    }

    return sections
  }

  /**
   * Classifies the body from its FIRST top-level `##` heading, not from any
   * occurrence anywhere: a bug report leads with `## Symptom`, a layered body
   * with `## Problem Statement`. A `## Symptom` buried inside a fenced code
   * block or a `<details>` block (e.g. the Guided Walkthrough) must not flip a
   * layered body to `bug-report`, so both are skipped exactly as the section
   * parser skips them — details via `consumeDetails`, fences by tracking the
   * open marker.
   */
  private sniff(lines: string[]): BodyFormat {
    let i = 0
    let openFence: string | undefined

    while (i < lines.length) {
      const line = lines[i] ?? ''
      const trimmed = line.trim()

      if (openFence !== undefined) {
        if (trimmed.startsWith(openFence)) openFence = undefined
        i++
        continue
      }

      const fence = trimmed.match(fenceLine)
      if (fence?.[1] !== undefined) {
        openFence = fence[1]
        i++
        continue
      }

      if (detailsOpen.test(trimmed)) {
        i = this.consumeDetails(lines, i).next
        continue
      }

      const heading = line.match(headingLine)
      if (heading?.[1] !== undefined) return heading[1] === 'Symptom' ? 'bug-report' : 'layered-body'

      i++
    }

    return 'layered-body'
  }

  private checklistItems(lines: string[] | undefined): AcceptanceCriterion[] {
    return (lines ?? [])
      .map((item) => item.match(checklistItem))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => ({ text: (match[2] ?? '').trim(), done: match[1]?.toLowerCase() === 'x' }))
  }

  private consumeDetails(
    lines: string[],
    start: number,
  ): { title: string; inner: string; next: number } {
    let depth = 0
    let end = lines.length - 1
    for (let j = start; j < lines.length; j++) {
      const trimmed = (lines[j] ?? '').trim()
      if (detailsOpen.test(trimmed)) depth++
      if (detailsClose.test(trimmed)) depth--
      if (depth === 0) {
        end = j
        break
      }
    }

    const block = lines.slice(start, end + 1).join('\n')
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/)
    const title = summary?.[1]?.trim() ?? ''

    const afterSummary = block.indexOf('</summary>')
    const withoutHead =
      afterSummary !== -1 ? block.slice(afterSummary + '</summary>'.length) : block.replace(detailsOpen, '')
    const inner = withoutHead.replace(/<\/details>\s*$/, '').trim()

    return { title, inner, next: end + 1 }
  }
}

export const blobSectionSource: SectionSource = new BlobSectionSource()

export interface SectionSelector {
  select(id: string, sections: BodySections, slug: string): SectionReadResult
}

/** `--section <slug>` → the BodySections key it reads. Each slug is the heading in kebab-case. */
const sectionFields: Record<string, SectionKey> = {
  'problem-statement': 'problemStatement',
  solution: 'solution',
  'acceptance-criteria': 'acceptanceCriteria',
  'technical-writeup': 'technicalWriteup',
  'guided-walkthrough': 'guidedWalkthrough',
  symptom: 'symptom',
  environment: 'environment',
  'steps-to-reproduce': 'stepsToReproduce',
  'expected-vs-actual': 'expectedVsActual',
  'root-cause': 'rootCause',
  'fixed-when': 'fixedWhen',
  evidence: 'evidence',
  'reproduction-notes': 'reproductionNotes',
}

/**
 * Turns a read `BodySections` and a `--section` slug into the CLI's section
 * result. `markdown` is null when the detected format does not carry the
 * requested section; the checklist slugs also surface their parsed `items`.
 */
export class BodySectionSelector implements SectionSelector {
  select(id: string, sections: BodySections, slug: string): SectionReadResult {
    const field = sectionFields[slug]
    if (field === undefined) {
      throw new Error(`unknown section "${slug}" — expected one of: ${Object.keys(sectionFields).join(', ')}`)
    }

    return {
      id,
      section: slug,
      format: sections.format,
      markdown: sections[field] ?? null,
      ...(field === 'acceptanceCriteria' ? { items: sections.acceptanceCriteriaItems } : {}),
      ...(field === 'fixedWhen' ? { items: sections.fixedWhenItems } : {}),
    }
  }
}

export const sectionSelector: SectionSelector = new BodySectionSelector()
