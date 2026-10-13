import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRepositoryPaths, RepositoryPathsError } from '../repository-paths.js'

describe('GitRepositoryPaths', () => {
  let repo: string
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  const write = (path: string, contents = 'x\n'): void => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), contents)
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'fr-paths-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    write('.gitignore', 'ignored.log\n')
    write('src/base.ts')
    write('src/edited.ts')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'feature')
    write('classes/Committed.cls')
    write('classes/Café.cls')
    git('add', '.')
    git('commit', '-q', '-m', 'feature')
    write('src/edited.ts', 'changed\n')
    write('untracked/New.trigger')
    write('ignored.log')
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it.each(['.', 'src'])('lists tracked and untracked files from %j, skipping ignored ones', async dir => {
    expect((await new GitRepositoryPaths({ cwd: join(repo, dir) }).inventory()).sort()).toEqual([
      '.gitignore',
      'classes/Café.cls',
      'classes/Committed.cls',
      'src/base.ts',
      'src/edited.ts',
      'untracked/New.trigger',
    ])
  })
  it.each(['.', 'src'])('lists committed, uncommitted and untracked changes since the merge base from %j', async dir => {
    expect((await new GitRepositoryPaths({ cwd: join(repo, dir) }).changedSince('main')).sort()).toEqual([
      'classes/Café.cls',
      'classes/Committed.cls',
      'src/edited.ts',
      'untracked/New.trigger',
    ])
  })
  it.each(['--output=/tmp/x', '-p', 'two words', ''])('rejects base %j before running git', async base => {
    await expect(new GitRepositoryPaths({ cwd: repo }).changedSince(base)).rejects.toThrow(/base must be a git ref/)
  })
  it('wraps git failures', async () => {
    await expect(new GitRepositoryPaths({ cwd: repo }).changedSince('no-such-branch')).rejects.toThrow(RepositoryPathsError)
  })
})
