import { describe, it, expect } from 'vitest'
import { semanticTypes } from '../semantic-types.js'
import {
  DefaultPullRequestBuilder,
  PullRequestTemplateSchema,
  type PullRequestTemplate,
} from './pr-template.js'

const fullInput: PullRequestTemplate = {
  type: 'feat',
  scope: 'KAN-30',
  description: 'add pr template',
  summary: 'Adds a Zod schema and renderer for pull requests.',
  changes: ['schema', 'renderer'],
  ticketId: 'KAN-30',
  testNotes: 'unit tests assert exact output',
  baseBranch: 'main',
  headBranch: 'feat/KAN-30-pr-template-schema',
  reviewers: [],
  labels: [],
}

describe('PullRequestTemplateSchema', () => {
  it('accepts a fully-populated template', () => {
    expect(PullRequestTemplateSchema.safeParse(fullInput).success).toBe(true)
  })

  it('accepts every semantic type', () => {
    for (const type of semanticTypes) {
      expect(PullRequestTemplateSchema.safeParse({ ...fullInput, type }).success).toBe(true)
    }
  })

  it('rejects a type outside the semantic vocabulary', () => {
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, type: 'bogus' }).success).toBe(false)
  })

  it('rejects an empty description', () => {
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, description: '' }).success).toBe(false)
  })

  it('rejects an empty summary', () => {
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, summary: '' }).success).toBe(false)
  })

  it('defaults changes, reviewers, and labels to empty arrays', () => {
    const result = PullRequestTemplateSchema.safeParse({
      type: 'feat',
      scope: 'KAN-30',
      description: 'add pr template',
      summary: 'a summary',
      baseBranch: 'main',
      headBranch: 'feat/x',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.changes).toEqual([])
      expect(result.data.reviewers).toEqual([])
      expect(result.data.labels).toEqual([])
    }
  })
})

describe('DefaultPullRequestBuilder.build', () => {
  const builder = new DefaultPullRequestBuilder()

  it('renders the exact title and body for a fully-populated template', () => {
    const { title, body } = builder.build(fullInput)
    expect(title).toBe('feat(KAN-30): add pr template')
    expect(body).toBe(
      [
        '## Summary',
        '',
        'Adds a Zod schema and renderer for pull requests.',
        '',
        '## Changes',
        '',
        '- schema',
        '- renderer',
        '',
        '## Ticket',
        '',
        'KAN-30',
        '',
        '## Testing',
        '',
        'unit tests assert exact output',
      ].join('\n'),
    )
  })

  it('omits optional sections when their fields are absent', () => {
    const { body } = builder.build({
      type: 'fix',
      scope: 'core',
      description: 'fix bug',
      summary: 'Just a summary.',
      changes: [],
      baseBranch: 'main',
      headBranch: 'fix/x',
      reviewers: [],
      labels: [],
    })
    expect(body).toBe('## Summary\n\nJust a summary.')
  })

  it('produces byte-identical output for the same input', () => {
    expect(builder.build(fullInput)).toEqual(builder.build(fullInput))
  })

  it('throws on structurally invalid input rather than rendering partially', () => {
    expect(() => builder.build({ scope: 'x' } as unknown as PullRequestTemplate)).toThrow()
  })
})
