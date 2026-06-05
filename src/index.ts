#!/usr/bin/env node
import { join } from 'node:path'
import { readConfig } from './config.js'
import { GitHubTracker } from './task-tracker/github/github-tracker.js'
import { runEpicCommand } from './commands/epic.js'
import { runTicketCommand } from './commands/ticket.js'
import { runTddCommand } from './commands/tdd.js'
import type { TaskTracker } from './task-tracker/types.js'

function buildTracker(): TaskTracker {
  const configPath =
    process.env['FLIGHT_RULES_CONFIG'] ??
    join(process.cwd(), '.claude', 'flight-rules.local.md')
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
    return new GitHubTracker({ token, owner, repo })
  }

  throw new Error(`Unsupported tracker: ${config.tracker}`)
}

export async function run(args: string[]): Promise<void> {
  const command = args[0]
  const rest = args.slice(1)
  const tracker = buildTracker()

  if (command === 'epic') { await runEpicCommand(rest, tracker); return }
  if (command === 'ticket') { await runTicketCommand(rest, tracker); return }
  if (command === 'tdd') { await runTddCommand(rest, tracker); return }

  process.stderr.write(
    `Unknown command: ${command ?? '(none)'}\nUsage: flight-rules <epic|ticket|tdd> <subcommand> [flags]\n`,
  )
  process.exit(1)
}

const isMain =
  process.argv[1]?.endsWith('flight-rules') === true ||
  process.argv[1]?.endsWith('index.js') === true

if (isMain) {
  run(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
