#!/usr/bin/env node
import { join } from 'node:path'
import { Command, CommanderError } from 'commander'
import { readConfig } from './config.js'
import type { Config } from './config.js'
import { readEnv } from './env.js'
import { GitHubTaskTracker } from './tasks/github-task-tracker/github-task-tracker.js'
import { JiraTaskTracker } from './tasks/jira-task-tracker/jira-task-tracker.js'
import { createEpicCommand } from './tasks/commands/epic/command.js'
import { createInitiativeCommand } from './tasks/commands/initiative/command.js'
import { createTicketCommand } from './tasks/commands/ticket/command.js'
import { createTddCommand } from './tasks/commands/tdd/command.js'
import { createUsersCommand } from './tasks/commands/users/command.js'
import { createRfcCommand } from './tasks/commands/rfc/command.js'
import { createCompetenciesCommand } from './tasks/commands/competencies/command.js'
import { createCheckCommand } from './tasks/commands/check/command.js'
import type { TaskTracker } from './tasks/task-tracker/task-tracker.js'
import { NodeGitExecutor } from './git/git-executor/git-executor.js'
import { createGitCommand } from './git/commands/commit/command.js'
import { appVersion } from './version.js'

function buildTracker(overrideTracker?: string): TaskTracker {
  const config = getConfigFromEnv(overrideTracker)
  const env = readEnv()

  if (config.tracker === 'github') {
    if (env.githubToken === undefined) throw new Error('GITHUB_TOKEN environment variable is required')
    if (config.repo === undefined) throw new Error('repo is required when tracker is github')

    const [owner, repo] = config.repo.split('/')
    if (owner === undefined || repo === undefined) {
      throw new Error(`Invalid repo format "${config.repo}" — expected "owner/repo"`)
    }

    return new GitHubTaskTracker({ token: env.githubToken, owner, repo })
  }

  if (env.jiraToken === undefined) {
    throw new Error('JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY) environment variable is required')
  }
  if (env.jiraEmail === undefined) throw new Error('JIRA_EMAIL environment variable is required')

  const host = env.jiraHost ?? config.jiraHost
  if (host === undefined) throw new Error('JIRA_HOST environment variable or jiraHost config is required')
  if (config.jiraProject === undefined) throw new Error('jiraProject is required when tracker is jira')

  return new JiraTaskTracker({
    token: env.jiraToken,
    host,
    email: env.jiraEmail,
    project: config.jiraProject,
    ...(config.jpdProject !== undefined ? { jpdProject: config.jpdProject } : {}),
    ...(config.confluenceSpaceKey !== undefined ? { confluenceSpaceKey: config.confluenceSpaceKey } : {}),
  })
}

function getConfigFromEnv(overrideTracker?: string): Config {
  const configPath =
    process.env['FLIGHT_RULES_CONFIG'] ?? join(process.cwd(), '.claude', 'flight-rules.local.md')
  const config = readConfig(configPath)
  if (overrideTracker === undefined) return config
  if (overrideTracker !== 'github' && overrideTracker !== 'jira') {
    throw new Error(`Invalid --tracker "${overrideTracker}" — expected "github" or "jira"`)
  }
  return { ...config, tracker: overrideTracker }
}

export function buildProgram(
  getTracker: (overrideTracker?: string) => TaskTracker,
  getConfig: (overrideTracker?: string) => Config,
): Command {
  const program = new Command('flight-rules')
  program.version(appVersion)
  program.exitOverride()
  program.option('--tracker <tracker>', 'override the configured tracker for this run')

  let overrideTracker: string | undefined
  program.hook('preAction', () => {
    const value = program.opts()['tracker']
    overrideTracker = typeof value === 'string' ? value : undefined
  })

  const tracker = (): TaskTracker => getTracker(overrideTracker)
  const config = (): Config => getConfig(overrideTracker)

  program.addCommand(createEpicCommand(tracker))
  program.addCommand(createInitiativeCommand(tracker))
  program.addCommand(createTicketCommand(tracker))
  program.addCommand(createTddCommand(tracker))
  program.addCommand(createGitCommand(() => new NodeGitExecutor()))
  program.addCommand(createUsersCommand(tracker))
  program.addCommand(createRfcCommand(config))
  program.addCommand(createCompetenciesCommand(config))
  program.addCommand(createCheckCommand(config, tracker))
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
