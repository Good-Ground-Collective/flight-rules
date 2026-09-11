import { describe, it, expect } from 'vitest'
import { blobSectionSource, sectionSelector } from '../body-sections.js'

const prose = [
  '## Problem Statement',
  '',
  'Something is wrong.',
  '',
  '## Solution',
  '',
  'Fix it.',
  '',
  '## Acceptance Criteria',
  '',
  '- [ ] first condition',
  '- [x] already done',
  '',
  '## High-level technical writeup',
  '',
  'Touch `src/foo.ts`.',
]

const guidedWalkthrough = ['<details><summary>Guided Walkthrough</summary>', '', '1. Do the thing.', '', '</details>']

const llmContext = [
  '<details>',
  '<summary>LLM Context</summary>',
  '<!-- flight-rules:metadata -->',
  '',
  '```yaml',
  'size: ticket',
  '```',
  '',
  '</details>',
]

// GitHub returns the raw body including the LLM Context block; Jira strips it.
const githubBody = [...prose, '', ...guidedWalkthrough, '', ...llmContext].join('\n')
const jiraBody = [...prose, '', ...guidedWalkthrough].join('\n')
// sharpen-the-saw tickets reduce the walkthrough to nothing.
const sawBody = [...prose].join('\n')

const bugProse = [
  '## Symptom',
  '',
  'The button does nothing.',
  '',
  '## Environment',
  '',
  'Staging, Chrome, 2026-09-01.',
  '',
  '## Steps To Reproduce',
  '',
  '1. Click the button.',
  '',
  '## Expected vs Actual',
  '',
  '**Expected:** it saves.',
  '**Actual:** nothing happens.',
  '',
  '## Root Cause',
  '',
  'The handler is never wired.',
  '',
  '## Fixed When',
  '',
  '- [ ] the button saves',
  '- [x] regression test added',
  '',
  '## Evidence',
  '',
  '![Before](./before.png)',
]

const reproductionNotes = [
  '<details><summary>Reproduction Notes</summary>',
  '',
  'POST /v1/things with an empty body.',
  '',
  '</details>',
]

const bugGithubBody = [...bugProse, '', ...reproductionNotes, '', ...llmContext].join('\n')
const bugJiraBody = [...bugProse, '', ...reproductionNotes].join('\n')

describe('BlobSectionSource.read (layered body)', () => {
  it('extracts every prose section from a GitHub-shaped body', () => {
    const s = blobSectionSource.read({ body: githubBody })
    expect(s.format).toBe('layered-body')
    expect(s.problemStatement).toBe('Something is wrong.')
    expect(s.solution).toBe('Fix it.')
    expect(s.technicalWriteup).toBe('Touch `src/foo.ts`.')
    expect(s.guidedWalkthrough).toBe('1. Do the thing.')
  })

  it('never bleeds the LLM Context YAML into a section (GitHub body)', () => {
    const s = blobSectionSource.read({ body: githubBody })
    const joined = JSON.stringify(s)
    expect(joined).not.toContain('flight-rules:metadata')
    expect(joined).not.toContain('size: ticket')
    expect(s.technicalWriteup).toBe('Touch `src/foo.ts`.')
  })

  it('parses acceptance criteria into structured items with done state', () => {
    const s = blobSectionSource.read({ body: githubBody })
    expect(s.acceptanceCriteriaItems).toEqual([
      { text: 'first condition', done: false },
      { text: 'already done', done: true },
    ])
    expect(s.acceptanceCriteria).toBe('- [ ] first condition\n- [x] already done')
  })

  it('produces identical prose sections for the Jira-shaped body (no LLM Context)', () => {
    const github = blobSectionSource.read({ body: githubBody })
    const jira = blobSectionSource.read({ body: jiraBody })
    expect(jira.problemStatement).toBe(github.problemStatement)
    expect(jira.technicalWriteup).toBe(github.technicalWriteup)
    expect(jira.guidedWalkthrough).toBe(github.guidedWalkthrough)
    expect(jira.acceptanceCriteriaItems).toEqual(github.acceptanceCriteriaItems)
  })

  it('tolerates an absent Guided Walkthrough (sharpen-the-saw body)', () => {
    const s = blobSectionSource.read({ body: sawBody })
    expect(s.guidedWalkthrough).toBeUndefined()
    expect(s.problemStatement).toBe('Something is wrong.')
    expect(s.acceptanceCriteriaItems).toHaveLength(2)
  })

  it('returns empty item lists when there are no checklists', () => {
    const s = blobSectionSource.read({ body: '## Solution\n\nJust a solution.' })
    expect(s.acceptanceCriteriaItems).toEqual([])
    expect(s.fixedWhenItems).toEqual([])
    expect(s.acceptanceCriteria).toBeUndefined()
  })
})

describe('BlobSectionSource.read (bug report)', () => {
  it('sniffs a bug-report body from its leading ## Symptom heading', () => {
    const s = blobSectionSource.read({ body: bugGithubBody })
    expect(s.format).toBe('bug-report')
    expect(s.symptom).toBe('The button does nothing.')
    expect(s.environment).toBe('Staging, Chrome, 2026-09-01.')
    expect(s.stepsToReproduce).toBe('1. Click the button.')
    expect(s.expectedVsActual).toBe('**Expected:** it saves.\n**Actual:** nothing happens.')
    expect(s.rootCause).toBe('The handler is never wired.')
    expect(s.evidence).toBe('![Before](./before.png)')
  })

  it('parses Fixed When into structured items with done state', () => {
    const s = blobSectionSource.read({ body: bugGithubBody })
    expect(s.fixedWhenItems).toEqual([
      { text: 'the button saves', done: false },
      { text: 'regression test added', done: true },
    ])
    expect(s.fixedWhen).toBe('- [ ] the button saves\n- [x] regression test added')
  })

  it('populates reproductionNotes from the matching details block', () => {
    const s = blobSectionSource.read({ body: bugGithubBody })
    expect(s.reproductionNotes).toBe('POST /v1/things with an empty body.')
  })

  it('never bleeds the LLM Context YAML into a section (bug-report body)', () => {
    const s = blobSectionSource.read({ body: bugGithubBody })
    const joined = JSON.stringify(s)
    expect(joined).not.toContain('flight-rules:metadata')
    expect(joined).not.toContain('size: ticket')
  })

  it('produces identical sections for the Jira-shaped body (no LLM Context)', () => {
    const github = blobSectionSource.read({ body: bugGithubBody })
    const jira = blobSectionSource.read({ body: bugJiraBody })
    expect(jira.symptom).toBe(github.symptom)
    expect(jira.rootCause).toBe(github.rootCause)
    expect(jira.reproductionNotes).toBe(github.reproductionNotes)
    expect(jira.fixedWhenItems).toEqual(github.fixedWhenItems)
  })
})

describe('BlobSectionSource.read (format selection)', () => {
  it('sniffs a layered body when no ## Symptom heading is present', () => {
    const s = blobSectionSource.read({ body: githubBody })
    expect(s.format).toBe('layered-body')
    expect(s.symptom).toBeUndefined()
  })

  it('honors an explicit format instead of sniffing', () => {
    const s = blobSectionSource.read({ body: githubBody, format: 'bug-report' })
    expect(s.format).toBe('bug-report')
    // The layered headings do not match the bug-report map, so its fields stay empty.
    expect(s.symptom).toBeUndefined()
    expect(s.problemStatement).toBeUndefined()
    expect(s.fixedWhenItems).toEqual([])
  })

  // Regression: a `## Symptom` that merely appears somewhere in a layered body —
  // inside the Guided Walkthrough or a fenced code block — must not flip the
  // format to bug-report and silently drop the real sections.
  it('stays layered when ## Symptom appears in the Guided Walkthrough or a code fence', () => {
    const walkthroughWithSymptom = [
      '<details><summary>Guided Walkthrough</summary>',
      '',
      '1. Reproduce the reported issue:',
      '',
      '```markdown',
      '## Symptom',
      '',
      'The button does nothing.',
      '```',
      '',
      '## Symptom is called out in the prose here too.',
      '',
      '</details>',
    ]
    const body = [...prose, '', ...walkthroughWithSymptom, '', ...llmContext].join('\n')

    const s = blobSectionSource.read({ body })
    expect(s.format).toBe('layered-body')

    const section = sectionSelector.select('T-1', s, 'acceptance-criteria')
    expect(section.markdown).toBe('- [ ] first condition\n- [x] already done')
    expect(section.items).toEqual([
      { text: 'first condition', done: false },
      { text: 'already done', done: true },
    ])
  })

  it('skips a leading fence or details block when finding the first heading', () => {
    const fencedBody = ['```md', '## Symptom', 'not a real heading', '```', '', ...prose].join('\n')
    expect(blobSectionSource.read({ body: fencedBody }).format).toBe('layered-body')

    const detailsBody = [
      '<details><summary>Context</summary>',
      '',
      '## Symptom',
      '',
      '</details>',
      '',
      ...prose,
    ].join('\n')
    expect(blobSectionSource.read({ body: detailsBody }).format).toBe('layered-body')
  })
})
