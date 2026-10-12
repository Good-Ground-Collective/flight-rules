import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CharterFormatError, DocCharterCatalog } from '../charter-catalog.js'
import { DocNotFoundError, FileDocResolver } from '../../doc-resolver/doc-resolver.js'

const languageCharter = (language: string, globs: string[]): string =>
  `---\nlanguage: ${language}\napplies-to:\n${globs.map(glob => `  - "${glob}"`).join('\n')}\n---\n\n# ${language}\n`

describe('DocCharterCatalog', () => {
  let docsDir: string
  const catalog = (): DocCharterCatalog => new DocCharterCatalog({ docs: new FileDocResolver({ docsDir }) })
  const write = (id: string, contents: string): void => writeFileSync(join(docsDir, `${id}.md`), contents)
  const ids = (paths: string[]): string[] => catalog().select(paths).map(charter => charter.id)

  beforeEach(() => {
    docsDir = join(mkdtempSync(join(tmpdir(), 'fr-charter-')), 'docs')
    mkdirSync(docsDir)
    write('coding-charter', '# Core\n')
    write('coding-charter-typescript', languageCharter('typescript', ['**/*.ts', '**/*.tsx']))
    write('coding-charter-apex', languageCharter('apex', ['**/*.cls', '**/*.trigger']))
    write('prose-charter', '# Prose\n')
  })
  afterEach(() => rmSync(join(docsDir, '..'), { recursive: true, force: true }))

  it('lists the core first, then language charters sorted by id, ignoring other docs', () => {
    expect(catalog().all().map(charter => [charter.id, charter.language])).toEqual([
      ['coding-charter', null],
      ['coding-charter-apex', 'apex'],
      ['coding-charter-typescript', 'typescript'],
    ])
  })
  it('parses applies-to into camelCase globs', () => {
    expect(catalog().all()[2]).toMatchObject({ appliesTo: ['**/*.ts', '**/*.tsx'], contents: expect.stringContaining('# typescript') })
  })
  it.each([
    [['src/service.ts'], ['coding-charter', 'coding-charter-typescript']],
    [['force-app/main/default/classes/Incident.cls'], ['coding-charter', 'coding-charter-apex']],
    [['index.ts', 'triggers/Incident.trigger'], ['coding-charter', 'coding-charter-apex', 'coding-charter-typescript']],
    [['./src/app.tsx'], ['coding-charter', 'coding-charter-typescript']],
    [['README.md', 'package.json'], ['coding-charter']],
    [[], ['coding-charter']],
    [['', '  '], ['coding-charter']],
  ])('selects %j as %j', (paths, expected) => {
    expect(ids(paths)).toEqual(expected)
  })
  it('requires the core charter', () => {
    rmSync(join(docsDir, 'coding-charter.md'))
    expect(() => catalog().select(['a.ts'])).toThrow(DocNotFoundError)
  })
  it.each([
    ['no frontmatter', '# Apex\n'],
    ['no globs', '---\nlanguage: apex\napplies-to: []\n---\n'],
    ['unknown keys', '---\nlanguage: apex\napplies-to: ["**/*.cls"]\nextra: 1\n---\n'],
  ])('rejects a language charter with %s', (_case, contents) => {
    write('coding-charter-apex', contents)
    expect(() => catalog().all()).toThrow(CharterFormatError)
  })
  it('rejects a language charter whose file name disagrees with its language', () => {
    write('coding-charter-apex', languageCharter('java', ['**/*.java']))
    expect(() => catalog().all()).toThrow(/must be coding-charter-java\.md/)
  })
})

describe('bundled charters', () => {
  const bundled = new DocCharterCatalog({ docs: new FileDocResolver({ docsDir: join(import.meta.dirname, '..', '..', '..', '..', 'docs') }) })

  it('all parse', () => {
    expect(bundled.all()[0]?.id).toBe('coding-charter')
    expect(bundled.all().length).toBeGreaterThan(1)
  })
  it('give TypeScript files the TypeScript charter', () => {
    expect(bundled.select(['src/index.ts']).map(charter => charter.id)).toContain('coding-charter-typescript')
  })
  it('keep TypeScript mandates out of the core', () => {
    const core = bundled.select([])[0]?.contents ?? ''
    for (const mandate of ['M-3', 'M-4', 'M-5', 'M-6', 'M-7']) expect(core).not.toContain(`## ${mandate} `)
  })
})
