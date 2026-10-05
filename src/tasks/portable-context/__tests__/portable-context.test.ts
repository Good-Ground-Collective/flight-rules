import { describe, it, expect } from 'vitest'
import { RegexPortableContextGuard } from '../portable-context.js'

const guard = new RegexPortableContextGuard()

describe('RegexPortableContextGuard', () => {
  it.each([
    ['a macOS home path', 'See /Users/seth/Developer/acme/planning/decisions.md for context.', '/Users/seth/Developer/acme/planning/decisions.md'],
    ['a Linux home path', 'Spec lives at /home/dev/specs/auth.md', '/home/dev/specs/auth.md'],
    ['a tilde path', 'Read ~/Developer/acme/planning/D1.md first', '~/Developer/acme/planning/D1.md'],
    ['a tilde path in a code span', 'Decisions are in `~/notes/decisions.md`.', '~/notes/decisions.md'],
    ['a markdown link to a home path', '[decisions](/Users/seth/notes.md)', '/Users/seth/notes.md'],
    ['a file URL', 'Open file:///Users/seth/spec.html', 'file:///Users/seth/spec.html'],
    ['a Windows home path', 'Notes at C:\\Users\\dev\\notes.md', 'C:\\Users\\dev\\notes.md'],
  ])('flags %s', (_label, body, match) => {
    expect(guard.find(body)).toEqual([{ line: 1, match }])
  })

  it.each([
    ['a URL whose path contains /home/', 'Docs: https://example.com/home/docs/setup'],
    ['a URL whose path contains /Users/', 'API: https://api.example.com/v1/Users/42'],
    ['a repo-relative path', 'Edit `src/tasks/commands/ticket/command.ts` and docs/layered-body-format.md'],
    ['a tracker key and Confluence URL', 'Parent FRT-123; design at https://acme.atlassian.net/wiki/spaces/ENG/pages/1'],
    ['a tilde used as an approximation', 'Takes ~2 minutes, roughly ~50% faster'],
  ])('allows %s', (_label, body) => {
    expect(guard.find(body)).toEqual([])
  })

  it('reports the line number of each reference', () => {
    const found = guard.find('fine\nsee ~/a.md\nalso fine\n/home/x/b.md')
    expect(found.map((r) => r.line)).toEqual([2, 4])
  })

  it('throws an error that names each reference and explains how to publish context', () => {
    expect(() => guard.assertPortable('Context: ~/planning/decisions.md')).toThrow(
      /line 1: ~\/planning\/decisions\.md[\s\S]*flight-rules tdd create/,
    )
  })

  it('caps the listed references and counts the rest', () => {
    const body = Array.from({ length: 7 }, (_, i) => `~/f${i}.md`).join('\n')
    expect(() => guard.assertPortable(body)).toThrow(/and 2 more/)
  })

  it('passes a portable body and honours allowLocalPaths', () => {
    expect(() => guard.assertPortable('Parent epic FRT-1')).not.toThrow()
    expect(() => guard.assertPortable('~/x.md', { allowLocalPaths: true })).not.toThrow()
  })
})
