import { describe, it, expect } from 'vitest'
import { bodySectionsParser } from './body-sections.js'

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

describe('LayeredBodySectionsParser.parse', () => {
  it('extracts every prose section from a GitHub-shaped body', () => {
    const s = bodySectionsParser.parse(githubBody)
    expect(s.problemStatement).toBe('Something is wrong.')
    expect(s.solution).toBe('Fix it.')
    expect(s.technicalWriteup).toBe('Touch `src/foo.ts`.')
    expect(s.guidedWalkthrough).toBe('1. Do the thing.')
  })

  it('never bleeds the LLM Context YAML into a section (GitHub body)', () => {
    const s = bodySectionsParser.parse(githubBody)
    const joined = JSON.stringify(s)
    expect(joined).not.toContain('flight-rules:metadata')
    expect(joined).not.toContain('size: ticket')
    expect(s.technicalWriteup).toBe('Touch `src/foo.ts`.')
  })

  it('parses acceptance criteria into structured items with done state', () => {
    const s = bodySectionsParser.parse(githubBody)
    expect(s.acceptanceCriteriaItems).toEqual([
      { text: 'first condition', done: false },
      { text: 'already done', done: true },
    ])
    expect(s.acceptanceCriteria).toBe('- [ ] first condition\n- [x] already done')
  })

  it('produces identical prose sections for the Jira-shaped body (no LLM Context)', () => {
    const github = bodySectionsParser.parse(githubBody)
    const jira = bodySectionsParser.parse(jiraBody)
    expect(jira.problemStatement).toBe(github.problemStatement)
    expect(jira.technicalWriteup).toBe(github.technicalWriteup)
    expect(jira.guidedWalkthrough).toBe(github.guidedWalkthrough)
    expect(jira.acceptanceCriteriaItems).toEqual(github.acceptanceCriteriaItems)
  })

  it('tolerates an absent Guided Walkthrough (sharpen-the-saw body)', () => {
    const s = bodySectionsParser.parse(sawBody)
    expect(s.guidedWalkthrough).toBeUndefined()
    expect(s.problemStatement).toBe('Something is wrong.')
    expect(s.acceptanceCriteriaItems).toHaveLength(2)
  })

  it('returns an empty item list when there are no acceptance criteria', () => {
    const s = bodySectionsParser.parse('## Solution\n\nJust a solution.')
    expect(s.acceptanceCriteriaItems).toEqual([])
    expect(s.acceptanceCriteria).toBeUndefined()
  })
})
