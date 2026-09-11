import { z } from 'zod'
import { semanticTypes } from '../semantic-types.js'

/** Each "What Was Changed" bullet is short — one or two sentences. */
const maxChangeLineLength = 256
/** No more than a handful of bullets; a longer list is a sign the PR is doing too much. */
const maxChangeLines = 5

/**
 * The validated shape of a pull request the CLI will open. Title parts mirror
 * the conventional-commit vocabulary; the body parts render to the four
 * human-facing sections (What / Why / OTS Materials / Ticket Link) defined in
 * docs/pr-body-format.md; branch/reviewer/label fields are PR API parameters,
 * not body content.
 *
 * The prose fields (`whatWasChanged`, `whyWasItChanged`, `otsMaterials`) are
 * authored upstream by the tech-writer agent — this schema guarantees the
 * skeleton and the length budget, not the wording.
 */
export const PullRequestTemplateSchema = z.object({
  type: z.enum(semanticTypes),
  scope: z.string().min(1),
  description: z.string().min(1),
  whatWasChanged: z
    .array(z.string().min(1).max(maxChangeLineLength))
    .min(1)
    .max(maxChangeLines),
  whyWasItChanged: z.string().min(1),
  otsMaterials: z.string().min(1).optional(),
  ticketId: z.string().min(1).optional(),
  ticketUrl: z.url().optional(),
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
 * Same input always yields byte-identical output. The "What Was Changed" and
 * "Why Was It Changed" sections are always present (their fields are required);
 * "OTS Materials" and "Ticket Link" appear only when their fields are supplied.
 */
export class DefaultPullRequestBuilder implements PullRequestBuilder {
  build(input: PullRequestTemplate): RenderedPullRequest {
    const parsed = PullRequestTemplateSchema.parse(input)

    const title = `${parsed.type}(${parsed.scope}): ${parsed.description}`

    const sections: string[] = [
      '## What Was Changed',
      '',
      ...parsed.whatWasChanged.map((change) => `- ${change}`),
      '',
      '## Why Was It Changed',
      '',
      parsed.whyWasItChanged,
    ]

    if (parsed.otsMaterials !== undefined) {
      sections.push(
        '',
        '## OTS Materials',
        '',
        '<details><summary>Click to expand</summary>',
        '',
        parsed.otsMaterials,
        '',
        '</details>',
      )
    }

    const ticketLink = this.renderTicketLink(parsed.ticketId, parsed.ticketUrl)
    if (ticketLink !== undefined) {
      sections.push('', '## Ticket Link', '', `- ${ticketLink}`)
    }

    return { title, body: sections.join('\n') }
  }

  /**
   * A markdown link when a URL is present, the bare id when only an id is, the
   * bare URL when only a URL is, and nothing when neither is — so the section
   * is omitted rather than rendered empty.
   */
  private renderTicketLink(ticketId: string | undefined, ticketUrl: string | undefined): string | undefined {
    if (ticketId !== undefined && ticketUrl !== undefined) return `[${ticketId}](${ticketUrl})`
    if (ticketId !== undefined) return ticketId
    if (ticketUrl !== undefined) return ticketUrl
    return undefined
  }
}

export const pullRequestBuilder: PullRequestBuilder = new DefaultPullRequestBuilder()
