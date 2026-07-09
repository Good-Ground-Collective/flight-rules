import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveBody } from './resolve-body.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

import { readFileSync } from 'node:fs'

describe('resolveBody', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the inline body when only --body is given', () => {
    expect(resolveBody({ body: 'inline text' })).toBe('inline text')
    expect(vi.mocked(readFileSync)).not.toHaveBeenCalled()
  })

  it('reads the file when --body-file is given', () => {
    vi.mocked(readFileSync).mockReturnValue('file contents')
    expect(resolveBody({ bodyFile: '/tmp/body.md' })).toBe('file contents')
    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith('/tmp/body.md', 'utf8')
  })

  it('prefers --body-file when both are given', () => {
    vi.mocked(readFileSync).mockReturnValue('from file')
    expect(resolveBody({ body: 'inline', bodyFile: '/tmp/body.md' })).toBe('from file')
  })

  it('throws when neither is given', () => {
    expect(() => resolveBody({})).toThrow('one of --body or --body-file is required')
  })
})
