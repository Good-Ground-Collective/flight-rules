import { z } from 'zod'
import { semanticTypes } from '../semantic-types.js'

/**
 * The validated shape of a pull request the CLI will open. Title parts mirror
 * the conventional-commit vocabulary; body parts render to markdown sections;
 * branch/reviewer/label fields are PR API parameters, not body content.
 */
export const PullRequestTemplateSchema = z.object({
  type: z.enum(semanticTypes),
  scope: z.string().min(1),
  description: z.string().min(1),
  summary: z.string().min(1),
  changes: z.array(z.string()).default([]),
  ticketId: z.string().optional(),
  testNotes: z.string().optional(),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1),
  reviewers: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
})

export type PullRequestTemplate = z.infer<typeof PullRequestTemplateSchema>

export interface RenderedPullRequest {
  title: string
  body: string
}

export interface PullRequestBuilder {
  build(input: PullRequestTemplate): RenderedPullRequest
}

/**
 * Renders a validated template into a deterministic PR title and markdown body.
 * Same input always yields byte-identical output; optional sections are absent
 * (not empty) when their field is omitted.
 */
export class DefaultPullRequestBuilder implements PullRequestBuilder {
  build(input: PullRequestTemplate): RenderedPullRequest {
    const parsed = PullRequestTemplateSchema.parse(input)

    const title = `${parsed.type}(${parsed.scope}): ${parsed.description}`

    const sections: string[] = ['## Summary', '', parsed.summary]

    if (parsed.changes.length > 0) {
      sections.push('', '## Changes', '', ...parsed.changes.map((change) => `- ${change}`))
    }

    if (parsed.ticketId !== undefined) {
      sections.push('', '## Ticket', '', parsed.ticketId)
    }

    if (parsed.testNotes !== undefined) {
      sections.push('', '## Testing', '', parsed.testNotes)
    }

    return { title, body: sections.join('\n') }
  }
}

export const pullRequestBuilder: PullRequestBuilder = new DefaultPullRequestBuilder()
