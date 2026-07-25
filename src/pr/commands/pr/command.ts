import { Command } from 'commander'
import { PullRequestTemplateSchema } from '../../../git/pr-template/pr-template.js'
import type { PullRequestHost } from '../../pull-request-host/pull-request-host.js'

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

type PrCreateOptions = {
  type: string
  scope: string
  description: string
  summary: string
  base: string
  head: string
  change: string[]
  ticketId?: string
  testNotes?: string
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
    .requiredOption('--summary <summary>', 'PR summary section')
    .requiredOption('--base <base>', 'base branch to merge into')
    .requiredOption('--head <head>', 'head branch to merge from')
    .option('--change <change>', 'a change line (repeatable)', collect, [])
    .option('--ticket-id <id>', 'tracker ticket id')
    .option('--test-notes <notes>', 'testing section')
    .option('--reviewer <reviewer>', 'reviewer to request (repeatable)', collect, [])
    .option('--label <label>', 'label to apply (repeatable)', collect, [])
    .action(async (opts: PrCreateOptions) => {
      const template = PullRequestTemplateSchema.parse({
        type: opts.type,
        scope: opts.scope,
        description: opts.description,
        summary: opts.summary,
        changes: opts.change,
        baseBranch: opts.base,
        headBranch: opts.head,
        ...(opts.ticketId !== undefined ? { ticketId: opts.ticketId } : {}),
        ...(opts.testNotes !== undefined ? { testNotes: opts.testNotes } : {}),
        reviewers: opts.reviewer,
        labels: opts.label,
      })
      const created = await getHost().createPullRequest(template)
      process.stdout.write(JSON.stringify(created) + '\n')
    })

  return pr
}
