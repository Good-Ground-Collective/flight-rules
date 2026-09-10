import { Command } from 'commander'
import { PullRequestTemplateSchema } from '../../../git/pr-template/pr-template.js'
import { collect } from '../../../shared/collect.js'
import { resolveBody } from '../../../tasks/commands/resolve-body.js'
import type { PullRequestHost } from '../../pull-request-host/pull-request-host.js'

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
  attach: string[]
}

type PrCommentOptions = {
  body?: string
  bodyFile?: string
  attach: string[]
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
    .option('--attach <spec>', 'file to attach, as <path>#<caption> (repeatable)', collect, [])
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
      const created = await getHost().createPullRequest(template, { attach: opts.attach })
      process.stdout.write(JSON.stringify(created) + '\n')
    })

  pr.command('comment')
    .exitOverride()
    .argument('<number>', 'pull request number')
    .option('--body <body>', 'comment body (or use --body-file)')
    .option('--body-file <path>', 'read the comment body from a file')
    .option('--attach <spec>', 'file to attach, as <path>#<caption> (repeatable)', collect, [])
    .action(async (number: string, opts: PrCommentOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile })
      const result = await getHost().commentOnPullRequest(Number(number), body, { attach: opts.attach })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return pr
}
