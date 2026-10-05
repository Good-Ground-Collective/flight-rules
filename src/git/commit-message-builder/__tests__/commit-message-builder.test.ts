import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CommitMessageInput } from '../commit-message.schema.js'
import type { DefaultCommitMessageBuilder } from '../commit-message-builder.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.2.3' })),
}))

let commitMessageBuilderClass: typeof DefaultCommitMessageBuilder

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../commit-message-builder.js')
  commitMessageBuilderClass = mod.DefaultCommitMessageBuilder
})

const build = (input: CommitMessageInput, agentEnv: string | undefined = ''): string =>
  new commitMessageBuilderClass({ binPath: '/x/bin/flight-rules', agentEnv }).build(input)

describe('DefaultCommitMessageBuilder.build', () => {
  it('builds subject + footers with no body, reading plugin version from package.json', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).toBe('feat(cli): add thing\n\nFlight-Rules-Version: 1.2.3')
  })

  it('includes body between subject and footers', () => {
    const msg = build({ type: 'fix', scope: 'core', description: 'fix bug', body: 'extra context here', footers: [] })
    expect(msg).toBe('fix(core): fix bug\n\nextra context here\n\nFlight-Rules-Version: 1.2.3')
  })

  it('keeps a multi-paragraph body intact and trims its surrounding blank lines', () => {
    const body = '\n\nFirst paragraph.\n\n- a\n- b\n\nLast paragraph.\n\n\n'
    const msg = build({ type: 'fix', scope: 'core', description: 'fix bug', body, footers: ['Refs: KAN-1'] })
    expect(msg).toBe(
      'fix(core): fix bug\n\nFirst paragraph.\n\n- a\n- b\n\nLast paragraph.\n\nRefs: KAN-1\nFlight-Rules-Version: 1.2.3',
    )
  })

  it('omits a whitespace-only body rather than leaving an empty paragraph', () => {
    const msg = build({ type: 'fix', scope: 'core', description: 'fix bug', body: ' \n\n ', footers: [] })
    expect(msg).toBe('fix(core): fix bug\n\nFlight-Rules-Version: 1.2.3')
  })

  it('parses the agent env into a Harness-Version trailer after Flight-Rules-Version', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] }, 'claude-code_2-1-165_agent')
    expect(msg).toContain('Flight-Rules-Version: 1.2.3\nHarness-Version: claude-code@2.1.165')
  })

  it('omits Harness-Version when the agent env is empty', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] }, '')
    expect(msg).not.toContain('Harness-Version')
  })

  it('omits Harness-Version when the agent env is unrecognised', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] }, 'something-weird')
    expect(msg).not.toContain('Harness-Version')
  })

  it('appends Model-Used last when provided', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [], model: 'claude-sonnet-4-6' })
    expect(msg.endsWith('Model-Used: claude-sonnet-4-6')).toBe(true)
  })

  it('omits Model-Used when model is undefined', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).not.toContain('Model-Used')
  })

  it('drops Claude attribution from the body and the footers', () => {
    const msg = build({
      type: 'fix',
      scope: 'core',
      description: 'fix bug',
      body: 'why it changed\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_abc\n',
      footers: ['Refs: FRT-1', 'Co-Authored-By: Claude <noreply@anthropic.com>', 'Co-Authored-By: Jane <jane@acme.com>'],
    })
    expect(msg).toBe(
      'fix(core): fix bug\n\nwhy it changed\n\nRefs: FRT-1\nCo-Authored-By: Jane <jane@acme.com>\nFlight-Rules-Version: 1.2.3',
    )
  })

  it('places caller footers before auto-generated footers', () => {
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: ['Reviewed-By: alice'] })
    const reviewedIdx = msg.indexOf('Reviewed-By: alice')
    const versionIdx = msg.indexOf('Flight-Rules-Version')
    expect(reviewedIdx).toBeGreaterThan(-1)
    expect(reviewedIdx).toBeLessThan(versionIdx)
  })

  it('falls back to "unknown" plugin version when package.json has no string version', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({ name: 'x' }))
    const msg = build({ type: 'feat', scope: 'cli', description: 'add thing', footers: [] })
    expect(msg).toContain('Flight-Rules-Version: unknown')
  })
})
