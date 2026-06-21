#!/usr/bin/env node
import { join } from 'node:path'
import { Command, CommanderError } from 'commander'
import { readConfig } from './config.js'
import type { Config } from './config.js'
import { GitHubTaskTracker } from './tasks/github-task-tracker/github-task-tracker.js'
import { createEpicCommand } from './tasks/commands/epic/command.js'
import { createTicketCommand } from './tasks/commands/ticket/command.js'
import { createTddCommand } from './tasks/commands/tdd/command.js'
import { createUsersCommand } from './tasks/commands/users/command.js'
import { createRfcCommand } from './tasks/commands/rfc/command.js'
import type { TaskTracker } from './tasks/task-tracker/task-tracker.js'
import { NodeGitExecutor } from './git/git-executor/git-executor.js'
import { createGitCommand } from './git/commands/commit/command.js'

function buildTracker(): TaskTracker {
  const configPath =
    process.env['FLIGHT_RULES_CONFIG'] ?? join(process.cwd(), '.claude', 'flight-rules.local.md')
  const config = readConfig(configPath)

  if (config.tracker === 'github') {
    const token = process.env['GITHUB_TOKEN']
    if (token === undefined) throw new Error('GITHUB_TOKEN environment variable is required')
    const parts = config.repo.split('/')
    const owner = parts[0]
    const repo = parts[1]
    if (owner === undefined || repo === undefined) {
      throw new Error(`Invalid repo format "${config.repo}" — expected "owner/repo"`)
    }
    return new GitHubTaskTracker({ token, owner, repo })
  }

  throw new Error(`Unsupported tracker: ${config.tracker}`)
}

function getConfigFromEnv(): Config {
  const configPath =
    process.env['FLIGHT_RULES_CONFIG'] ?? join(process.cwd(), '.claude', 'flight-rules.local.md')
  return readConfig(configPath)
}

export function buildProgram(
  getTracker: () => TaskTracker,
  getConfig: () => Config,
): Command {
  const program = new Command('flight-rules')
  program.exitOverride()
  program.addCommand(createEpicCommand(getTracker))
  program.addCommand(createTicketCommand(getTracker))
  program.addCommand(createTddCommand(getTracker))
  program.addCommand(createGitCommand(() => new NodeGitExecutor()))
  program.addCommand(createUsersCommand(getTracker))
  program.addCommand(createRfcCommand(getConfig))
  return program
}

export async function run(argv: string[]): Promise<void> {
  await buildProgram(buildTracker, getConfigFromEnv).parseAsync(argv, { from: 'user' })
}

const isMain =
  process.argv[1]?.endsWith('flight-rules') === true || process.argv[1]?.endsWith('cli.js') === true

if (isMain) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    if (err instanceof CommanderError) {
      // Commander already wrote help/usage/error output; just honor its exit code.
      process.exit(err.exitCode)
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
