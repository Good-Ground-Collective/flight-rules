import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFlightRules } from '../../../flight-rules/flight-rules.js'
import { EvidenceLocation } from '../evidence-location.js'

describe('EvidenceLocation', () => {
  let root: string
  let main: string
  let worktree: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'fr-evidence-')))
    main = join(root, 'main')
    worktree = join(root, 'wt')
    execFileSync('git', ['init', '-q', '-b', 'main', main])
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root'], { cwd: main })
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'scratch', worktree], { cwd: main })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('puts evidence in the main checkout when run from a linked worktree', () => {
    writeFileSync(join(main, '.gitignore'), '.claude/\n')
    const dir = createFlightRules({ cwd: worktree, env: {} }).evidence().dirFor('FRT-1')
    expect(dir).toEqual({ path: join(main, '.claude', 'evidence', 'FRT-1'), gitignored: true })
  })

  it('uses the .agents directory when that is where config lives', () => {
    mkdirSync(join(main, '.agents'))
    expect(new EvidenceLocation({ cwd: main }).dirFor('FRT-2').path).toBe(join(main, '.agents', 'evidence', 'FRT-2'))
  })

  it('reports a path git does not ignore', () => {
    expect(new EvidenceLocation({ cwd: main }).dirFor('FRT-3').gitignored).toBe(false)
  })

  it('reports null outside any repository', () => {
    const outside = join(root, 'plain')
    mkdirSync(outside)
    expect(new EvidenceLocation({ cwd: outside }).dirFor('FRT-4').gitignored).toBeNull()
  })

  it('rejects ticket ids that would escape the evidence directory', () => {
    const location = new EvidenceLocation({ cwd: main })
    expect(() => location.dirFor('../x')).toThrow('invalid ticket id')
    expect(() => location.dirFor('a/b')).toThrow('invalid ticket id')
    expect(() => location.dirFor(' ')).toThrow('invalid ticket id')
  })
})
