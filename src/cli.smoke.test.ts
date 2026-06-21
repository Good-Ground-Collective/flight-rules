import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Guards against bundling regressions that only surface when the built binary
// actually runs (e.g. ESM output that can't satisfy a dependency's dynamic
// require()). The unit tests import TS source directly and cannot catch these,
// so this spawns the real artifact. Requires `npm run build` to have run first
// (CI builds before `npm test`).
const bin = fileURLToPath(new URL('../bin/flight-rules', import.meta.url))

describe('built binary smoke test', () => {
  it('runs --help without crashing and prints usage', () => {
    const output = execFileSync('node', [bin, '--help'], { encoding: 'utf8' })
    expect(output).toContain('Usage: flight-rules')
  })
})
