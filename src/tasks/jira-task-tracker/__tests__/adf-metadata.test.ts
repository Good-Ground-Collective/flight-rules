import { describe, it, expect } from 'vitest'
import type { AdfDocNode } from '../adf.js'
import { JiraAdfMetadataService } from '../adf-metadata.js'

const codec = new JiraAdfMetadataService()

const emptyDoc = (): AdfDocNode => ({ version: 1, type: 'doc', content: [] })

const docWithYaml = (yaml: string): AdfDocNode => ({
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'expand',
      attrs: { title: 'LLM Context' },
      content: [{ type: 'codeBlock', attrs: { language: 'yaml' }, content: [{ type: 'text', text: yaml }] }],
    },
  ],
})

describe('JiraAdfMetadataService.parse', () => {
  it('returns {} for a doc with no content', () => {
    expect(codec.parse(emptyDoc())).toEqual({})
  })

  it('returns {} for a doc with no LLM Context expand node', () => {
    const doc: AdfDocNode = {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'just a description' }] }],
    }
    expect(codec.parse(doc)).toEqual({})
  })

  it('returns {} when the LLM Context expand has no code block text', () => {
    const doc: AdfDocNode = {
      version: 1,
      type: 'doc',
      content: [{ type: 'expand', attrs: { title: 'LLM Context' }, content: [] }],
    }
    expect(codec.parse(doc)).toEqual({})
  })

  it('parses and validates metadata from the LLM Context code block', () => {
    expect(codec.parse(docWithYaml('epicId: 10\ntddId: 42'))).toEqual({ epicId: 10, tddId: 42 })
  })

  it('strips a legacy size key on parse', () => {
    expect(codec.parse(docWithYaml('size: ticket\ntddId: 42'))).toEqual({ tddId: 42 })
  })

  it('preserves unknown keys via passthrough', () => {
    expect(codec.parse(docWithYaml('foo: bar\ntddId: 1'))).toEqual({ foo: 'bar', tddId: 1 })
  })
})

describe('JiraAdfMetadataService.splice', () => {
  it('appends a single LLM Context expand node to a doc that has none', () => {
    const result = codec.splice(emptyDoc(), { notes: 'hi' })
    expect(codec.parse(result)).toEqual({ notes: 'hi' })
    expect(result.content.filter((n) => n.type === 'expand')).toHaveLength(1)
  })

  it('updates metadata in place without adding a second expand node', () => {
    const first = codec.splice(emptyDoc(), { notes: 'a', tddId: 1 })
    const second = codec.splice(first, { tddId: 2 })
    expect(codec.parse(second)).toEqual({ notes: 'a', tddId: 2 })
    expect(second.content.filter((n) => n.type === 'expand')).toHaveLength(1)
  })

  it('keeps unknown keys already present when splicing a new field', () => {
    const result = codec.splice(docWithYaml('foo: bar'), { tddId: 1 })
    expect(codec.parse(result)).toEqual({ foo: 'bar', tddId: 1 })
  })

  it('skips undefined patch values, leaving existing fields untouched', () => {
    const first = codec.splice(emptyDoc(), { notes: 'keep' })
    const second = codec.splice(first, { notes: undefined, tddId: 5 })
    expect(codec.parse(second)).toEqual({ notes: 'keep', tddId: 5 })
  })

  it('does not mutate the input doc', () => {
    const doc = emptyDoc()
    const snapshot = structuredClone(doc)
    codec.splice(doc, { tddId: 1 })
    expect(doc).toEqual(snapshot)
  })

  it('round-trips: parse(splice(doc, patch)) deep-equals merged metadata', () => {
    const base = codec.splice(emptyDoc(), { epicId: 3, notes: 'keep' })
    const patched = codec.splice(base, { notes: 'updated', tddId: 7 })
    expect(codec.parse(patched)).toEqual({ epicId: 3, notes: 'updated', tddId: 7 })
  })
})
