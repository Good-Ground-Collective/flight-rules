import { describe, it, expect } from 'vitest'
import { BodyMetadataService } from '../body-metadata.js'

const sentinel = '<!-- flight-rules:metadata -->'

const makeBlock = (yaml: string): string =>
  `<details>\n<summary>LLM Context</summary>\n${sentinel}\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n</details>`

describe('BodyMetadataService.parse', () => {
  it('returns empty object when no sentinel block is present', () => {
    const svc = new BodyMetadataService()
    expect(svc.parse('Some body\n\n<details>\n<summary>Notes</summary>\nstuff\n</details>')).toEqual({})
  })

  it('parses typed fields from a valid block', () => {
    const svc = new BodyMetadataService()
    const result = svc.parse(`Body\n\n${makeBlock('tddId: 42\nepicId: 10')}`)
    expect(result.tddId).toBe(42)
    expect(result.epicId).toBe(10)
  })

  it('passes unknown keys through unchanged', () => {
    const svc = new BodyMetadataService()
    const result = svc.parse(`Body\n\n${makeBlock('tddId: 42\nfoo: bar')}`)
    expect(result.tddId).toBe(42)
    expect((result as Record<string, unknown>)['foo']).toBe('bar')
  })

  it('throws on YAML that parses to a non-object', () => {
    const svc = new BodyMetadataService()
    expect(() => svc.parse(`Body\n\n${makeBlock('- item1\n- item2')}`)).toThrow(
      'malformed flight-rules metadata block',
    )
  })
})

describe('BodyMetadataService.splice', () => {
  it('appends a new sentinel block when none exists', () => {
    const svc = new BodyMetadataService()
    const result = svc.splice('Some body', { tddId: 42 })
    expect(result).toContain(sentinel)
    expect(result).toContain('tddId: 42')
    expect(result.startsWith('Some body')).toBe(true)
  })

  it('leaves content above the existing block byte-identical', () => {
    const svc = new BodyMetadataService()
    const human = 'Human content above'
    const body = `${human}\n\n${makeBlock('tddId: 1')}`
    const result = svc.splice(body, { tddId: 99 })
    expect(result.startsWith(human)).toBe(true)
    expect(result).toContain('tddId: 99')
    expect(result).not.toContain('tddId: 1')
  })

  it('preserves unknown keys from existing metadata', () => {
    const svc = new BodyMetadataService()
    const body = `Body\n\n${makeBlock('tddId: 1\nfoo: bar')}`
    const result = svc.splice(body, { tddId: 2 })
    expect(result).toContain('foo: bar')
    expect(result).toContain('tddId: 2')
  })

  it('appends a new block when multiple details blocks exist but none has the sentinel', () => {
    const svc = new BodyMetadataService()
    const body =
      '<details>\n<summary>Notes</summary>\nContent\n</details>\n\n' +
      '<details>\n<summary>More</summary>\nContent\n</details>'
    const result = svc.splice(body, { tddId: 5 })
    expect(result).toContain(sentinel)
    expect(result.indexOf('<details>')).toBe(0)
  })

  it('updates only the sentinel block when multiple details blocks exist', () => {
    const svc = new BodyMetadataService()
    const other = '<details>\n<summary>Notes</summary>\nContent\n</details>'
    const managed = makeBlock('tddId: 1')
    const body = `${other}\n\n${managed}`
    const result = svc.splice(body, { tddId: 9 })
    expect(result).toContain('<summary>Notes</summary>')
    expect(result).toContain('tddId: 9')
    expect((result.match(/<details>/g) ?? []).length).toBe(2)
  })

  it('strips a legacy size key on parse', () => {
    const svc = new BodyMetadataService()
    const parsed = svc.parse(`Body\n\n${makeBlock('size: epic\ntddId: 5')}`)
    expect((parsed as Record<string, unknown>)['size']).toBeUndefined()
    expect(parsed.tddId).toBe(5)
  })

  it('leaves a Guided Walkthrough details above the sentinel byte-identical', () => {
    const svc = new BodyMetadataService()
    const guided =
      '## High-level technical writeup\n\nStuff.\n\n' +
      '<details><summary>Guided Walkthrough</summary>\n\n' +
      '```ts\nconst x = 1\n```\n\n</details>'
    const body = `${guided}\n\n${makeBlock('tddId: 1')}`
    const result = svc.splice(body, { tddId: 2 })
    expect(result.startsWith(guided)).toBe(true)
    expect(svc.parse(result).tddId).toBe(2)
  })
})
