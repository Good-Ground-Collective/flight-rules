import { describe, it, expect } from 'vitest'
import { readEnv } from './env.js'

describe('readEnv', () => {
  it('extracts the primary credential variables', () => {
    const env = readEnv({
      GITHUB_TOKEN: 'gh',
      JIRA_TOKEN: 'jt',
      JIRA_EMAIL: 'me@acme.com',
      JIRA_HOST: 'acme.atlassian.net',
    })
    expect(env).toEqual({
      githubToken: 'gh',
      jiraToken: 'jt',
      jiraEmail: 'me@acme.com',
      jiraHost: 'acme.atlassian.net',
    })
  })

  it('falls back to JIRA_API_TOKEN then JIRA_API_KEY for the jira token', () => {
    expect(readEnv({ JIRA_API_TOKEN: 'from-api-token' }).jiraToken).toBe('from-api-token')
    expect(readEnv({ JIRA_API_KEY: 'from-api-key' }).jiraToken).toBe('from-api-key')
  })

  it('prefers JIRA_TOKEN over its aliases', () => {
    expect(readEnv({ JIRA_TOKEN: 'primary', JIRA_API_TOKEN: 'alias', JIRA_API_KEY: 'alias2' }).jiraToken).toBe('primary')
  })

  it('leaves credentials undefined when nothing is set', () => {
    expect(readEnv({})).toEqual({})
  })
})
