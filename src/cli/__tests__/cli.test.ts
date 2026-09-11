import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      rest: {
        issues: {
          create: vi.fn().mockResolvedValue({
            data: {
              number: 1,
              state: 'open',
              labels: [],
              title: 'T',
              body: 'B',
              updated_at: '2026-01-01T00:00:00Z',
              assignee: null,
            },
          }),
        },
        repos: {
          get: vi.fn().mockResolvedValue({ data: { full_name: 'acme/proj' } }),
        },
      },
    }
  }),
}))

vi.mock('@octokit/graphql', () => ({
  graphql: Object.assign(vi.fn(), { defaults: vi.fn().mockReturnValue(vi.fn()) }),
}))

vi.mock('../../tasks/jira-task-tracker/jira-client.js', () => ({
  JiraClient: class {
    request = vi.fn().mockResolvedValue({ accountId: 'acct-1' })
  },
}))

const writeConfig = (dir: string, content: string): string => {
  const claudeDir = join(dir, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  const filePath = join(claudeDir, 'flight-rules.local.md')
  writeFileSync(filePath, content)
  return filePath
}

describe('run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('routes "epic create" through the tracker and prints JSON', async () => {
    const dir = join(tmpdir(), `fr-cli-test-${Date.now()}`)
    const configPath = writeConfig(dir, `---\ntracker: github\nrepo: acme/proj\n---\n`)
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    vi.stubEnv('FLIGHT_RULES_CONFIG', configPath)

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('../cli.js')
    await run(['epic', 'create', '--title', 'T', '--body', 'B'])

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"id":"1"') as string)
    output.mockRestore()
  })

  it('does not require GITHUB_TOKEN to show help', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('../cli.js')
    // program-level exitOverride makes --help reject rather than process.exit
    await expect(run(['--help'])).rejects.toThrow()
  })

  it('builds a JiraTaskTracker for a jira config so check passes', async () => {
    const dir = join(tmpdir(), `fr-cli-jira-${Date.now()}`)
    const configPath = writeConfig(
      dir,
      `---\ntracker: jira\njiraHost: acme.atlassian.net\njiraEmail: me@acme.com\njiraProject: PROJ\n---\n`,
    )
    vi.stubEnv('JIRA_TOKEN', 'jira-token')
    vi.stubEnv('JIRA_EMAIL', 'me@acme.com')
    vi.stubEnv('FLIGHT_RULES_CONFIG', configPath)

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('../cli.js')
    await run(['check'])

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"tracker":"jira"') as string)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"ok":true') as string)
    output.mockRestore()
  })

  it('honors --tracker to override the configured tracker for one run', async () => {
    const dir = join(tmpdir(), `fr-cli-override-${Date.now()}`)
    const configPath = writeConfig(
      dir,
      `---\ntracker: jira\njiraHost: acme.atlassian.net\njiraEmail: me@acme.com\njiraProject: PROJ\nrepo: acme/proj\n---\n`,
    )
    vi.stubEnv('GITHUB_TOKEN', 'gh-token')
    vi.stubEnv('FLIGHT_RULES_CONFIG', configPath)

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('../cli.js')
    // The configured repo doesn't exist on GitHub, so the real tool probe's
    // gh-push check legitimately fails here — this test only cares that the
    // override routed `check` to the github tracker, not that the probe passed.
    await run(['--tracker', 'github', 'check']).catch(() => undefined)

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"tracker":"github"') as string)
    output.mockRestore()
  })
})
