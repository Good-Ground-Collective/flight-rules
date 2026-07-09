import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCompetenciesCommand } from './command.js'
import type { Config } from '../../../config.js'

const config: Config = {
  tracker: 'github',
  repo: 'acme/proj',
  defaultLabels: [],
  rfcStorage: 'local',
  competencies: ['define-a-schema', 'wire-an-endpoint'],
}

const run = (cfg: Config, args: string[]) =>
  createCompetenciesCommand(() => cfg).exitOverride().parseAsync(args, { from: 'user' })

describe('competencies command', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prints the configured competencies as JSON', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run(config, [])
    expect(output).toHaveBeenCalledWith(JSON.stringify(['define-a-schema', 'wire-an-endpoint']) + '\n')
    output.mockRestore()
  })
})
