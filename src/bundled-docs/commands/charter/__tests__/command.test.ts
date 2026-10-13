import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCharterCommand } from '../command.js'
import type { Charter, CharterCatalog } from '../../../charter-catalog/charter-catalog.js'
import type { RepositoryPaths } from '../../../charter-catalog/repository-paths.js'

const core: Charter = { id: 'coding-charter', language: null, appliesTo: [], path: '/docs/coding-charter.md', contents: '# Core\n' }
const typescript: Charter = {
  id: 'coding-charter-typescript',
  language: 'typescript',
  appliesTo: ['**/*.ts'],
  path: '/docs/coding-charter-typescript.md',
  contents: '# TypeScript',
}

describe('charter command', () => {
  const select = vi.fn((paths: readonly string[]) => (paths.some(path => path.endsWith('.ts')) ? [core, typescript] : [core]))
  const catalog: CharterCatalog = { all: () => [core, typescript], select }
  const repositoryPaths: RepositoryPaths = {
    inventory: vi.fn(async () => ['src/a.ts', 'README.md']),
    changedSince: vi.fn(async () => ['README.md']),
  }
  const run = (args: string[], stdin = ''): Promise<unknown> =>
    createCharterCommand(() => catalog, () => repositoryPaths, async () => stdin).parseAsync(args, { from: 'user' })
  const stdout = (): ReturnType<typeof vi.spyOn> => vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = (): ReturnType<typeof vi.spyOn> => vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('selects from the repository inventory by default and prints every charter', async () => {
    const output = stdout()
    await run([])
    expect(select).toHaveBeenCalledWith(['src/a.ts', 'README.md'])
    expect(output).toHaveBeenCalledWith('# Core\n\n# TypeScript\n')
  })
  it('prints one path per line with --path', async () => {
    const output = stdout()
    await run(['src/a.ts', '--path'])
    expect(output).toHaveBeenCalledWith('/docs/coding-charter.md\n/docs/coding-charter-typescript.md\n')
  })
  it('selects from positional paths', async () => {
    stdout()
    await run(['src/a.ts', 'src/b.ts'])
    expect(select).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])
    expect(repositoryPaths.inventory).not.toHaveBeenCalled()
  })
  it('selects from stdin', async () => {
    stdout()
    await run(['--stdin'], 'src/a.ts\nREADME.md\n')
    expect(select).toHaveBeenCalledWith(['src/a.ts', 'README.md', ''])
  })
  it('selects from the diff against a base and says when only the core matched', async () => {
    stdout()
    const warning = stderr()
    await run(['--diff', 'origin/main'])
    expect(repositoryPaths.changedSince).toHaveBeenCalledWith('origin/main')
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('core charter only'))
  })
  it.each([
    [['a.ts', '--diff', 'main']],
    [['--stdin', '--repo']],
    [['--diff', 'main', '--repo']],
  ])('rejects more than one source: %j', async args => {
    await expect(run(args)).rejects.toThrow(/Choose one of/)
  })
})
