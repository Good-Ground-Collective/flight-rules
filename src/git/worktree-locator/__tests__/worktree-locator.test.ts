import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFlightRules } from '../../../flight-rules/flight-rules.js'
import { WorktreeLocator } from '../worktree-locator.js'

describe('linked worktree support', () => {
  let root: string
  let main: string
  let worktree: string
  const env = (): Record<string, string> => ({ CLAUDE_CONFIG_DIR: join(root, 'user') })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'fr-worktree-')))
    main = join(root, 'main')
    worktree = join(root, 'wt')
    execFileSync('git', ['init', '-q', '-b', 'main', main])
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root'], { cwd: main })
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'scratch', worktree], { cwd: main })
    mkdirSync(join(main, '.claude'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds the main checkout from a linked worktree, and nothing from the main checkout', () => {
    const locator = new WorktreeLocator()
    expect(locator.mainCheckoutFor(worktree)).toBe(main)
    expect(locator.mainCheckoutFor(main)).toBeUndefined()
    expect(locator.mainCheckoutFor(root)).toBeUndefined()
  })

  it('reads untracked local settings and the config file from the main checkout', () => {
    writeFileSync(
      join(main, '.claude', 'settings.local.json'),
      JSON.stringify({ pluginConfigs: { 'flight-rules@flight-rules': { options: { tracker: 'github', repo: 'acme/main' } } } }),
    )
    writeFileSync(join(main, '.claude', 'flight-rules.local.md'), '---\ninProgressStatus: Doing\n---\n')
    const report = createFlightRules({ cwd: worktree, env: env() }).configStore().report()
    expect(report.config).toMatchObject({ repo: 'acme/main', inProgressStatus: 'Doing' })
    expect(report.sources['repo']?.path).toBe(join(main, '.claude', 'settings.local.json'))
    expect(report.sources['inProgressStatus']?.path).toBe(join(main, '.claude', 'flight-rules.local.md'))
  })

  it('writes local values to the main checkout so they outlive the worktree', () => {
    const store = createFlightRules({ cwd: worktree, env: env() }).configStore()
    store.set('repo', ['acme/proj'], 'local')
    expect(existsSync(join(worktree, '.claude', 'settings.local.json'))).toBe(false)
    expect(readFileSync(join(main, '.claude', 'settings.local.json'), 'utf8')).toContain('acme/proj')
  })

  it("prefers the worktree's own copy when it has one", () => {
    writeFileSync(join(main, '.claude', 'flight-rules.local.md'), '---\ntracker: github\nrepo: acme/main\n---\n')
    mkdirSync(join(worktree, '.claude'))
    writeFileSync(join(worktree, '.claude', 'flight-rules.local.md'), '---\ntracker: github\nrepo: acme/wt\n---\n')
    expect(createFlightRules({ cwd: worktree, env: env() }).config().repo).toBe('acme/wt')
  })
})
