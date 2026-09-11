import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { validator } from '@atlaskit/adf-utils/validator'
import type { ValidationError } from '@atlaskit/adf-utils/validatorTypes'
import type { ADFEntity } from '@atlaskit/adf-utils/types'
import { markdownAdfConverter } from '../markdown-adf.js'
import type { AdfDocNode, AdfNode } from '../adf.js'
import { BodyMetadataService } from '../../body-metadata/body-metadata.js'
import { assertContentModel, ContentModelError } from './content-model.js'
import { roundTripCases } from './round-trip-cases.js'

const fixtureNames = ['layered-body', 'bug-report'] as const

const metadataExpandTitle = 'LLM Context'
const llmContextMarker = `<details>\n<summary>${metadataExpandTitle}</summary>`

const fixtureUrl = (name: string, ext: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}.${ext}`, import.meta.url))

const readFixture = (name: string): string => readFileSync(fixtureUrl(name, 'md'), 'utf8')

/**
 * Splits a fixture into the round-trippable body and the trailing LLM Context
 * block. The expand emitter writes the single-line `<details><summary>` form and
 * moves the sentinel comment, so the canonical multi-line LLM Context block does
 * not survive a round trip byte-for-byte. The read path (`JiraTaskTracker.extractBody`)
 * strips the metadata expand before `toMarkdown`, so the body re-emits exactly;
 * the block itself is re-attached only for the metadata parse.
 */
const splitFixture = (markdown: string): { body: string; llmContext: string } => {
  const index = markdown.indexOf(llmContextMarker)
  if (index === -1) return { body: markdown, llmContext: '' }
  return { body: markdown.slice(0, index).replace(/\n+$/, ''), llmContext: markdown.slice(index) }
}

const withoutMetadataExpand = (nodes: AdfNode[]): AdfNode[] =>
  nodes.filter((node) => !(node.type === 'expand' && node.attrs?.['title'] === metadataExpandTitle))

const metadata = new BodyMetadataService()

describe('golden fixtures', () => {
  it.each(fixtureNames)('%s: toAdf equals the golden, which round-trips and preserves metadata', (name) => {
    const fixture = readFixture(name)
    const doc = markdownAdfConverter.toAdf(fixture)

    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(fixtureUrl(name, 'adf.json'), `${JSON.stringify(doc, null, 2)}\n`)
      return
    }

    const golden: AdfDocNode = JSON.parse(readFileSync(fixtureUrl(name, 'adf.json'), 'utf8'))
    expect(doc).toEqual(golden)

    const { body, llmContext } = splitFixture(fixture)
    const emittedBody = markdownAdfConverter.toMarkdown(withoutMetadataExpand(golden.content))
    expect(emittedBody).toBe(body)

    const rebuilt = `${emittedBody}\n\n${llmContext}`
    expect(metadata.parse(rebuilt)).toEqual(metadata.parse(fixture))
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
   * Collects the validator's errors through its callback, which surfaces each
   * violation the way `out.valid` alone does not, minus two allow-listed classes
   * this `@atlaskit/adf-utils` build reports but Jira accepts:
   *
   * - `taskList` and `taskItem`, which Jira renders but the published ADF JSON
   *   schema does not document, so the validator has no spec for them;
   * - the `code` mark, which Jira renders as inline code but this validator build
   *   rejects on a text node as an unsupported mark (`INVALID_TYPE`). Validation
   *   is a floor, not proof of rendering, and this is the inverse case — a mark
   *   valid in Jira that the schema-tracking validator declines.
   */
  const isAllowListed = (entity: ADFEntity, error: ValidationError): boolean =>
    entity.type === 'taskList' ||
    entity.type === 'taskItem' ||
    (entity.type === 'code' && error.code === 'INVALID_TYPE')

  const validationErrors = (doc: AdfDocNode): ValidationError[] => {
    const errors: ValidationError[] = []
    validate(doc, (entity, error) => {
      if (!isAllowListed(entity, error)) errors.push(error)
      return undefined
    })
    return errors
  }

  it.each(fixtureNames)('%s golden validates', (name) => {
    const golden: AdfDocNode = JSON.parse(readFileSync(fixtureUrl(name, 'adf.json'), 'utf8'))
    expect(validationErrors(golden)).toEqual([])
  })

  it.each(roundTripCases)('round-trip case %s validates', (_name, markdown) => {
    expect(validationErrors(markdownAdfConverter.toAdf(markdown))).toEqual([])
  })

  it('flags a taskItem that holds a paragraph, which Jira rejects', () => {
    const doc: AdfDocNode = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'taskList',
          attrs: { localId: 'task-list' },
          content: [
            {
              type: 'taskItem',
              attrs: { localId: 'task-1', state: 'TODO' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'invalid' }] }],
            },
          ],
        },
      ],
    }
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
