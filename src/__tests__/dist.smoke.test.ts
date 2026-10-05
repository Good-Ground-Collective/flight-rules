import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dist = new URL('../../dist/', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

describe('built library smoke test', () => {
  it('resolves the package in Node with the release version and working services', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { appVersion, createFlightRules } from '@good-ground-collective/flight-rules'
      import pkg from '@good-ground-collective/flight-rules/package.json' with { type: 'json' }
      const core = createFlightRules({ cwd: '/nonexistent', env: {} })
      console.log(JSON.stringify({
        appVersion,
        packageVersion: pkg.version,
        doc: core.docs().resolve('coding-charter').id,
        git: typeof core.git().checkout,
      }))
    `], { cwd: root, encoding: 'utf8' })

    expect(JSON.parse(output)).toEqual({
      appVersion: pkg.version,
      packageVersion: pkg.version,
      doc: 'coding-charter',
      git: 'function',
    })
  })

  it('keeps dependency imports external to the ESM bundle', () => {
    const bundle = readFileSync(new URL('index.js', dist), 'utf8')
    expect(bundle).toMatch(/from ["']zod["']/)
    expect(bundle).not.toContain('node_modules/')
    expect(bundle).not.toContain('class ZodError')
  })

  it('ships declarations without test declarations', () => {
    expect(readFileSync(new URL('index.d.ts', dist), 'utf8')).toContain('createFlightRules')
    expect(readdirSync(dist, { recursive: true }).some(path => String(path).includes('__tests__'))).toBe(false)
  })

  it('exposes only the library and package metadata entry points', () => {
    expect(pkg.main).toBeUndefined()
    expect(pkg.types).toBe('./dist/index.d.ts')
    expect(pkg.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './package.json': './package.json',
    })
    expect(pkg.files).toContain('dist/')
    expect(pkg.bin).toEqual({ 'flight-rules': 'bin/flight-rules.mjs' })
  })
})
