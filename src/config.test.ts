import { describe, it, expect } from 'vitest'
import { readConfig } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const setupFixture = (content: string): string => {
  const dir = join(tmpdir(), `flight-rules-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, 'flight-rules.local.md')
  writeFileSync(filePath, content)
  return filePath
}

describe('readConfig', () => {
  it('parses a valid github config', () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
defaultLabels:
  - engineering
---
`)
    const config = readConfig(filePath)
    expect(config.tracker).toBe('github')
    expect(config.repo).toBe('acme/my-project')
    expect(config.defaultLabels).toEqual(['engineering'])
  })

  it('defaults defaultLabels to empty array when omitted', () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
---
`)
    const config = readConfig(filePath)
    expect(config.defaultLabels).toEqual([])
  })

  it('throws ZodError for invalid tracker value', () => {
    const filePath = setupFixture(`---
tracker: notion
repo: acme/my-project
---
`)
    expect(() => readConfig(filePath)).toThrow()
  })
})
