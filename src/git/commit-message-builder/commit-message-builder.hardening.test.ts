import { describe, it, expect, vi, beforeEach } from 'vitest'
import { semanticTypes } from '../semantic-types.js'
import type { CommitMessageBuilder } from './commit-message-builder.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.2.3' })),
}))

/**
 * KAN-29 contract: commit input is validated by a Zod schema exported from
 * this module, and the builder takes a single Zod-validated props object
 * (coding charter M-5/M-6) instead of positional arguments.
 */
type BuilderProps = { binPath: string; agentEnv?: string | undefined }
type BuilderPropsCtor = new (props: BuilderProps) => CommitMessageBuilder
type InputSchema = {
  safeParse(value: unknown): { success: boolean }
}

let mod: Record<string, unknown>

beforeEach(async () => {
  vi.clearAllMocks()
  mod = (await import('./commit-message-builder.js')) as unknown as Record<string, unknown>
})

const schema = (): InputSchema => mod['CommitMessageInputSchema'] as InputSchema
const builderClass = (): BuilderPropsCtor => mod['DefaultCommitMessageBuilder'] as BuilderPropsCtor

const validInput = {
  type: 'feat',
  scope: 'cli',
  description: 'add thing',
  footers: [],
}

describe('CommitMessageInputSchema', () => {
  it('is exported from the commit-message-builder module', () => {
    expect(schema()).toBeDefined()
  })

  it('accepts a fully-populated commit input', () => {
    const result = schema().safeParse({
      ...validInput,
      body: 'because reasons',
      footers: ['Reviewed-By: alice'],
      model: 'claude-sonnet-5',
    })
    expect(result.success).toBe(true)
  })

  it('accepts every semantic type', () => {
    for (const type of semanticTypes) {
      expect(schema().safeParse({ ...validInput, type }).success).toBe(true)
    }
  })

  it('rejects a type outside the semantic-types vocabulary', () => {
    expect(schema().safeParse({ ...validInput, type: 'bogus' }).success).toBe(false)
  })

  it('rejects an empty scope', () => {
    expect(schema().safeParse({ ...validInput, scope: '' }).success).toBe(false)
  })

  it('rejects an empty description', () => {
    expect(schema().safeParse({ ...validInput, description: '' }).success).toBe(false)
  })

  it('defaults footers to an empty array when omitted', () => {
    const result = schema().safeParse({ type: 'feat', scope: 'cli', description: 'add thing' }) as {
      success: boolean
      data?: { footers?: string[] }
    }
    expect(result.success).toBe(true)
    expect(result.data?.footers).toEqual([])
  })
})

describe('DefaultCommitMessageBuilder props-object constructor', () => {
  it('builds the full message from a single props object', () => {
    const builder = new (builderClass())({ binPath: '/x/bin/flight-rules', agentEnv: '' })
    const msg = builder.build({
      type: 'feat',
      scope: 'cli',
      description: 'add thing',
      body: 'because reasons',
      footers: ['Reviewed-By: alice'],
      model: 'claude-sonnet-5',
    })
    expect(msg).toBe(
      'feat(cli): add thing\n\nbecause reasons\n\nReviewed-By: alice\nFlight-Rules-Version: 1.2.3\nModel-Used: claude-sonnet-5',
    )
  })

  it('parses the agent env from props into a Harness-Version trailer', () => {
    const builder = new (builderClass())({
      binPath: '/x/bin/flight-rules',
      agentEnv: 'claude-code_2-1-165_agent',
    })
    const msg = builder.build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).toContain('Harness-Version: claude-code@2.1.165')
  })

  it('works when agentEnv is omitted from the props object', () => {
    const builder = new (builderClass())({ binPath: '/x/bin/flight-rules' })
    const msg = builder.build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).toBe('feat(cli): add thing\n\nFlight-Rules-Version: 1.2.3')
    expect(msg).not.toContain('Harness-Version')
  })

  it('rejects construction from a props object missing binPath', () => {
    expect(() => new (builderClass())({} as BuilderProps)).toThrow()
  })

  it('rejects construction from a non-object', () => {
    expect(() => new (builderClass())(null as unknown as BuilderProps)).toThrow()
  })
})
