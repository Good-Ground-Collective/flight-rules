import { readFileSync } from 'node:fs'
import matter from 'gray-matter'
import { z } from 'zod'

const ConfigSchema = z.object({
  tracker: z.enum(['github', 'jira']),
  repo: z.string(),
  defaultLabels: z.array(z.string()).default([]),
})

export type Config = z.infer<typeof ConfigSchema>

export function readConfig(configPath: string): Config {
  const contents = readFileSync(configPath, 'utf-8')
  const { data } = matter(contents)
  return ConfigSchema.parse(data)
}
