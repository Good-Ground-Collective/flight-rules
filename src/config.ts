import { readFileSync } from 'node:fs'
import { z } from 'zod'

const ConfigSchema = z.object({
  tracker: z.enum(['github', 'jira']),
  repo: z.string(),
  defaultLabels: z.array(z.string()).default([]),
})

export type Config = z.infer<typeof ConfigSchema>

function parseFrontmatter(contents: string): Record<string, unknown> {
  // Simple YAML frontmatter parser for this use case
  // Matches YAML frontmatter between --- delimiters
  const match = contents.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  const data: Record<string, unknown> = {}

  for (const line of yaml.split('\n')) {
    if (!line.trim()) continue
    const [key, ...valueParts] = line.split(':')
    if (!key) continue
    const value = valueParts.join(':').trim()

    // Parse YAML values
    if (value === 'true') data[key.trim()] = true
    else if (value === 'false') data[key.trim()] = false
    else if (value === 'null') data[key.trim()] = null
    else if (!isNaN(Number(value))) data[key.trim()] = Number(value)
    else if (value.startsWith('[') && value.endsWith(']')) {
      // Simple array parsing: [a, b, c]
      data[key.trim()] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    } else {
      data[key.trim()] = value.replace(/^["']|["']$/g, '')
    }
  }

  return data
}

export function readConfig(configPath: string): Config {
  const contents = readFileSync(configPath, 'utf-8')
  const data = parseFrontmatter(contents)
  return ConfigSchema.parse(data)
}
