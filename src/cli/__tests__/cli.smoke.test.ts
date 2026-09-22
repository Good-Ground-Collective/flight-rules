import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Guards against bundling regressions that only surface when the built binary
// actually runs (e.g. ESM output that can't satisfy a dependency's dynamic
// require(), or an entry file Node refuses to load as ESM). The unit tests
// import TS source directly and cannot catch these, so this spawns the real
// artifacts. Requires `npm run build` to have run first (CI builds before
// `npm test`).
const bundle = fileURLToPath(new URL('../../../bin/flight-rules.mjs', import.meta.url))
const shim = fileURLToPath(new URL('../../../bin/flight-rules', import.meta.url))
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
)

describe('built binary smoke test', () => {
  it('runs --help without crashing and prints usage', () => {
    const output = execFileSync('node', [bundle, '--help'], { encoding: 'utf8' })
    expect(output).toContain('Usage: flight-rules')
  })

  it('reports the package version (embedded at build time)', () => {
    const output = execFileSync('node', [bundle, '--version'], { encoding: 'utf8' }).trim()
    expect(output).toBe(pkg.version)
  })

  it('runs via the extensionless PATH shim', () => {
    const output = execFileSync(shim, ['--help'], { encoding: 'utf8' })
    expect(output).toContain('Usage: flight-rules')
  })

  it('exits non-zero (not a silent no-op) on an unknown command', () => {
    expect(() => execFileSync(shim, ['not-a-command'], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
  })

  it.each([bundle, shim])('reads the full charter through %s', executable => {
    const env = { ...process.env }
    delete env['FLIGHT_RULES_HOME']
    const args = executable === bundle ? [bundle] : []
    const command = executable === bundle ? 'node' : shim
    const path = execFileSync(command, [...args, 'doc', 'coding-charter', '--path'], { encoding: 'utf8', env }).trim()
    expect(isAbsolute(path)).toBe(true)
    expect(existsSync(path)).toBe(true)
    expect(path).toMatch(/\/docs\/coding-charter\.md$/)
    const contents = readFileSync(path, 'utf8')
    expect(execFileSync(command, [...args, 'doc', 'coding-charter'], { encoding: 'utf8', env }))
      .toBe(contents.endsWith('\n') ? contents : `${contents}\n`)
  })

  it('resolves docs beside a relocated bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'fr-install-'))
    try {
      mkdirSync(join(root, 'bin'))
      mkdirSync(join(root, 'docs'))
      const copiedBundle = join(root, 'bin', 'flight-rules.mjs')
      copyFileSync(bundle, copiedBundle)
      writeFileSync(join(root, 'docs', 'alpha.md'), 'Relocated documentation\n')
      const env = { ...process.env }
      delete env['FLIGHT_RULES_HOME']
      expect(execFileSync('node', [copiedBundle, 'doc', 'alpha'], { encoding: 'utf8', env }))
        .toBe('Relocated documentation\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports every available id on one stderr line for an unknown doc', () => {
    const env = { ...process.env }
    delete env['FLIGHT_RULES_HOME']
    const result = spawnSync('node', [bundle, 'doc', 'nope'], { encoding: 'utf8', env })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    const ids = readdirSync(join(dirname(bundle), '..', 'docs'), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name.slice(0, -3)).sort()
    expect(result.stderr).toContain(`Unknown doc "nope" — available: ${ids.join(', ')}`)
  })
})
