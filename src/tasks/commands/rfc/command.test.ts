import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync } from 'node:fs'
import { createRfcCommand } from './command.js'
import type { Config } from '../../../config.js'

vi.mock('node:fs', () => ({ readdirSync: vi.fn() }))

const mockReaddirSync = vi.mocked(readdirSync)

const config: Config = {
  tracker: 'github',
  repo: 'acme/proj',
  defaultLabels: [],
  rfcStorage: 'local',
  competencies: [],
}

const run = (args: string[]) =>
  createRfcCommand(() => config, () => '/workspace').exitOverride().parseAsync(args, { from: 'user' })

describe('rfc next-id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns RFC-001 when directory does not exist', async () => {
    mockReaddirSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(['next-id'])
    expect(output).toHaveBeenCalledWith('RFC-001\n')
  })

  it('returns RFC-001 when directory exists but has no RFC files', async () => {
    mockReaddirSync.mockReturnValue(['README.md', 'other.md'] as never)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(['next-id'])
    expect(output).toHaveBeenCalledWith('RFC-001\n')
  })

  it('returns the next ID after sequential files', async () => {
    mockReaddirSync.mockReturnValue(['RFC-001.md', 'RFC-002.md'] as never)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(['next-id'])
    expect(output).toHaveBeenCalledWith('RFC-003\n')
  })

  it('returns next ID based on highest number even when non-sequential', async () => {
    mockReaddirSync.mockReturnValue(['RFC-001.md', 'RFC-005.md'] as never)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(['next-id'])
    expect(output).toHaveBeenCalledWith('RFC-006\n')
  })
})

describe('rfc dir', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the local rfcs directory path', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(['dir'])
    expect(output).toHaveBeenCalledWith('/workspace/rfcs\n')
  })

  it('returns the global rfcStoragePath when configured', async () => {
    const globalConfig: Config = { ...config, rfcStorage: 'global', rfcStoragePath: '/shared/rfcs' }
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await createRfcCommand(() => globalConfig, () => '/workspace')
      .exitOverride()
      .parseAsync(['dir'], { from: 'user' })
    expect(output).toHaveBeenCalledWith('/shared/rfcs\n')
  })
})
