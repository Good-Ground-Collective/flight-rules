/* eslint-disable preflight/no-loose-functions -- assertContentModel is a module-level tree walk shared by the golden test; a service seam would add an interface with no second implementation */
import type { AdfNode } from '../adf.js'

/**
 * A golden's ADF broke one of the node content models Jira enforces but the ADF
 * JSON schema does not. Carries the offending node type and the rule it broke so
 * a failing golden points straight at the bad shape.
 */
export class ContentModelError extends Error {
  override name = 'ContentModelError'
}

/** The child node types a `blockquote` never holds; Jira flattens a heading or a nested quote out of one. */
const blockquoteForbids: ReadonlySet<string> = new Set(['heading', 'blockquote'])

/** The child node types a `panel` never holds; a code block, table, nested panel, or quote is invalid inside one. */
const panelForbids: ReadonlySet<string> = new Set(['codeBlock', 'table', 'panel', 'blockquote'])

/**
 * Walks an emitted ADF tree and throws a {@link ContentModelError} on the node
 * content-model violations the epic's node-family tickets guard against — the
 * classes of shape Jira rejects even though they pass the ADF JSON schema:
 *
 * - a `heading` or nested `blockquote` inside a `blockquote`;
 * - a `codeBlock`, `table`, `panel`, or `blockquote` inside a `panel`;
 * - an `expand` anywhere but the document's top level;
 * - a `mediaSingle` anywhere but the document's top level (Jira rejects one inside
 *   a paragraph, panel, list item, or table cell, and the ADF JSON schema the
 *   `@atlaskit/adf-utils` validator tracks does not — so the converter only ever
 *   emits `mediaSingle` as a top-level block, and this pins that);
 * - a `tableCell` or `tableHeader` with no block child.
 *
 * `ancestors` carries the chain of node types from the document root, so the
 * top-level checks on `expand` and `mediaSingle` and the parent check on each
 * child come from one recursion.
 */
export function assertContentModel(node: AdfNode, ancestors: string[] = []): void {
  const parent = ancestors[ancestors.length - 1]

  if (node.type === 'expand' && parent !== undefined && parent !== 'doc') {
    throw new ContentModelError(`expand must sit at the document top level, not inside ${parent}`)
  }
  if (node.type === 'mediaSingle' && parent !== 'doc') {
    throw new ContentModelError(`mediaSingle must sit at the document top level, not inside ${String(parent)}`)
  }
  if ((node.type === 'tableCell' || node.type === 'tableHeader') && (node.content ?? []).length === 0) {
    throw new ContentModelError(`${node.type} must hold at least one block child`)
  }

  for (const child of node.content ?? []) {
    if (node.type === 'blockquote' && blockquoteForbids.has(child.type)) {
      throw new ContentModelError(`blockquote cannot hold a ${child.type}`)
    }
    if (node.type === 'panel' && panelForbids.has(child.type)) {
      throw new ContentModelError(`panel cannot hold a ${child.type}`)
    }
    assertContentModel(child, [...ancestors, node.type])
  }
}
