import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { validator } from '@atlaskit/adf-utils/validator'
import type { ValidationError } from '@atlaskit/adf-utils/validatorTypes'
import type { ADFEntity } from '@atlaskit/adf-utils/types'
import { markdownAdfConverter } from '../markdown-adf.js'
import type { AdfDocNode, AdfNode } from '../adf.js'
import { jiraAdfMetadataService } from '../adf-metadata.js'
import type { EntityMetadata } from '../../task-tracker/task-tracker.js'
import { assertContentModel, ContentModelError } from './content-model.js'
import { roundTripCases } from './round-trip-cases.js'

const fixtureNames = ['layered-body', 'bug-report'] as const
type FixtureName = (typeof fixtureNames)[number]

/** The metadata each fixture's LLM Context YAML declares; the converter must carry these values into the ADF it emits. */
const expectedMetadata: Record<FixtureName, EntityMetadata> = {
  'layered-body': { epicId: 12, notes: 'fixture' },
  'bug-report': { epicId: 12, kind: 'bug', notes: 'fixture' },
}

const metadataExpandTitle = 'LLM Context'
const llmContextMarker = `<details>\n<summary>${metadataExpandTitle}</summary>`

const fixtureUrl = (name: string, ext: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}.${ext}`, import.meta.url))

const readFixture = (name: string): string => readFileSync(fixtureUrl(name, 'md'), 'utf8')

/**
 * The round-trippable part of a fixture: everything before the trailing LLM
 * Context block. The expand emitter writes the single-line `<details><summary>`
 * form and moves the sentinel comment, so the canonical multi-line LLM Context
 * block does not survive a round trip byte-for-byte; the read path
 * (`JiraTaskTracker.extractBody`) strips the metadata expand before `toMarkdown`,
 * so this body re-emits exactly, and the metadata's values are checked on the ADF
 * side instead (see the metadata invariant below).
 */
const fixtureBody = (markdown: string): string => {
  const index = markdown.indexOf(llmContextMarker)
  return index === -1 ? markdown : markdown.slice(0, index).replace(/\n+$/, '')
}

const withoutMetadataExpand = (nodes: AdfNode[]): AdfNode[] =>
  nodes.filter((node) => !(node.type === 'expand' && node.attrs?.['title'] === metadataExpandTitle))

describe('golden fixtures', () => {
  it.each(fixtureNames)('%s: converter carries the fixture metadata into the ADF', (name) => {
    // Read the metadata back from the CONVERTED output with the production
    // ADF-side reader (the tracker uses it on read), and assert the exact expected
    // values. This runs before UPDATE_GOLDEN writes anything, so a regenerate that
    // drops or corrupts epicId/kind fails here instead of baking the loss into the
    // golden. The metadata rides in the ADF's LLM Context expand, not in the
    // round-tripped body text — that body cannot reproduce the byte-exact block.
    const doc = markdownAdfConverter.toAdf(readFixture(name))
    expect(jiraAdfMetadataService.parse(doc)).toEqual(expectedMetadata[name])
  })

  it.each(fixtureNames)('%s: toAdf equals the golden, which round-trips to the body', (name) => {
    const fixture = readFixture(name)
    const doc = markdownAdfConverter.toAdf(fixture)

    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(fixtureUrl(name, 'adf.json'), `${JSON.stringify(doc, null, 2)}\n`)
      return
    }

    const golden: AdfDocNode = JSON.parse(readFileSync(fixtureUrl(name, 'adf.json'), 'utf8'))
    expect(doc).toEqual(golden)
    expect(markdownAdfConverter.toMarkdown(withoutMetadataExpand(golden.content))).toBe(fixtureBody(fixture))
  })

  it.each(fixtureNames)('%s: golden satisfies the ADF content models', (name) => {
    const golden: AdfDocNode = JSON.parse(readFileSync(fixtureUrl(name, 'adf.json'), 'utf8'))
    expect(() => assertContentModel(golden)).not.toThrow()
  })
})

describe('assertContentModel rejects invalid content models', () => {
  it('throws on a heading nested under a blockquote', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'blockquote', content: [{ type: 'heading', attrs: { level: 1 }, content: [] }] }],
    }
    expect(() => assertContentModel(doc)).toThrow(ContentModelError)
  })

  it('throws on a mediaSingle nested inside a panel', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: { panelType: 'info' },
          content: [{ type: 'mediaSingle', attrs: { layout: 'center' }, content: [] }],
        },
      ],
    }
    expect(() => assertContentModel(doc)).toThrow(ContentModelError)
  })

  it('throws on an empty table cell', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: {}, content: [] }] }] }],
    }
    expect(() => assertContentModel(doc)).toThrow(ContentModelError)
  })
})

describe('emitted ADF is schema-valid', () => {
  const validate = validator()

  /**
   * The one class of validator finding this `@atlaskit/adf-utils` build reports
   * that Jira nonetheless accepts: the `code` mark, which renders as inline code
   * in Jira but which this build declines on a text node as an unsupported mark
   * (`INVALID_TYPE`). Validation is a floor, not proof of rendering, and this is
   * the inverse — a mark valid in Jira that the schema-tracking validator rejects.
   * Nothing else is exempted, so genuine task-node failures (a bad `state`, a
   * missing localId, an empty `taskList`, a block inside a `taskItem`) are caught.
   */
  const isAllowListed = (entity: ADFEntity, error: ValidationError): boolean =>
    entity.type === 'code' && error.code === 'INVALID_TYPE'

  const validationErrors = (doc: AdfDocNode): ValidationError[] => {
    const errors: ValidationError[] = []
    validate(doc, (entity, error) => {
      if (!isAllowListed(entity, error)) errors.push(error)
      return undefined
    })
    return errors
  }

  const taskList = (items: AdfNode[]): AdfDocNode => ({
    version: 1,
    type: 'doc',
    content: [{ type: 'taskList', attrs: { localId: 'task-list' }, content: items }],
  })

  it.each(fixtureNames)('%s golden validates', (name) => {
    const golden: AdfDocNode = JSON.parse(readFileSync(fixtureUrl(name, 'adf.json'), 'utf8'))
    expect(validationErrors(golden)).toEqual([])
  })

  it.each(roundTripCases)('round-trip case %s validates', (_name, markdown) => {
    expect(validationErrors(markdownAdfConverter.toAdf(markdown))).toEqual([])
  })

  it('flags a taskItem with an invalid state, which Jira rejects', () => {
    const doc = taskList([{ type: 'taskItem', attrs: { localId: 'task-1', state: 'BOGUS' }, content: [{ type: 'text', text: 'x' }] }])
    expect(validationErrors(doc).length).toBeGreaterThan(0)
  })

  it('flags a taskItem missing its required attrs, which Jira rejects', () => {
    const doc = taskList([{ type: 'taskItem', attrs: {}, content: [{ type: 'text', text: 'x' }] }])
    expect(validationErrors(doc).length).toBeGreaterThan(0)
  })

  it('flags an empty taskList, which Jira rejects', () => {
    expect(validationErrors(taskList([])).length).toBeGreaterThan(0)
  })

  it('flags a taskItem that holds a paragraph, which Jira rejects', () => {
    const doc = taskList([
      {
        type: 'taskItem',
        attrs: { localId: 'task-1', state: 'TODO' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'invalid' }] }],
      },
    ])
    expect(validationErrors(doc).length).toBeGreaterThan(0)
  })

  it('flags a panel with empty content, which Jira rejects', () => {
    const doc: AdfDocNode = {
      version: 1,
      type: 'doc',
      content: [{ type: 'panel', attrs: { panelType: 'error' }, content: [] }],
    }
    expect(validationErrors(doc).length).toBeGreaterThan(0)
  })

  it('flags a table whose row nesting is wrong, which Jira rejects', () => {
    const doc: AdfDocNode = {
      version: 1,
      type: 'doc',
      content: [{ type: 'table', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
    }
    expect(validationErrors(doc).length).toBeGreaterThan(0)
  })
})
