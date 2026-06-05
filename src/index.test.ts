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
      },
    }
  }),
}))

vi.mock('@octokit/graphql', () => ({
  graphql: Object.assign(vi.fn(), { defaults: vi.fn().mockReturnValue(vi.fn()) }),
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

  it('routes "epic create" through the GitHubTracker and prints JSON', async () => {
    const dir = join(tmpdir(), `fr-index-test-${Date.now()}`)
    const configPath = writeConfig(dir, `---\ntracker: github\nrepo: acme/proj\n---\n`)
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    vi.stubEnv('FLIGHT_RULES_CONFIG', configPath)

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { run } = await import('./index.js')
    await run(['epic', 'create', '--title', 'T', '--body', 'B'])

    expect(output).toHaveBeenCalledWith(expect.stringContaining('"id":"1"') as string)
    output.mockRestore()
  })
})
