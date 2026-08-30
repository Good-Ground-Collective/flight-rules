import { Command } from 'commander'
import { PullRequestTemplateSchema } from '../../../git/pr-template/pr-template.js'
import type { PullRequestHost } from '../../pull-request-host/pull-request-host.js'

// eslint-disable-next-line preflight/no-loose-functions -- collect is module-level behaviour awaiting a home on a service; tracked in KAN-39
function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

type PrCreateOptions = {
  type: string
  scope: string
  description: string
  why: string
  what: string[]
  ots?: string
  base: string
  head: string
  ticketId?: string
  ticketUrl?: string
  reviewer: string[]
  label: string[]
}

export function createPrCommand(getHost: () => PullRequestHost): Command {
  const pr = new Command('pr')

  pr.command('create')
    .exitOverride()
    .requiredOption('--type <type>', 'conventional commit type')
    .requiredOption('--scope <scope>', 'conventional commit scope')
    .requiredOption('--description <description>', 'PR title description')
    .requiredOption('--why <why>', 'the "Why Was It Changed" prose section')
    .requiredOption('--what <what>', 'a "What Was Changed" bullet (repeatable, 1-5)', collect, [])
    .requiredOption('--base <base>', 'base branch to merge into')
    .requiredOption('--head <head>', 'head branch to merge from')
    .option('--ots <markdown>', 'the "OTS Materials" block (raw markdown/JSON)')
    .option('--ticket-id <id>', 'tracker ticket id')
    .option('--ticket-url <url>', 'tracker ticket url')
    .option('--reviewer <reviewer>', 'reviewer to request (repeatable)', collect, [])
    .option('--label <label>', 'label to apply (repeatable)', collect, [])
    .action(async (opts: PrCreateOptions) => {
      const template = PullRequestTemplateSchema.parse({
        type: opts.type,
        scope: opts.scope,
        description: opts.description,
        whatWasChanged: opts.what,
        whyWasItChanged: opts.why,
        baseBranch: opts.base,
        headBranch: opts.head,
        ...(opts.ots !== undefined ? { otsMaterials: opts.ots } : {}),
        ...(opts.ticketId !== undefined ? { ticketId: opts.ticketId } : {}),
        ...(opts.ticketUrl !== undefined ? { ticketUrl: opts.ticketUrl } : {}),
        reviewers: opts.reviewer,
        labels: opts.label,
      })
      const created = await getHost().createPullRequest(template)
      process.stdout.write(JSON.stringify(created) + '\n')
    })

  return pr
}
