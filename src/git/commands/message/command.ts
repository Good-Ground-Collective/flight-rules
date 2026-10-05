import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { branchNamer } from '../../branch-namer/branch-namer.js'
import { DefaultCommitMessageBuilder } from '../../commit-message-builder/commit-message-builder.js'
import { CommitMessageInputSchema } from '../../commit-message-builder/commit-message.schema.js'
import { semanticTypes } from '../../semantic-types.js'

type CommitMessageOptions = {
  type: string
  scope: string
  description: string
  body?: string
  bodyFile?: string
  footer: string[]
  model?: string
  out?: string
}

type BranchNameOptions = {
  type: string
  scope: string
  description?: string
}

/**
 * `commit-message` and `branch-name` produce what `git commit` and
 * `git checkout` would use without running git, for harnesses that only let
 * an agent run git directly (for example a worktree-isolated session).
 */
export function createCommitMessageCommand(): Command {
  return new Command('commit-message')
    .description('write the conventional commit message `flight-rules git commit` would use to a file, without committing')
    .exitOverride()
    .requiredOption('--type <type>', 'conventional commit type')
    .requiredOption('--scope <scope>', 'conventional commit scope')
    .requiredOption('--description <description>', 'commit description')
    .option('--body <body>', 'commit body (or use --body-file)')
    .option('--body-file <path>', 'read the commit body from a file; wins over --body')
    .option('--footer <footer>', 'commit footer (repeatable)', (value: string, previous: string[]) => [...previous, value], [])
    .option('--model <model>', 'model identifier')
    .option('--out <path>', 'where to write the message; defaults to a new file in the temp directory')
    .action((opts: CommitMessageOptions) => {
      const input = CommitMessageInputSchema.parse({
        type: opts.type,
        scope: opts.scope,
        description: opts.description,
        body: opts.bodyFile !== undefined ? readFileSync(opts.bodyFile, 'utf8') : opts.body,
        footers: opts.footer,
        model: opts.model,
      })
      const message = new DefaultCommitMessageBuilder({
        binPath: process.argv[1] ?? '',
        agentEnv: process.env['AI_AGENT'],
      }).build(input)
      const path = opts.out ?? join(mkdtempSync(join(tmpdir(), 'flight-rules-commit-')), 'message.txt')
      writeFileSync(path, `${message}\n`)
      process.stdout.write(JSON.stringify({ path, message }) + '\n')
    })
}

export function createBranchNameCommand(): Command {
  return new Command('branch-name')
    .description('print the conventional branch name `flight-rules git checkout` would create, without running git')
    .exitOverride()
    .requiredOption('--type <type>', `branch type (${semanticTypes.join(' | ')})`)
    .requiredOption('--scope <scope>', 'ticket number / scope')
    .option('--description <description>', 'short readable slug')
    .action((opts: BranchNameOptions) => {
      const branch = branchNamer.name({
        type: opts.type,
        scope: opts.scope,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
      })
      process.stdout.write(JSON.stringify({ branch }) + '\n')
    })
}
