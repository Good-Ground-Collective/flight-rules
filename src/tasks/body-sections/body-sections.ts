const headingLine = /^##\s+(.+?)\s*$/
const detailsOpen = /^<details/
const detailsClose = /^<\/details>/
const checklistItem = /^-\s+\[( |x|X)\]\s+(.*)$/

/** Level-2 heading text → section key. Anything else stops accumulation. */
const headingKeys: Record<string, SectionKey> = {
  'Problem Statement': 'problemStatement',
  Solution: 'solution',
  'Acceptance Criteria': 'acceptanceCriteria',
  'High-level technical writeup': 'technicalWriteup',
}

export type SectionKey =
  | 'problemStatement'
  | 'solution'
  | 'acceptanceCriteria'
  | 'technicalWriteup'
  | 'guidedWalkthrough'

export interface AcceptanceCriterion {
  text: string
  done: boolean
}

export interface BodySections {
  problemStatement?: string
  solution?: string
  acceptanceCriteria?: string
  technicalWriteup?: string
  guidedWalkthrough?: string
  acceptanceCriteriaItems: AcceptanceCriterion[]
}

export interface BodySectionsParser {
  parse(body: string): BodySections
}

/**
 * Splits a layered-body (docs/layered-body-format.md) into its named prose
 * sections and the acceptance-criteria checklist. Sections are delimited
 * strictly between one heading (or the Guided Walkthrough details block) and
 * the next boundary, so the raw LLM-Context YAML that GitHub bodies carry — and
 * Jira bodies strip — is consumed and never bleeds into a section. The Guided
 * Walkthrough may be hint-only or absent (sharpen-the-saw tickets); that is a
 * valid state, not an error.
 */
export class LayeredBodySectionsParser implements BodySectionsParser {
  parse(body: string): BodySections {
    const lines = body.replace(/\r\n/g, '\n').split('\n')
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
        }
        current = undefined
        i = block.next
        continue
      }

      if (current !== undefined) raw[current]?.push(line)
      i++
    }

    const items = (raw.acceptanceCriteria ?? [])
      .map((item) => item.match(checklistItem))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => ({ text: (match[2] ?? '').trim(), done: match[1]?.toLowerCase() === 'x' }))

    const text = (key: SectionKey): string | undefined => {
      const joined = (raw[key] ?? []).join('\n').trim()
      return joined.length > 0 ? joined : undefined
    }

    const problemStatement = text('problemStatement')
    const solution = text('solution')
    const acceptanceCriteria = text('acceptanceCriteria')
    const technicalWriteup = text('technicalWriteup')
    const guidedWalkthrough = text('guidedWalkthrough')

    return {
      ...(problemStatement !== undefined ? { problemStatement } : {}),
      ...(solution !== undefined ? { solution } : {}),
      ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
      ...(technicalWriteup !== undefined ? { technicalWriteup } : {}),
      ...(guidedWalkthrough !== undefined ? { guidedWalkthrough } : {}),
      acceptanceCriteriaItems: items,
    }
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

export const bodySectionsParser: BodySectionsParser = new LayeredBodySectionsParser()
