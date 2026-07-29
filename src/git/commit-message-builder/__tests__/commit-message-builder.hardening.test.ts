import { describe, it, expect, vi, beforeEach } from 'vitest'
import { semanticTypes } from '../../semantic-types.js'
import { CommitMessageInputSchema, DefaultCommitMessageBuilder } from '../commit-message-builder.js'
import type { CommitMessageBuilderProps } from '../commit-message.schema.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.2.3' })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const validInput = {
  type: 'feat',
  scope: 'cli',
  description: 'add thing',
  footers: [],
}

describe('CommitMessageInputSchema', () => {
  it('is exported from the commit-message-builder module', () => {
    expect(CommitMessageInputSchema).toBeDefined()
  })

  it('accepts a fully-populated commit input', () => {
    const result = CommitMessageInputSchema.safeParse({
      ...validInput,
      body: 'because reasons',
      footers: ['Reviewed-By: alice'],
      model: 'claude-sonnet-5',
    })
    expect(result.success).toBe(true)
  })

  it('accepts every semantic type', () => {
    for (const type of semanticTypes) {
      expect(CommitMessageInputSchema.safeParse({ ...validInput, type }).success).toBe(true)
    }
  })

  it('rejects a type outside the semantic-types vocabulary', () => {
    expect(CommitMessageInputSchema.safeParse({ ...validInput, type: 'bogus' }).success).toBe(false)
  })

  it('rejects an empty scope', () => {
    expect(CommitMessageInputSchema.safeParse({ ...validInput, scope: '' }).success).toBe(false)
  })

  it('rejects an empty description', () => {
    expect(CommitMessageInputSchema.safeParse({ ...validInput, description: '' }).success).toBe(false)
  })

  it('defaults footers to an empty array when omitted', () => {
    const result = CommitMessageInputSchema.safeParse({ type: 'feat', scope: 'cli', description: 'add thing' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.footers).toEqual([])
  })
})

describe('DefaultCommitMessageBuilder props-object constructor', () => {
  it('builds the full message from a single props object', () => {
    const builder = new DefaultCommitMessageBuilder({ binPath: '/x/bin/flight-rules', agentEnv: '' })
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
    const builder = new DefaultCommitMessageBuilder({
      binPath: '/x/bin/flight-rules',
      agentEnv: 'claude-code_2-1-165_agent',
    })
    const msg = builder.build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).toContain('Harness-Version: claude-code@2.1.165')
  })

  it('works when agentEnv is omitted from the props object', () => {
    const builder = new DefaultCommitMessageBuilder({ binPath: '/x/bin/flight-rules' })
    const msg = builder.build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).toBe('feat(cli): add thing\n\nFlight-Rules-Version: 1.2.3')
    expect(msg).not.toContain('Harness-Version')
  })

  it('rejects construction from a props object missing binPath', () => {
    expect(() => new DefaultCommitMessageBuilder({} as CommitMessageBuilderProps)).toThrow()
  })

  it('rejects construction from a non-object', () => {
    expect(() => new DefaultCommitMessageBuilder(null as unknown as CommitMessageBuilderProps)).toThrow()
  })
})
