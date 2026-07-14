import { describe, it, expect } from 'vitest'
import { normalizeJiraHost } from './jira-host.js'

describe('normalizeJiraHost', () => {
  it('passes a bare domain through unchanged', () => {
    expect(normalizeJiraHost('x.atlassian.net')).toBe('x.atlassian.net')
  })

  it('strips an https scheme and trailing slash', () => {
    expect(normalizeJiraHost('https://x.atlassian.net/')).toBe('x.atlassian.net')
  })

  it('strips an http scheme', () => {
    expect(normalizeJiraHost('http://x.atlassian.net')).toBe('x.atlassian.net')
  })

  it('strips surrounding whitespace and repeated trailing slashes', () => {
    expect(normalizeJiraHost(' https://x.atlassian.net// ')).toBe('x.atlassian.net')
  })
})
