import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFlightRules, DefaultFlightRules } from '../flight-rules.js'
import { GitHubTaskTracker } from '../../tasks/github-task-tracker/github-task-tracker.js'
import { JiraTaskTracker } from '../../tasks/jira-task-tracker/jira-task-tracker.js'
import { GhPullRequestHost } from '../../pr/pull-request-host/gh-pull-request-host.js'
import { NodeGitExecutor } from '../../git/git-executor/git-executor.js'
import { nodeToolProbe } from '../../tasks/tool-probe/tool-probe.js'

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn().mockImplementation(function () { return {} }) }))
vi.mock('@octokit/graphql', () => ({
  graphql: Object.assign(vi.fn(), { defaults: vi.fn().mockReturnValue(vi.fn()) }),
}))
vi.mock('../../tasks/jira-task-tracker/jira-client.js', () => ({
  JiraClient: class { request = vi.fn() },
}))

let cwd: string
const configText = (tracker: string, repo = 'acme/proj'): string =>
  `---\ntracker: ${tracker}\nrepo: ${repo}\njiraHost: acme.atlassian.net\njiraEmail: me@acme.com\njiraProject: PROJ\n---\n`
const writeConfig = (tracker = 'github', repo = 'acme/proj'): string => {
  const directory = join(cwd, '.claude')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'flight-rules.local.md')
  writeFileSync(path, configText(tracker, repo))
  return path
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'fr-core-'))
  // Keep the developer's own ~/.claude/settings.json out of every merge.
  vi.stubEnv('HOME', join(cwd, 'home'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('createFlightRules', () => {
  it('constructs without accessing config or credentials', () => {
    // An empty user settings dir keeps the developer's own settings out of the merge.
    const core = createFlightRules({ cwd: join(cwd, 'missing'), env: { CLAUDE_CONFIG_DIR: join(cwd, 'no-user-settings') } })
    expect(core).toBeInstanceOf(DefaultFlightRules)
    expect(() => core.config()).toThrow('No flight-rules config found')
    expect(() => core.tracker()).toThrow('No flight-rules config found')
    expect(() => core.prHost()).toThrow('No flight-rules config found')
  })

  it.each(['github', 'jira'])('honors overrides on a %s config', (tracker) => {
    writeConfig(tracker)
    const core = createFlightRules({ cwd, env: {
      GITHUB_TOKEN: 'gh-token', JIRA_TOKEN: 'jira-token', JIRA_EMAIL: 'me@acme.com',
    } })
    expect(core.tracker('github')).toBeInstanceOf(GitHubTaskTracker)
    expect(core.tracker('jira')).toBeInstanceOf(JiraTaskTracker)
    expect(() => core.tracker('other')).toThrow('Invalid --tracker "other" — expected "github" or "jira"')
  })

  it('reports the credential required by the overridden tracker', () => {
    writeConfig()
    expect(() => createFlightRules({ cwd, env: { GITHUB_TOKEN: 't' } }).tracker('jira'))
      .toThrow('JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY) environment variable is required')
    writeConfig('jira')
    expect(() => createFlightRules({ cwd, env: { JIRA_TOKEN: 't', JIRA_EMAIL: 'me@acme.com' } }).tracker('github'))
      .toThrow('GITHUB_TOKEN environment variable is required')
  })

  it('observes credentials added, changed and removed from the injected environment', () => {
    writeConfig()
    const env: Record<string, string | undefined> = {}
    const core = createFlightRules({ cwd, env })
    expect(() => core.tracker()).toThrow('GITHUB_TOKEN environment variable is required')
    env['GITHUB_TOKEN'] = 'first'
    const first = core.tracker()
    expect(first).toBeInstanceOf(GitHubTaskTracker)
    env['GITHUB_TOKEN'] = 'second'
    expect(core.tracker()).not.toBe(first)
    delete env['GITHUB_TOKEN']
    expect(() => core.tracker()).toThrow('GITHUB_TOKEN environment variable is required')
  })

  it('re-reads config for every config, tracker and PR host call', () => {
    const path = writeConfig()
    const core = createFlightRules({ cwd, env: { GITHUB_TOKEN: 't', CLAUDE_CONFIG_DIR: join(cwd, 'no-user-settings') } })
    expect(core.config().repo).toBe('acme/proj')
    expect(core.tracker()).toBeInstanceOf(GitHubTaskTracker)
    expect(core.prHost()).toBeInstanceOf(GhPullRequestHost)
    writeConfig('github', 'acme/changed')
    expect(core.config().repo).toBe('acme/changed')
    rmSync(path)
    expect(() => core.config()).toThrow('No flight-rules config found')
    expect(() => core.tracker()).toThrow('No flight-rules config found')
    expect(() => core.prHost()).toThrow('No flight-rules config found')
  })

  it('resolves config paths with explicit props before live env before cwd discovery', () => {
    const discovered = writeConfig()
    const env = { FLIGHT_RULES_CONFIG: 'env.md' }
    expect(createFlightRules({ cwd, env, configPath: 'explicit.md' }).configPath()).toBe(join(cwd, 'explicit.md'))
    const core = createFlightRules({ cwd, env })
    expect(core.configPath()).toBe(join(cwd, 'env.md'))
    env.FLIGHT_RULES_CONFIG = 'changed.md'
    expect(core.configPath()).toBe(join(cwd, 'changed.md'))
    expect(createFlightRules({ cwd, env: {} }).configPath()).toBe(discovered)
  })

  it('supports both default and explicitly injected native process.env', () => {
    const path = writeConfig()
    vi.stubEnv('FLIGHT_RULES_CONFIG', path)
    for (const core of [createFlightRules(), createFlightRules({ env: process.env })]) {
      expect(core.configPath()).toBe(path)
      expect(core.config().repo).toBe('acme/proj')
    }
  })

  it('provides git, probe and docs without requiring config', () => {
    const env = { FLIGHT_RULES_HOME: cwd }
    const core = createFlightRules({ cwd, env })
    mkdirSync(join(cwd, 'docs'))
    writeFileSync(join(cwd, 'docs', 'example.md'), 'Example')
    expect(core.git()).toBeInstanceOf(NodeGitExecutor)
    expect(core.probe()).toBe(nodeToolProbe)
    expect(core.docs().resolve('example').contents).toBe('Example')
    env.FLIGHT_RULES_HOME = join(cwd, 'missing')
    expect(() => core.docs()).toThrow('does not exist or is not a directory')
  })
})

describe('board', () => {
  it('reads only the ariadne keys, so a repo without a tracker config can still report', () => {
    mkdirSync(join(cwd, '.claude'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'flight-rules.local.md'), '---\nariadne.url: http://localhost:8080\nariadne.enabled: false\n---\n')
    const core = createFlightRules({ cwd, env: { CLAUDE_CONFIG_DIR: join(cwd, 'no-user-settings') } })
    expect(() => core.config()).toThrow()
    expect(core.board().settings()).toEqual({ url: 'http://localhost:8080', enabled: false })
  })

  it('skips silently with no config and no token', async () => {
    const env = { CLAUDE_CONFIG_DIR: join(cwd, 'no-user-settings'), CLAUDE_CODE_SESSION_ID: 's1' }
    const outcome = await createFlightRules({ cwd, env }).board().heartbeat({ ticket: 'FRT-1', step: 'pr', state: 'nominal' })
    expect(outcome).toEqual({ status: 'skipped', reason: 'no-token' })
  })
})
