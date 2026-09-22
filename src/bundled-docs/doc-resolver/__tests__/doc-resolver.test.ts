import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocNotFoundError, DocsUnavailableError, FileDocResolver, InvalidDocIdError } from '../doc-resolver.js'

describe('FileDocResolver', () => {
  let root: string
  let resolver: FileDocResolver
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fr-doc-'))
    mkdirSync(join(root, 'docs', 'nested'), { recursive: true })
    writeFileSync(join(root, 'docs', 'alpha.md'), 'Alpha contents\n')
    writeFileSync(join(root, 'docs', 'beta.md'), 'Beta contents')
    writeFileSync(join(root, 'docs', 'nested', 'hidden.md'), 'Hidden')
    writeFileSync(join(root, 'docs', 'ignored.txt'), 'Ignored')
    mkdirSync(join(root, 'docs', 'directory.md'))
    resolver = new FileDocResolver({ docsDir: join(root, 'docs') })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves contents and absolute path', () => {
    expect(resolver.resolve('alpha')).toMatchObject({ id: 'alpha', contents: 'Alpha contents\n' })
    expect(resolver.resolve('alpha').path).toMatch(/\/docs\/alpha\.md$/)
  })
  it('lists only top-level markdown files, sorted', () => {
    expect(resolver.list()).toEqual(['alpha', 'beta'])
  })
  it.each(['missing', 'nested', 'hidden', 'directory'])('reports available ids for %s', id => {
    expect(() => resolver.resolve(id)).toThrow(DocNotFoundError)
    expect(() => resolver.resolve(id)).toThrow(`Unknown doc "${id}" — available: alpha, beta`)
  })
  it.each(['../package.json', 'a/b', 'a\\b', '..', '.', '', 'Alpha', 'alpha.md'])('rejects %j before filesystem access', id => {
    const absent = new FileDocResolver({ docsDir: join(root, 'absent') })
    expect(() => absent.resolve(id)).toThrow(InvalidDocIdError)
  })
  it('rejects symlinks escaping the docs directory', () => {
    writeFileSync(join(root, 'outside.md'), 'Outside')
    symlinkSync(join(root, 'outside.md'), join(root, 'docs', 'escape.md'))
    expect(resolver.list()).toEqual(['alpha', 'beta'])
    expect(() => resolver.resolve('escape')).toThrow(DocNotFoundError)
  })
  it.each([undefined, '', '   '])('resolves beside bin when override is %j', override => {
    const installed = FileDocResolver.fromInstall({
      moduleUrl: pathToFileURL(join(root, 'bin', 'flight-rules.mjs')).href,
      env: { FLIGHT_RULES_HOME: override },
    })
    expect(installed.resolve('alpha')).toEqual(resolver.resolve('alpha'))
  })
  it('uses the trimmed install-home override', () => {
    const installed = FileDocResolver.fromInstall({
      moduleUrl: pathToFileURL('/unused/bin/flight-rules.mjs').href,
      env: { FLIGHT_RULES_HOME: ` ${root} ` },
    })
    expect(installed.resolve('beta')).toEqual(resolver.resolve('beta'))
  })
  it('accepts the native process environment', () => {
    vi.stubEnv('FLIGHT_RULES_HOME', root)
    const installed = FileDocResolver.fromInstall({
      moduleUrl: pathToFileURL('/unused/bin/flight-rules.mjs').href,
      env: process.env,
    })
    expect(installed.resolve('alpha')).toEqual(resolver.resolve('alpha'))
  })
  it.each([
    { overridden: false, docsIsFile: false },
    { overridden: false, docsIsFile: true },
    { overridden: true, docsIsFile: false },
    { overridden: true, docsIsFile: true },
  ])('throws a named error with its diagnostic for unavailable docs: %j', ({ overridden, docsIsFile }) => {
    const home = join(root, 'unavailable')
    mkdirSync(home)
    const docsDir = join(home, 'docs')
    if (docsIsFile) writeFileSync(docsDir, 'not a directory')
    const resolveInstall = () => FileDocResolver.fromInstall({
      moduleUrl: pathToFileURL(join(home, 'bin', 'flight-rules.mjs')).href,
      env: overridden ? { FLIGHT_RULES_HOME: home } : {},
    })
    const source = overridden ? `FLIGHT_RULES_HOME is set to ${home} but` : 'Bundled docs directory'

    expect(resolveInstall).toThrow(DocsUnavailableError)
    expect(resolveInstall).toThrow(expect.objectContaining({
      name: 'DocsUnavailableError',
      message: `${source} ${docsDir} does not exist or is not a directory — point FLIGHT_RULES_HOME at the flight-rules install root`,
    }))
  })
})
