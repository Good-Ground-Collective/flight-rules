import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCheckCommand } from './command.js'
import type { Config } from '../../../config.js'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

const config: Config = {
  tracker: 'github',
  repo: 'acme/proj',
  defaultLabels: [],
  rfcStorage: 'local',
  competencies: [],
}

const makeTracker = (
  ping: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
): Pick<TaskTracker, 'ping'> => ({ ping })

const run = (getConfig: () => Config, tracker: Pick<TaskTracker, 'ping'>) =>
  createCheckCommand(getConfig, () => tracker as TaskTracker)
    .exitOverride()
    .parseAsync([], { from: 'user' })

const lastJson = (output: ReturnType<typeof vi.spyOn>) =>
  JSON.parse(String(vi.mocked(output).mock.calls[0]?.[0])) as {
    tracker: string | null
    repo: string | null
    ok: boolean
    checks: { name: string; ok: boolean; detail: string }[]
  }

describe('check command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('reports all-ok when config, credentials, and reachability pass', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok')
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(() => config, makeTracker())
    const parsed = lastJson(output)
    expect(parsed.ok).toBe(true)
    expect(parsed.tracker).toBe('github')
    expect(parsed.repo).toBe('acme/proj')
    expect(parsed.checks.every((c) => c.ok)).toBe(true)
    output.mockRestore()
  })

  it('fails and throws when GITHUB_TOKEN is missing', async () => {
    vi.stubEnv('GITHUB_TOKEN', undefined)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const ping = vi.fn().mockResolvedValue(undefined)
    await expect(run(() => config, makeTracker(ping))).rejects.toThrow('check failed')
    const parsed = lastJson(output)
    expect(parsed.ok).toBe(false)
    expect(parsed.checks.find((c) => c.name === 'credentials')?.ok).toBe(false)
    expect(ping).not.toHaveBeenCalled() // probe skipped when creds missing
    output.mockRestore()
  })

  it('fails and throws when the tracker is unreachable', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok')
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const tracker = makeTracker(vi.fn().mockRejectedValue(new Error('Not Found')))
    await expect(run(() => config, tracker)).rejects.toThrow('check failed')
    const parsed = lastJson(output)
    expect(parsed.ok).toBe(false)
    expect(parsed.checks.find((c) => c.name === 'reachable')?.detail).toContain('Not Found')
    output.mockRestore()
  })
})

const jiraConfig: Config = {
  tracker: 'jira',
  jiraHost: 'acme.atlassian.net',
  jiraEmail: 'me@acme.com',
  jiraProject: 'PROJ',
  defaultLabels: [],
  rfcStorage: 'local',
  competencies: [],
}

describe('check command (jira)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('reports all-ok when JIRA_TOKEN is present and the probe succeeds', async () => {
    vi.stubEnv('JIRA_TOKEN', 'tok')
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(() => jiraConfig, makeTracker())
    const parsed = lastJson(output)
    expect(parsed.ok).toBe(true)
    expect(parsed.tracker).toBe('jira')
    output.mockRestore()
  })

  it('fails and skips the probe when JIRA_TOKEN is missing', async () => {
    vi.stubEnv('JIRA_TOKEN', undefined)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const ping = vi.fn().mockResolvedValue(undefined)
    await expect(run(() => jiraConfig, makeTracker(ping))).rejects.toThrow('check failed')
    const parsed = lastJson(output)
    expect(parsed.ok).toBe(false)
    expect(parsed.checks.find((c) => c.name === 'credentials')?.ok).toBe(false)
    expect(parsed.checks.find((c) => c.name === 'credentials')?.detail).toContain('JIRA_TOKEN')
    expect(ping).not.toHaveBeenCalled()
    output.mockRestore()
  })
})
