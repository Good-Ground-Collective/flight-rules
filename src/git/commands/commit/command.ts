import { Command } from 'commander'
import {
  DefaultCommitMessageBuilder,
  type CommitMessageBuilder,
} from '../../commit-message-builder/commit-message-builder.js'
import { CommitMessageInputSchema } from '../../commit-message-builder/commit-message.schema.js'
import type { GitExecutor } from '../../git-executor/git-executor.js'
import { semanticTypes } from '../../semantic-types.js'

// eslint-disable-next-line preflight/no-loose-functions -- collect is module-level behaviour awaiting a home on a service; tracked in KAN-39
function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

type GitCommitOptions = {
  type: string
  scope: string
  description: string
  file: string[]
  body?: string
  footer: string[]
  model?: string
}

type GitCheckoutOptions = {
  type: string
  scope: string
  description?: string
  from?: string
}

export function createGitCommand(getExecutor: () => GitExecutor): Command {
  const git = new Command('git')

  git
    .command('commit')
    .exitOverride()
    .requiredOption('--type <type>', 'conventional commit type')
    .requiredOption('--scope <scope>', 'conventional commit scope')
    .requiredOption('--description <description>', 'commit description')
    .option('--file <file>', 'file to stage (repeatable)', collect, [])
    .option('--body <body>', 'commit body')
    .option('--footer <footer>', 'commit footer (repeatable)', collect, [])
    .option('--model <model>', 'model identifier')
    .action(async (opts: GitCommitOptions) => {
      const builder: CommitMessageBuilder = new DefaultCommitMessageBuilder({
        binPath: process.argv[1] ?? '',
        agentEnv: process.env['AI_AGENT'],
      })

      const commitMessagePartsValidation = CommitMessageInputSchema.safeParse({
        type: opts.type,
        scope: opts.scope,
        description: opts.description,
        body: opts.body ?? undefined,
        footers: opts.footer,
        model: opts.model ?? undefined
      })
      if (!commitMessagePartsValidation.success) throw commitMessagePartsValidation.error;

      const message = builder.build(commitMessagePartsValidation.data)
      const executor = getExecutor()
      await executor.stage(opts.file)
      await executor.commit(message)
      const sha = await executor.getCommitSha()
      process.stdout.write(JSON.stringify({ sha, message }) + '\n')
    })

  git
    .command('checkout')
    .exitOverride()
    .requiredOption('--type <type>', `branch type (${semanticTypes.join(' | ')})`)
    .requiredOption('--scope <scope>', 'ticket number / scope')
    .option('--description <description>', 'short readable slug')
    .option('--from <base>', 'existing branch to base the new branch on (for stacking)')
    .action(async (opts: GitCheckoutOptions) => {
      const executor = getExecutor()
      const branch = await executor.checkout(
        {
          type: opts.type,
          scope: opts.scope,
          ...(opts.description !== undefined ? { description: opts.description } : {}),
        },
        opts.from,
      )
      process.stdout.write(JSON.stringify({ branch, from: opts.from ?? null }) + '\n')
    })

  return git
}
