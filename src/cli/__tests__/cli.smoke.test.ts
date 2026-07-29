import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Guards against bundling regressions that only surface when the built binary
// actually runs (e.g. ESM output that can't satisfy a dependency's dynamic
// require(), or an entry file Node refuses to load as ESM). The unit tests
// import TS source directly and cannot catch these, so this spawns the real
// artifacts. Requires `npm run build` to have run first (CI builds before
// `npm test`).
const bundle = fileURLToPath(new URL('../bin/flight-rules.mjs', import.meta.url))
const shim = fileURLToPath(new URL('../bin/flight-rules', import.meta.url))
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
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
})
