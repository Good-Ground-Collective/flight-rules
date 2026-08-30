import { describe, it, expect } from 'vitest'
import { semanticTypes } from '../../semantic-types.js'
import {
  DefaultPullRequestBuilder,
  PullRequestTemplateSchema,
  type PullRequestTemplate,
} from '../pr-template.js'

const fullInput: PullRequestTemplate = {
  type: 'feat',
  scope: 'KAN-30',
  description: 'add pr template',
  whatWasChanged: ['Added a Zod schema for PR bodies.', 'Added a deterministic renderer.'],
  whyWasItChanged: 'Agentic PR bodies read as slop. This gives every PR the same human-facing shape.',
  otsMaterials: '```json\n{ "ok": true }\n```',
  ticketId: 'KAN-30',
  ticketUrl: 'https://example.atlassian.net/browse/KAN-30',
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

  it('rejects empty why prose', () => {
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, whyWasItChanged: '' }).success).toBe(false)
  })

  it('requires at least one what-was-changed bullet', () => {
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, whatWasChanged: [] }).success).toBe(false)
  })

  it('rejects more than five what-was-changed bullets', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, whatWasChanged: six }).success).toBe(false)
  })

  it('rejects a bullet longer than 256 characters', () => {
    const tooLong = 'x'.repeat(257)
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, whatWasChanged: [tooLong] }).success).toBe(false)
  })

  it('rejects a non-url ticket url', () => {
    expect(PullRequestTemplateSchema.safeParse({ ...fullInput, ticketUrl: 'not a url' }).success).toBe(false)
  })

  it('defaults reviewers and labels to empty arrays', () => {
    const result = PullRequestTemplateSchema.safeParse({
      type: 'feat',
      scope: 'KAN-30',
      description: 'add pr template',
      whatWasChanged: ['one change'],
      whyWasItChanged: 'a reason',
      baseBranch: 'main',
      headBranch: 'feat/x',
    })
    expect(result.success).toBe(true)
    if (result.success) {
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
        '## What Was Changed',
        '',
        '- Added a Zod schema for PR bodies.',
        '- Added a deterministic renderer.',
        '',
        '## Why Was It Changed',
        '',
        'Agentic PR bodies read as slop. This gives every PR the same human-facing shape.',
        '',
        '## OTS Materials',
        '',
        '<details><summary>Click to expand</summary>',
        '',
        '```json\n{ "ok": true }\n```',
        '',
        '</details>',
        '',
        '## Ticket Link',
        '',
        '- [KAN-30](https://example.atlassian.net/browse/KAN-30)',
      ].join('\n'),
    )
  })

  it('omits OTS Materials and Ticket Link when their fields are absent', () => {
    const { body } = builder.build({
      type: 'fix',
      scope: 'core',
      description: 'fix bug',
      whatWasChanged: ['Fixed the thing.'],
      whyWasItChanged: 'It was broken.',
      baseBranch: 'main',
      headBranch: 'fix/x',
      reviewers: [],
      labels: [],
    })
    expect(body).toBe(
      ['## What Was Changed', '', '- Fixed the thing.', '', '## Why Was It Changed', '', 'It was broken.'].join('\n'),
    )
  })

  it('renders a bare ticket id when no url is supplied', () => {
    const { body } = builder.build({ ...fullInput, otsMaterials: undefined, ticketUrl: undefined })
    expect(body).toContain('## Ticket Link\n\n- KAN-30')
  })

  it('produces byte-identical output for the same input', () => {
    expect(builder.build(fullInput)).toEqual(builder.build(fullInput))
  })

  it('throws on structurally invalid input rather than rendering partially', () => {
    expect(() => builder.build({ scope: 'x' } as unknown as PullRequestTemplate)).toThrow()
  })
})
