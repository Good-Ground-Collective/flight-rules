import { z } from 'zod'
import { JiraHostSchema } from './tasks/jira-task-tracker/jira-host.js'

const EnvSchema = z.object({
  githubToken: z.string().optional(),
  jiraToken: z.string().optional(),
  jiraEmail: z.string().optional(),
  jiraHost: JiraHostSchema.optional(),
})

export type Env = z.infer<typeof EnvSchema>

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse({
    githubToken: source['GITHUB_TOKEN'],
    jiraToken: source['JIRA_TOKEN'] ?? source['JIRA_API_TOKEN'] ?? source['JIRA_API_KEY'],
    jiraEmail: source['JIRA_EMAIL'],
    jiraHost: source['JIRA_HOST'],
  })
}
