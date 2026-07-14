import { describe, it, expect } from 'vitest'
import { JiraHostSchema } from './jira-host.js'

describe('JiraHostSchema', () => {
  it('passes a bare domain through unchanged', () => {
    expect(JiraHostSchema.parse('x.atlassian.net')).toBe('x.atlassian.net')
  })

  it('strips an https scheme and trailing slash', () => {
    expect(JiraHostSchema.parse('https://x.atlassian.net/')).toBe('x.atlassian.net')
  })

  it('strips an http scheme', () => {
    expect(JiraHostSchema.parse('http://x.atlassian.net')).toBe('x.atlassian.net')
  })

  it('strips surrounding whitespace and repeated trailing slashes', () => {
    expect(JiraHostSchema.parse(' https://x.atlassian.net// ')).toBe('x.atlassian.net')
  })
})
