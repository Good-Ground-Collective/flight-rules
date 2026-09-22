import { FileDocResolver, type DocResolver } from '../bundled-docs/doc-resolver/doc-resolver.js'
import { NodeGitExecutor, type GitExecutor } from '../git/git-executor/git-executor.js'
import { GhPullRequestHost } from '../pr/pull-request-host/gh-pull-request-host.js'
import type { PullRequestHost } from '../pr/pull-request-host/pull-request-host.js'
import { readConfig, resolveConfigPath, type Config } from '../shared/config.js'
import { EnvLoader } from '../shared/env.js'
import { GitHubTaskTracker } from '../tasks/github-task-tracker/github-task-tracker.js'
import { JiraTaskTracker } from '../tasks/jira-task-tracker/jira-task-tracker.js'
import type { TaskTracker } from '../tasks/task-tracker/task-tracker.js'
import { nodeToolProbe, type ToolProbe } from '../tasks/tool-probe/tool-probe.js'
import { FlightRulesPropsSchema, type FlightRulesProps } from './flight-rules.schema.js'

export interface FlightRules {
  configPath(): string
  config(overrideTracker?: string): Config
  tracker(overrideTracker?: string): TaskTracker
  prHost(overrideTracker?: string): PullRequestHost
  git(): GitExecutor
  probe(): ToolProbe
  docs(): DocResolver
}

/** Constructs services on demand so config and credentials are only required by their consumers. */
export class DefaultFlightRules implements FlightRules {
  private readonly cwd: string
  private readonly env: Record<string, string | undefined>
  private readonly explicitConfigPath: string | undefined

  constructor(props: FlightRulesProps = {}) {
    const parsed = FlightRulesPropsSchema.parse({ ...props, env: props.env === undefined ? undefined : { ...props.env } })
    this.cwd = parsed.cwd ?? process.cwd()
    // Keep the validated input reference: Zod clones records, hiding later environment changes.
    this.env = props.env ?? process.env
    this.explicitConfigPath = parsed.configPath
  }

  configPath(): string {
    return resolveConfigPath(this.cwd, this.explicitConfigPath ?? this.env['FLIGHT_RULES_CONFIG'])
  }

  config(overrideTracker?: string): Config {
    const configPath = this.configPath()
    const config = readConfig(configPath)
    if (overrideTracker === undefined) return config
    if (overrideTracker !== 'github' && overrideTracker !== 'jira') {
      throw new Error(`Invalid --tracker "${overrideTracker}" — expected "github" or "jira"`)
    }
    return { ...config, tracker: overrideTracker }
  }

  tracker(overrideTracker?: string): TaskTracker {
    const config = this.config(overrideTracker)
    const env = new EnvLoader().load(this.env)

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

  prHost(overrideTracker?: string): PullRequestHost {
    const config = this.config(overrideTracker)

    if (config.repo === undefined) {
      throw new Error('repo (owner/repo) is required in config to create pull requests')
    }

    // gh authenticates itself from its own keyring or GH_TOKEN/GITHUB_TOKEN.
    return new GhPullRequestHost({ repo: config.repo })
  }

  git(): GitExecutor {
    return new NodeGitExecutor()
  }

  probe(): ToolProbe {
    return nodeToolProbe
  }

  docs(): DocResolver {
    return FileDocResolver.fromInstall({ moduleUrl: import.meta.url, env: this.env })
  }
}

export function createFlightRules(props: FlightRulesProps = {}): FlightRules {
  return new DefaultFlightRules(props)
}
