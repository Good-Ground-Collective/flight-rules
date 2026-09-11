import { join } from 'node:path'
import { Command } from 'commander'
import { readConfig } from '../shared/config.js'
import type { Config } from '../shared/config.js'
import { EnvLoader } from '../shared/env.js'
import { GitHubTaskTracker } from '../tasks/github-task-tracker/github-task-tracker.js'
import { JiraTaskTracker } from '../tasks/jira-task-tracker/jira-task-tracker.js'
import { createEpicCommand } from '../tasks/commands/epic/command.js'
import { createInitiativeCommand } from '../tasks/commands/initiative/command.js'
import { createTicketCommand } from '../tasks/commands/ticket/command.js'
import { createTddCommand } from '../tasks/commands/tdd/command.js'
import { createUsersCommand } from '../tasks/commands/users/command.js'
import { createRfcCommand } from '../tasks/commands/rfc/command.js'
import { createCompetenciesCommand } from '../tasks/commands/competencies/command.js'
import { createCheckCommand } from '../tasks/commands/check/command.js'
import type { TaskTracker } from '../tasks/task-tracker/task-tracker.js'
import { NodeGitExecutor } from '../git/git-executor/git-executor.js'
import { createGitCommand } from '../git/commands/commit/command.js'
import type { PullRequestHost } from '../pr/pull-request-host/pull-request-host.js'
import { GhPullRequestHost } from '../pr/pull-request-host/gh-pull-request-host.js'
import { createPrCommand } from '../pr/commands/pr/command.js'
import { NodeToolProbe, type ToolProbe } from '../tasks/tool-probe/tool-probe.js'
import { appVersion } from '../version.js'

// eslint-disable-next-line preflight/no-loose-functions -- buildTracker is module-level behaviour awaiting a home on a service; tracked in KAN-39
function buildTracker(overrideTracker?: string): TaskTracker {
  const config = getConfigFromEnv(overrideTracker)
  // A loader per invocation: the cache is per-instance, and each CLI run must
  // observe the ambient environment as it stands now.
  const env = new EnvLoader().load()

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

// eslint-disable-next-line preflight/no-loose-functions -- buildPrHost is module-level behaviour awaiting a home on a service; tracked in KAN-39
function buildPrHost(overrideTracker?: string): PullRequestHost {
  const config = getConfigFromEnv(overrideTracker)

  if (config.repo === undefined) {
    throw new Error('repo (owner/repo) is required in config to create pull requests')
  }

  // gh authenticates itself from its own keyring or GH_TOKEN/GITHUB_TOKEN.
  return new GhPullRequestHost({ repo: config.repo })
}

// eslint-disable-next-line preflight/no-loose-functions -- resolveConfigPath is module-level behaviour awaiting a home on a service; tracked in KAN-39
function resolveConfigPath(): string {
  return process.env['FLIGHT_RULES_CONFIG'] ?? join(process.cwd(), '.claude', 'flight-rules.local.md')
}

// eslint-disable-next-line preflight/no-loose-functions -- getConfigFromEnv is module-level behaviour awaiting a home on a service; tracked in KAN-39
function getConfigFromEnv(overrideTracker?: string): Config {
  const config = readConfig(resolveConfigPath())
  if (overrideTracker === undefined) return config
  if (overrideTracker !== 'github' && overrideTracker !== 'jira') {
    throw new Error(`Invalid --tracker "${overrideTracker}" — expected "github" or "jira"`)
  }
  return { ...config, tracker: overrideTracker }
}

export function buildProgram(
  getTracker: (overrideTracker?: string) => TaskTracker,
  getConfig: (overrideTracker?: string) => Config,
  getPrHost: (overrideTracker?: string) => PullRequestHost,
  getConfigPath: () => string = resolveConfigPath,
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
  const prHost = (): PullRequestHost => getPrHost(overrideTracker)

  program.addCommand(createEpicCommand(tracker))
  program.addCommand(createInitiativeCommand(tracker))
  program.addCommand(createTicketCommand(tracker))
  program.addCommand(createTddCommand(tracker))
  program.addCommand(createGitCommand(() => new NodeGitExecutor()))
  program.addCommand(createPrCommand(prHost))
  program.addCommand(createUsersCommand(tracker))
  program.addCommand(createRfcCommand(config))
  program.addCommand(createCompetenciesCommand(config))
  const probe = (): ToolProbe => new NodeToolProbe()
  program.addCommand(createCheckCommand(config, tracker, getConfigPath, probe))
  return program
}

// eslint-disable-next-line preflight/no-loose-functions -- run is module-level behaviour awaiting a home on a service; tracked in KAN-39
export async function run(argv: string[]): Promise<void> {
  await buildProgram(buildTracker, getConfigFromEnv, buildPrHost, resolveConfigPath).parseAsync(argv, {
    from: 'user',
  })
}
