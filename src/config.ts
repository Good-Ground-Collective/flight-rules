import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

// Seed competency set for Sharpen-the-Saw candidacy — foundational skills worth
// keeping warm in human hands. Slugs double as the `sharpen-the-saw:<slug>` label
// suffix. Teams override via `competencies` in flight-rules.local.md.
export const seedCompetencies = [
  'define-a-schema',
  'wire-an-endpoint',
  'write-a-migration',
  'pure-transform',
  'write-a-query',
  'mapper-adapter',
  'harden-edge-cases',
  'business-rule',
  'external-api-client',
  'reducer-state',
  'async-coordination',
  'auth-check',
] as const

const ConfigSchema = z
  .object({
    tracker: z.enum(['github', 'jira']),
    repo: z.string().optional().describe('GitHub owner/repo; required when tracker is github'),
    jiraHost: z.string().optional().describe('Atlassian Cloud host, e.g. acme.atlassian.net'),
    jiraEmail: z.string().optional().describe('Atlassian account email for Basic auth'),
    jiraProject: z.string().optional().describe('Jira project key holding epics and tickets'),
    jpdProject: z.string().optional().describe('Jira Product Discovery project key holding initiatives'),
    confluenceSpaceKey: z.string().optional().describe('Confluence space key holding technical design docs'),
    defaultLabels: z.array(z.string()).default([]),
    rfcStorage: z.enum(['local', 'global']).default('local'),
    rfcStoragePath: z.string().optional(),
    competencies: z.array(z.string()).default([...seedCompetencies]),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.tracker === 'github' && cfg.repo === undefined) {
      ctx.addIssue({ code: 'custom', path: ['repo'], message: 'repo is required when tracker is github' })
    }
    if (cfg.tracker === 'jira') {
      ;(['jiraHost', 'jiraEmail', 'jiraProject'] as const).forEach((field) => {
        if (cfg[field] === undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when tracker is jira` })
        }
      })
    }
  })

export type Config = z.infer<typeof ConfigSchema>

function parseFrontmatter(contents: string): Record<string, unknown> {
  // Simple YAML frontmatter parser for this use case
  // Matches YAML frontmatter between --- delimiters
  const match = contents.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  if (!yaml) return {}
  const data: Record<string, unknown> = {}

  const lines = yaml.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined || !line.trim()) {
      i++
      continue
    }

    // Block sequence item — belongs to the previous key (handled below)
    if (line.match(/^\s+-\s/)) {
      i++
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      i++
      continue
    }

    const key = line.slice(0, colonIdx).trim()
    if (!key) {
      i++
      continue
    }
    const rawValue = line.slice(colonIdx + 1).trim()

    // Check if next lines are block sequence items
    const blockItems: string[] = []
    let j = i + 1
    while (j < lines.length) {
      const nextLine = lines[j]
      if (nextLine === undefined) break
      const blockMatch = nextLine.match(/^\s+-\s+(.*)$/)
      if (blockMatch) {
        const item = blockMatch[1]
        blockItems.push(item !== undefined ? item.trim().replace(/^["']|["']$/g, '') : '')
        j++
      } else {
        break
      }
    }

    if (blockItems.length > 0) {
      data[key] = blockItems
      i = j
      continue
    }

    // Parse YAML scalar values
    if (rawValue === 'true') data[key] = true
    else if (rawValue === 'false') data[key] = false
    else if (rawValue === 'null') data[key] = null
    else if (rawValue !== '' && !isNaN(Number(rawValue))) data[key] = Number(rawValue)
    else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      // Inline array parsing: [a, b, c]
      data[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    } else {
      data[key] = rawValue.replace(/^["']|["']$/g, '')
    }

    i++
  }

  return data
}

export function readConfig(configPath: string): Config {
  const contents = readFileSync(configPath, 'utf-8')
  const data = parseFrontmatter(contents)
  return ConfigSchema.parse(data)
}

export function getRfcDir(config: Config, cwd: string): string {
  if (config.rfcStorage === 'global') {
    if (config.rfcStoragePath === undefined) {
      throw new Error('rfcStoragePath is required when rfcStorage is global')
    }
    return config.rfcStoragePath
  }
  return join(cwd, 'rfcs')
}
