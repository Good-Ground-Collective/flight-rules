import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { decodeString } from 'micromark-util-decode-string'
import type { Blockquote, List, ListItem, Paragraph, PhrasingContent, Root, RootContent, Table } from 'mdast'
import { z } from 'zod'
import type { AdfDocNode, AdfMark, AdfNode } from './adf.js'

/**
 * One uploaded attachment addressed by its media-services UUID. `collection` is
 * the empty string for a Jira issue (Jira normalizes any other value on save),
 * and `width`/`height` are supplied when the upload path knows the image's pixel
 * dimensions, which Atlassian requires for the media to render.
 */
export const MediaRefSchema = z.object({
  mediaUuid: z.string().min(1),
  collection: z.string().default(''),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/** Attachments keyed by filename, the human-legible key that survives a read-modify-write. */
export const MediaLookupSchema = z.record(z.string(), MediaRefSchema)

export type MediaRef = z.infer<typeof MediaRefSchema>
export type MediaLookup = z.infer<typeof MediaLookupSchema>

const detailsOpen = /^<details>/
const detailsClose = /^<\/details>/
const summaryTag = /<summary>([\s\S]*?)<\/summary>/

/**
 * GitHub admonition markers, in source order, keyed to the ADF `panel` panelType
 * that renders them. IMPORTANT collapses onto `note` because Atlassian offers no
 * distinct panel for it and both read as a purple callout — that visual judgement
 * lives only here so the inverse (`alertMarkers`) stays exact. See
 * docs/bug-report-format.md, whose Trap-for-QA CAUTION relies on the error panel.
 */
const panelTypes: Record<string, string> = {
  NOTE: 'info',
  TIP: 'success',
  IMPORTANT: 'note',
  WARNING: 'warning',
  CAUTION: 'error',
}

const alertMarkers: Record<string, string> = Object.fromEntries(
  Object.entries(panelTypes).map(([marker, panelType]) => [panelType, marker]),
)

const alertMarker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/

const headingLine = /^#{1,6} \S/

/**
 * The ADF node types each container admits. ADF's content models are narrower
 * than GFM's, so anything outside these degrades to literal paragraph text on the
 * way in, which keeps the emitted ADF schema-valid and the markdown round-tripping.
 */
const quoteContent: ReadonlySet<string> = new Set(['paragraph', 'bulletList', 'orderedList', 'codeBlock'])
const panelContent: ReadonlySet<string> = new Set(['paragraph', 'heading', 'bulletList', 'orderedList'])

export interface MarkdownAdfConverter {
  toAdf(markdown: string, media?: MediaLookup): AdfDocNode
  toMarkdown(nodes: AdfNode[], media?: MediaLookup): string
}

/**
 * Bidirectional markdown ⇄ ADF conversion for the layered-body subset
 * (docs/layered-body-format.md): headings, paragraphs with emphasis / strong /
 * strikethrough / code / link marks, fenced code blocks, task lists, nested
 * bullet and ordered lists, thematic breaks, and `<details>` blocks (mapped to
 * ADF expands). The write direction parses with `mdast-util-from-markdown` plus
 * the GFM extensions and maps mdast nodes to ADF in a `switch` on `node.type`;
 * the read direction is a hand-written emitter, kept off mdast so `*`/`_` are
 * never over-escaped. mdast nests marks where ADF flattens them onto one text
 * node, so the emitter coalesces each text node's stored (outermost-first) marks
 * into shared spans — opening a delimiter when a mark first applies across
 * adjacent nodes and closing it only once it stops — which keeps a link inside
 * or outside a bold consistent with how it was authored and avoids re-opening a
 * span per node. GFM tables, blockquotes, and GitHub admonitions map to ADF
 * `table`, `blockquote`, and `panel`; because those content models are narrower
 * than GFM's (a blockquote rejects headings and nested quotes, a panel rejects
 * code blocks, a cell holds one paragraph), disallowed children degrade to
 * literal paragraph text sliced from source so the ADF stays schema-valid and the
 * markdown round-trips. A paragraph that is a single image whose target resolves
 * in the optional `MediaLookup` (keyed by filename, or matched by media UUID)
 * becomes a `mediaSingle > media` node so an uploaded attachment renders inline,
 * and reads back to an `![alt](attachment:<filename>)` reference, degrading to the
 * UUID when the lookup is empty; an external or unresolved image stays literal
 * text. Unknown ADF nodes flatten to their text on read. A
 * `@{accountId|Display Name}` token in inline text becomes an ADF `mention` node
 * and back; identity is resolved outside the converter, so the display written is
 * only a hint.
 */
export class LayeredBodyAdfConverter implements MarkdownAdfConverter {
  toAdf(markdown: string, media: MediaLookup = {}): AdfDocNode {
    const source = markdown.replace(/\r\n/g, '\n')
    const tree = this.parse(source)
    return { version: 1, type: 'doc', content: this.blocks(tree.children, source, undefined, media) }
  }

  toMarkdown(nodes: AdfNode[], media: MediaLookup = {}): string {
    const names = new Map(Object.entries(media).map(([filename, ref]) => [ref.mediaUuid, filename]))
    return this.render(nodes, names)
  }

  private render(nodes: AdfNode[], names: Map<string, string>): string {
    return nodes
      .map((node) => this.blockToMarkdown(node, names))
      .filter((block) => block.length > 0)
      .join('\n\n')
  }

  private parse(markdown: string): Root {
    return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  }

  /**
   * Maps a run of sibling mdast blocks to ADF. `allowed`, when a container passes
   * it, restricts the output to that container's content model: a node whose ADF
   * type falls outside the set degrades to literal paragraph text rather than an
   * invalid child.
   */
  private blocks(nodes: RootContent[], source: string, allowed?: ReadonlySet<string>, media: MediaLookup = {}): AdfNode[] {
    const out: AdfNode[] = []
    let i = 0
    while (i < nodes.length) {
      const node = nodes[i]
      if (node === undefined) {
        i++
        continue
      }
      if (allowed !== undefined && !allowed.has(this.adfType(node))) {
        out.push(this.literalBlock(node, source, true))
        i++
        continue
      }
      if (node.type === 'html' && detailsOpen.test(node.value)) {
        const paired = this.pairDetails(nodes, i, source)
        if (paired !== undefined) {
          out.push(paired.node)
          i = paired.next
          continue
        }
        // Unclosed <details>: emit the opener as literal text so parsing always advances.
        out.push(this.literalBlock(node, source))
        i++
        continue
      }
      if (node.type === 'list') {
        out.push(...this.listNodes(node, source))
        i++
        continue
      }
      out.push(this.blockNode(node, source, media))
      i++
    }
    return out
  }

  private blockNode(node: RootContent, source: string, media: MediaLookup): AdfNode {
    switch (node.type) {
      case 'heading':
        return { type: 'heading', attrs: { level: node.depth }, content: this.inline(node.children, source) }
      case 'paragraph':
        return this.mediaSingle(node, media) ?? { type: 'paragraph', content: this.inline(node.children, source) }
      case 'code': {
        const lang = node.lang
        const hasLang = lang !== null && lang !== undefined && lang !== ''
        return {
          type: 'codeBlock',
          attrs: hasLang ? { language: lang } : {},
          content: node.value === '' ? [] : [{ type: 'text', text: node.value }],
        }
      }
      case 'thematicBreak':
        return { type: 'rule' }
      case 'blockquote':
        return this.quoteOrPanel(node, source)
      case 'table':
        return this.table(node, source)
      default:
        return this.literalBlock(node, source)
    }
  }

  /**
   * A paragraph that holds a single image becomes an inline `mediaSingle > media`
   * node when its target resolves in the lookup, so an uploaded attachment renders
   * where the reader is looking. Returns undefined for anything else — an image
   * mid-sentence, or an unresolved target — leaving the paragraph to map its image
   * to literal text. `layout` is required by ADF; `alt` is emitted for Jira's own
   * example even though it is undocumented, and `width`/`height` only when known.
   */
  private mediaSingle(node: Paragraph, media: MediaLookup): AdfNode | undefined {
    const [only, ...rest] = node.children
    if (only === undefined || only.type !== 'image' || rest.length > 0) return undefined
    const ref = this.resolveMedia(only.url, media)
    if (ref === undefined) return undefined
    return {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        {
          type: 'media',
          attrs: {
            type: 'file',
            id: ref.mediaUuid,
            collection: ref.collection,
            alt: only.alt ?? '',
            ...(ref.width !== undefined ? { width: ref.width } : {}),
            ...(ref.height !== undefined ? { height: ref.height } : {}),
          },
        },
      ],
    }
  }

  /**
   * Resolves an image target to an uploaded attachment. The target's basename
   * (after stripping a leading `attachment:` and any directories) keys the lookup
   * first; failing that, the raw target after the prefix is matched against a
   * media UUID, so `attachment:<uuid>` resolves without a filename entry.
   */
  private resolveMedia(target: string, media: MediaLookup): MediaRef | undefined {
    const stripped = target.replace(/^attachment:/, '')
    const basename = stripped.slice(stripped.lastIndexOf('/') + 1)
    return media[basename] ?? Object.values(media).find((ref) => ref.mediaUuid === stripped)
  }

  /** The ADF block type an mdast node maps to, or `''` when it only degrades to literal text. */
  private adfType(node: RootContent): string {
    switch (node.type) {
      case 'heading':
        return 'heading'
      case 'paragraph':
        return 'paragraph'
      case 'code':
        return 'codeBlock'
      case 'thematicBreak':
        return 'rule'
      case 'blockquote':
        return 'blockquote'
      case 'table':
        return 'table'
      case 'list':
        return this.listAdfType(node)
      default:
        return ''
    }
  }

  private listAdfType(node: List): string {
    if (node.children.some((item) => item.checked === true || item.checked === false)) return 'taskList'
    return node.ordered === true ? 'orderedList' : 'bulletList'
  }

  /**
   * A blockquote whose first paragraph opens with a `[!TYPE]` marker is a GitHub
   * admonition and maps to an ADF `panel` — but only when its remaining blocks all
   * fit the panel content model. A code fence (or anything else a panel rejects)
   * forces the plain-`blockquote` fallback, which keeps the marker as literal text
   * in the first paragraph. A blockquote with no marker maps straight to
   * `blockquote`, its own disallowed children (headings, nested quotes) degrading.
   */
  private quoteOrPanel(node: Blockquote, source: string): AdfNode {
    const marker = this.alertType(node)
    const panelType = marker === undefined ? undefined : panelTypes[marker]
    if (marker !== undefined && panelType !== undefined) {
      const rest = this.stripAlertMarker(node.children)
      if (rest.every((child) => panelContent.has(this.adfType(child)))) {
        return { type: 'panel', attrs: { panelType }, content: this.withBlockContent(this.blocks(rest, source, panelContent)) }
      }
    }
    return { type: 'blockquote', content: this.withBlockContent(this.blocks(node.children, source, quoteContent)) }
  }

  /**
   * ADF's `panel` and `blockquote` content models require at least one child, so a
   * marker-only alert or a bare `>` (which leave no body) get an empty paragraph
   * rather than an empty, schema-invalid container.
   */
  private withBlockContent(nodes: AdfNode[]): AdfNode[] {
    return nodes.length === 0 ? [{ type: 'paragraph', content: [] }] : nodes
  }

  private alertType(node: Blockquote): string | undefined {
    const first = node.children[0]
    if (first === undefined || first.type !== 'paragraph') return undefined
    const text = first.children[0]
    if (text === undefined || text.type !== 'text') return undefined
    return alertMarker.exec(text.value)?.[1]
  }

  /**
   * Returns the blockquote's children with the admonition marker (and its trailing
   * newline) removed from the first paragraph, dropping that paragraph when nothing
   * but the marker remained. mdast keeps the marker and the first body line in one
   * text node when no blank `>` line separates them, so only the leading text is rewritten.
   */
  private stripAlertMarker(children: Blockquote['children']): Blockquote['children'] {
    const [first, ...rest] = children
    if (first === undefined || first.type !== 'paragraph') return children
    const [text, ...moreInline] = first.children
    if (text === undefined || text.type !== 'text') return children

    const stripped = text.value.replace(alertMarker, '')
    const inline: PhrasingContent[] = stripped === '' ? moreInline : [{ ...text, value: stripped }, ...moreInline]
    if (inline.length === 0) return rest
    return [{ ...first, children: inline }, ...rest]
  }

  /**
   * mdast tables carry phrasing cells and per-column alignment; ADF cells hold
   * block content and cannot express alignment, so each cell becomes a single
   * paragraph, the first row's cells become `tableHeader`, and `node.align` is
   * dropped. An empty cell keeps an empty paragraph so every cell has block content.
   */
  private table(node: Table, source: string): AdfNode {
    const rows = node.children.map((row, index) => ({
      type: 'tableRow',
      content: row.children.map((cell) => ({
        type: index === 0 ? 'tableHeader' : 'tableCell',
        attrs: {},
        content: [{ type: 'paragraph', content: this.inline(cell.children, source) }],
      })),
    }))
    return { type: 'table', content: rows }
  }

  /**
   * Re-pairs a `<details>`/`</details>` run of sibling blocks into a single
   * expand. `mdast-util-from-markdown` emits an `html` node for each opener and
   * closer with the inner markdown as ordinary siblings between them, so this
   * scans forward counting nesting depth on those html nodes. The `<summary>`
   * (which shares the opener's html node) becomes the title; if the author left
   * content after `</summary>` on the same html block instead of a blank line,
   * that remainder is parsed and prepended to the inner blocks. An unclosed run
   * returns undefined so the caller degrades the opener to literal text.
   */
  private pairDetails(
    nodes: RootContent[],
    start: number,
    source: string,
  ): { node: AdfNode; next: number } | undefined {
    const opener = nodes[start]
    if (opener === undefined || opener.type !== 'html') return undefined

    let depth = 0
    let end = -1
    for (let j = start; j < nodes.length; j++) {
      const sibling = nodes[j]
      if (sibling === undefined) continue
      if (sibling.type === 'html' && detailsOpen.test(sibling.value)) depth++
      else if (sibling.type === 'html' && detailsClose.test(sibling.value)) depth--
      if (depth === 0) {
        end = j
        break
      }
    }
    if (end === -1) return undefined

    const summary = opener.value.match(summaryTag)
    const title = summary?.[1]?.trim() ?? ''
    const remainder = summary === null ? '' : opener.value.slice((summary.index ?? 0) + summary[0].length)

    const inner = this.blocks(nodes.slice(start + 1, end), source)
    const leading = remainder.trim() === '' ? [] : this.blocks(this.parse(remainder).children, remainder)

    return { node: { type: 'expand', attrs: { title }, content: [...leading, ...inner] }, next: end + 1 }
  }

  private listNodes(node: List, source: string): AdfNode[] {
    if (node.children.some((item) => item.checked === true || item.checked === false)) {
      return this.taskList(node, source)
    }

    const ordered = node.ordered === true
    const start = typeof node.start === 'number' ? node.start : 1

    // ADF has no loose/tight concept, and today's output is one list per
    // blank-separated run, so a spread list splits into single-item lists whose
    // `\n\n` block join reproduces the blank lines.
    const spread = node.spread === true || node.children.some((item) => item.spread === true)
    if (spread) {
      return node.children.map((item, index) => this.singleList(ordered, start + index, [item], source))
    }
    return [this.singleList(ordered, start, node.children, source)]
  }

  private singleList(ordered: boolean, order: number, items: ListItem[], source: string): AdfNode {
    const content = items.map((item) => ({ type: 'listItem', content: this.blocks(item.children, source) }))
    if (!ordered) return { type: 'bulletList', content }
    return { type: 'orderedList', ...(order === 1 ? {} : { attrs: { order } }), content }
  }

  /**
   * ADF's `taskItem` is inline-only, so each item takes just the inline content
   * of its leading paragraph. A task item's remaining blocks (a nested list or a
   * continuation paragraph) can't live inside the taskItem or nest a list within
   * it — both are invalid ADF — so they spill out as sibling blocks after the
   * taskList, preserving the content without corrupting the flat-checklist case
   * that gets posted to Jira. Round-trip stays valid; the rare nested case flattens.
   */
  private taskList(node: List, source: string): AdfNode[] {
    const overflow: AdfNode[] = []
    const content = node.children.map((item, index) => {
      const first = item.children[0]
      const leadsWithParagraph = first !== undefined && first.type === 'paragraph'
      overflow.push(...this.blocks(leadsWithParagraph ? item.children.slice(1) : item.children, source))
      return {
        type: 'taskItem',
        attrs: { localId: `task-${index + 1}`, state: item.checked === true ? 'DONE' : 'TODO' },
        content: leadsWithParagraph ? this.inline(first.children, source) : [],
      }
    })
    return [{ type: 'taskList', attrs: { localId: 'task-list' }, content }, ...overflow]
  }

  private inline(nodes: PhrasingContent[], source: string, marks: AdfMark[] = []): AdfNode[] {
    const out: AdfNode[] = []
    for (const node of nodes) {
      switch (node.type) {
        case 'text': {
          // #121 tokenizes mentions over the raw source slice, because only the
          // source distinguishes an escaped `\@{…}` from a real `@{…}`. But #119's
          // block nodes rely on inline text coming from mdast's decoded value:
          // `stripAlertMarker` rewrites that value, and a blockquote/panel
          // continuation line loses its `> ` there but keeps it in source. When no
          // real mention is found, that decoded value is authoritative, so fall
          // back to it rather than the marker-bearing source slice.
          const segments = this.mentionSegments(this.literal(node, source), marks)
          const hasMention = segments.some((segment) => segment.type === 'mention')
          out.push(...(hasMention ? segments : this.textSegments(node.value, marks)))
          break
        }
        case 'emphasis':
          out.push(...this.inline(node.children, source, [...marks, { type: 'em' }]))
          break
        case 'strong':
          out.push(...this.inline(node.children, source, [...marks, { type: 'strong' }]))
          break
        case 'delete':
          out.push(...this.inline(node.children, source, [...marks, { type: 'strike' }]))
          break
        // ADF's code mark excludes fontStyle marks (so inherited emphasis/strong drop) but keeps an enclosing link.
        case 'inlineCode':
          out.push({
            type: 'text',
            text: node.value,
            marks: [...marks.filter((mark) => mark.type === 'link'), { type: 'code' }],
          })
          break
        case 'break':
          out.push({ type: 'hardBreak' })
          break
        case 'link': {
          const hasTitle = typeof node.title === 'string' && node.title !== ''
          const attrs = hasTitle ? { href: node.url, title: node.title } : { href: node.url }
          const link: AdfMark = { type: 'link', attrs }
          out.push(...this.inline(node.children, source, [...marks.filter((mark) => mark.type !== 'link'), link]))
          break
        }
        default:
          out.push({ type: 'text', text: this.literal(node, source), ...(marks.length > 0 ? { marks } : {}) })
      }
    }
    return out
  }

  /**
   * Splits a text value on soft line breaks. mdast keeps a soft break as a `\n`
   * inside one `text` node, but today's ADF interleaves `hardBreak` nodes and
   * the multi-line-paragraph round-trip depends on that.
   */
  private textSegments(value: string, marks: AdfMark[]): AdfNode[] {
    const out: AdfNode[] = []
    value.split('\n').forEach((segment, index) => {
      if (index > 0) out.push({ type: 'hardBreak' })
      out.push({ type: 'text', text: segment, ...(marks.length > 0 ? { marks } : {}) })
    })
    return out
  }

  /**
   * Splits `@{accountId|Display Name}` tokens out of an inline text node into
   * `mention` nodes, emitting the surrounding text (and soft breaks) as before.
   * Tokenizing runs over the raw source slice, not the decoded value, because
   * mdast collapses `\@{…}`, `@{…}`, and `&#64;{…}` to the same value; only the
   * source still tells an escaped token from a real one. The account id and
   * display are then decoded on their own, so an entity or escape inside the
   * display survives. An escaped token, or a pipe-less `@{Name}`, stays literal
   * text; the id resolves identity, and mentions never carry marks.
   */
  private mentionSegments(raw: string, marks: AdfMark[]): AdfNode[] {
    const out: AdfNode[] = []
    const regex = this.mentionToken()
    let buffer = ''
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(raw)) !== null) {
      buffer += raw.slice(cursor, match.index)
      cursor = match.index + match[0].length
      if (this.isEscaped(raw, match.index)) {
        buffer += match[0]
        continue
      }
      if (buffer.length > 0) {
        out.push(...this.textSegments(decodeString(buffer), marks))
        buffer = ''
      }
      out.push(this.mention(decodeString(match[1] ?? ''), decodeString(match[2] ?? '')))
    }
    buffer += raw.slice(cursor)
    if (buffer.length > 0 || out.length === 0) out.push(...this.textSegments(decodeString(buffer), marks))
    return out
  }

  /** A token is escaped when an odd run of backslashes precedes its `@`. */
  private isEscaped(raw: string, index: number): boolean {
    let backslashes = 0
    for (let i = index - 1; i >= 0 && raw[i] === '\\'; i--) backslashes++
    return backslashes % 2 === 1
  }

  private mention(id: string, display: string): AdfNode {
    return { type: 'mention', attrs: { id, ...(display !== '' ? { text: `@${display}` } : {}) } }
  }

  /**
   * The canonical mention token `@{accountId|Display Name}`. The pipe is
   * required so a literal `@{Name}` stays text, and the display admits `\`
   * escapes so a display carrying a brace or markdown delimiter round-trips.
   * Built fresh per call because the `g` flag carries `lastIndex` and the inline
   * walk recurses.
   */
  private mentionToken(): RegExp {
    return /@\{([^|{}\n]+)\|((?:\\[^\n]|[^{}\\\n])*)\}/g
  }

  /**
   * Degrades an unmappable block to a literal paragraph of its source text. When
   * demoted into a container that re-quotes its body (a blockquote), the outer
   * `> ` on each continuation line belongs to the enclosing quote, not the child —
   * mdast strips it from the first line only — so `stripEnclosingQuote` removes one
   * quote level from the rest. Otherwise a nested quote, quoted table, or quoted
   * task list would accrete a `>` on every round trip.
   */
  private literalBlock(node: RootContent, source: string, stripEnclosingQuote = false): AdfNode {
    const text = this.literal(node, source)
    const inner = stripEnclosingQuote ? this.stripEnclosingQuote(text) : text
    return { type: 'paragraph', content: this.textSegments(inner, []) }
  }

  private stripEnclosingQuote(text: string): string {
    return text
      .split('\n')
      .map((line, index) => (index === 0 ? line : line.replace(/^> ?/, '')))
      .join('\n')
  }

  private literal(node: RootContent | PhrasingContent, source: string): string {
    return source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0)
  }

  private blockToMarkdown(node: AdfNode, names: Map<string, string>): string {
    switch (node.type) {
      case 'heading': {
        const level = typeof node.attrs?.['level'] === 'number' ? node.attrs['level'] : 1
        return `${'#'.repeat(level)} ${this.inlineToMarkdown(node.content ?? [], names)}`
      }
      case 'paragraph':
        return this.inlineToMarkdown(node.content ?? [], names)
      case 'codeBlock': {
        const language = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : ''
        const text = (node.content ?? []).map((child) => child.text ?? '').join('')
        return `\`\`\`${language}\n${text}\n\`\`\``
      }
      case 'taskList':
        // A taskItem is inline-only, so it renders as a single checklist line.
        return (node.content ?? [])
          .map(
            (item) =>
              `- [${item.attrs?.['state'] === 'DONE' ? 'x' : ' '}] ${this.inlineToMarkdown(item.content ?? [], names)}`,
          )
          .join('\n')
      case 'bulletList':
        return (node.content ?? []).map((item) => this.listItemToMarkdown(item, '- ', names)).join('\n')
      case 'orderedList': {
        const order = typeof node.attrs?.['order'] === 'number' ? node.attrs['order'] : 1
        return (node.content ?? [])
          .map((item, index) => this.listItemToMarkdown(item, `${order + index}. `, names))
          .join('\n')
      }
      case 'expand': {
        const title = typeof node.attrs?.['title'] === 'string' ? node.attrs['title'] : ''
        return `<details><summary>${title}</summary>\n\n${this.render(node.content ?? [], names)}\n\n</details>`
      }
      case 'rule':
        return '---'
      case 'table':
        return this.tableToMarkdown(node, names)
      case 'blockquote':
        return this.quoteToMarkdown(this.containerBody(node.content ?? [], names))
      case 'panel':
        return this.panelToMarkdown(node, names)
      // A media node lands here directly (inside a mediaSingle) or standalone; both read back as a reference.
      case 'mediaSingle':
      case 'mediaGroup':
        return (node.content ?? []).map((child) => this.blockToMarkdown(child, names)).join('\n\n')
      case 'media':
        return this.mediaReference(node, names)
      default:
        // unknown blocks (layoutSection, …) flatten so UI-authored content never throws
        return node.text ?? this.render(node.content ?? [], names)
    }
  }

  /**
   * Recovers an image reference from a `media` (or `mediaInline`) node. A
   * `type: 'external'` node carries a `url` and reads back as `![alt](url)`;
   * otherwise the filename comes from the inverted lookup and degrades to the
   * media UUID, never to `alt`, which Jira does not always preserve.
   */
  private mediaReference(node: AdfNode, names: Map<string, string>): string {
    const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs['alt'] : ''
    const url = node.attrs?.['url']
    if (typeof url === 'string') return `![${alt}](${url})`
    const id = typeof node.attrs?.['id'] === 'string' ? node.attrs['id'] : ''
    return `![${alt}](attachment:${names.get(id) ?? id})`
  }

  /**
   * Joins a container's child blocks. A markdown heading is self-delimiting, so
   * the block after one needs no blank line; every other block gets the usual
   * blank line. That reproduces `> ## x` then `> body` (a heading demoted to
   * literal text inside a quote) and a panel heading followed by a paragraph.
   */
  private containerBody(nodes: AdfNode[], names: Map<string, string>): string {
    let out = ''
    for (const node of nodes) {
      const rendered = this.blockToMarkdown(node, names)
      if (rendered.length === 0) continue
      if (out.length === 0) {
        out = rendered
        continue
      }
      const previousLine = out.slice(out.lastIndexOf('\n') + 1)
      out = `${out}${headingLine.test(previousLine) ? '\n' : '\n\n'}${rendered}`
    }
    return out
  }

  private quoteToMarkdown(body: string): string {
    return body
      .split('\n')
      .map((line) => (line.length === 0 ? '>' : `> ${line}`))
      .join('\n')
  }

  /**
   * Emits an admonition as `> [!TYPE]` over the quoted body. An unknown panelType
   * has no marker to restore, so it degrades to a plain blockquote.
   */
  private panelToMarkdown(node: AdfNode, names: Map<string, string>): string {
    const panelType = typeof node.attrs?.['panelType'] === 'string' ? node.attrs['panelType'] : ''
    const marker = alertMarkers[panelType]
    const body = this.containerBody(node.content ?? [], names)
    if (marker === undefined) return this.quoteToMarkdown(body)
    return body.length === 0 ? `> [!${marker}]` : `> [!${marker}]\n${this.quoteToMarkdown(body)}`
  }

  /**
   * Emits a GFM table: a header row, a `---` delimiter (alignment is not
   * representable in ADF and is dropped), then the body. The first row is always
   * the header even when its cells read back as `tableCell`.
   */
  private tableToMarkdown(node: AdfNode, names: Map<string, string>): string {
    const lines: string[] = []
    ;(node.content ?? []).forEach((row, index) => {
      const cells = (row.content ?? []).map((cell) => this.cellToMarkdown(cell, names))
      lines.push(`| ${cells.join(' | ')} |`)
      if (index === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    })
    return lines.join('\n')
  }

  /**
   * Flattens a cell's block content to one line: blocks join with a space, a UI
   * cell's internal newlines collapse to spaces, and a literal `|` re-escapes so
   * it survives GFM's cell parse (which unescapes `\|`) instead of splitting the row.
   */
  private cellToMarkdown(cell: AdfNode, names: Map<string, string>): string {
    return (cell.content ?? [])
      .map((block) => this.blockToMarkdown(block, names))
      .join(' ')
      .replace(/\n/g, ' ')
      .replace(/\|/g, '\\|')
  }

  /**
   * Emits one list item and its nested blocks. ADF holds a nested list as a
   * sibling of the item's paragraph, so a nested list joins onto the item with a
   * single newline while any other block joins with a blank line; continuation
   * lines then indent by the marker width, nesting `- ` at two spaces, `1. ` at
   * three, and `10. ` at four.
   */
  private listItemToMarkdown(item: AdfNode, marker: string, names: Map<string, string>): string {
    let body = ''
    for (const block of item.content ?? []) {
      const rendered = this.blockToMarkdown(block, names)
      if (rendered.length === 0) continue
      const nestedList = block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList'
      body = body.length === 0 ? rendered : `${body}${nestedList ? '\n' : '\n\n'}${rendered}`
    }
    const indent = ' '.repeat(marker.length)
    return `${marker}${body.replace(/\n/g, `\n${indent}`)}`
  }

  /**
   * Serializes a text node's marks as coalesced spans rather than wrapping each
   * node independently. Marks are stored outermost-first, so a delimiter opens
   * when a mark first appears across adjacent nodes and closes only once it stops
   * applying to the next node. That keeps a mark spanning several text nodes as a
   * single span (`**before [x](u) after**`) instead of re-opening it per node,
   * which would re-parse to duplicate marks. Text inside a code span is emitted
   * verbatim; all other text is escaped so decoded literals (`literal *x*`)
   * don't re-parse as syntax.
   */
  private inlineToMarkdown(nodes: AdfNode[], names: Map<string, string>): string {
    let out = ''
    const open: AdfMark[] = []
    const closeFrom = (from: number): void => {
      while (open.length > from) {
        const mark = open.pop()
        if (mark !== undefined) out += this.markClose(mark)
      }
    }
    for (const node of nodes) {
      if (node.type === 'mediaInline') {
        // An inline attachment reads back as its reference beside the surrounding text; marks stay open around it.
        out += this.mediaReference(node, names)
        continue
      }
      if (node.type === 'mention') {
        // A code span swallows a following mention into its literal text, so it
        // closes here (the next text reopens it); other marks wrap the mention
        // harmlessly, and closing them after a space would be an invalid
        // delimiter, so they stay open.
        const codeDepth = open.findIndex((mark) => mark.type === 'code')
        if (codeDepth !== -1) closeFrom(codeDepth)
        out += this.mentionToMarkdown(node)
        continue
      }
      if (node.type === 'hardBreak') {
        closeFrom(0)
        out += '\n'
        continue
      }
      if (node.text === undefined) {
        // A content-bearing inline node can't share a span, so flush open marks and reapply its own innermost-first.
        closeFrom(0)
        const inner = node.content !== undefined ? this.inlineToMarkdown(node.content, names) : ''
        out += [...(node.marks ?? [])].reverse().reduce((text, mark) => this.applyMark(text, mark), inner)
        continue
      }
      const marks = node.marks ?? []
      const solo = marks[0]
      if (marks.length === 1 && open.length === 0 && solo !== undefined) {
        const bare = this.tryBareUrl(node.text, solo)
        if (bare !== undefined) {
          out += bare
          continue
        }
      }
      let common = 0
      while (common < open.length && common < marks.length) {
        const opened = open[common]
        const wanted = marks[common]
        if (opened === undefined || wanted === undefined || !this.marksEqual(opened, wanted)) break
        common++
      }
      closeFrom(common)

      const opening = marks.slice(common)
      let text = node.text
      // An emphasis delimiter can't abut whitespace, so a fresh span's leading space moves out.
      if (common === 0 && opening.length > 0 && opening.every((mark) => this.isEmphasis(mark))) {
        const lead = /^\s+/.exec(text)?.[0]
        if (lead !== undefined && lead.length < text.length) {
          out += lead
          text = text.slice(lead.length)
        }
      }

      for (let k = common; k < marks.length; k++) {
        const mark = marks[k]
        if (mark === undefined) continue
        out += this.markOpen(mark)
        open.push(mark)
      }
      out += this.escapeText(text, open.some((mark) => mark.type === 'code'))
    }
    closeFrom(0)
    return out
  }

  private isEmphasis(mark: AdfMark): boolean {
    return mark.type === 'em' || mark.type === 'strong' || mark.type === 'strike'
  }

  /**
   * Emits a `mention` node as `@{id|display}`, dropping the leading `@` from
   * `attrs.text`, and `@{id|}` when `attrs.text` is absent so the read is Jira's
   * to re-resolve from the id. The display is escaped so the token re-parses
   * atomically instead of losing the mention to markdown inside the name.
   */
  private mentionToMarkdown(node: AdfNode): string {
    const id = typeof node.attrs?.['id'] === 'string' ? node.attrs['id'] : ''
    const text = node.attrs?.['text']
    const display = typeof text === 'string' ? (text.startsWith('@') ? text.slice(1) : text) : ''
    return `@{${id}|${this.escapeMentionDisplay(display)}}`
  }

  /**
   * Escapes a display name so `@{id|display}` re-parses as one mention: the
   * `}` terminator, `\` itself, the markdown delimiters that would re-interpret
   * the name, and `&` (which would otherwise decode as an entity) each gain a
   * backslash that `decodeString` strips on the way back.
   */
  private escapeMentionDisplay(display: string): string {
    return display.replace(/[\\{}*_`[\]&]/g, (ch) => `\\${ch}`)
  }

  /**
   * Wraps text in the markdown for one mark, innermost-first. Only used for the
   * rare content-bearing inline node; the main text path coalesces marks instead.
   */
  private applyMark(text: string, mark: AdfMark): string {
    switch (mark.type) {
      case 'code':
        return `\`${text}\``
      case 'em':
        return `*${text}*`
      case 'strong':
        return `**${text}**`
      case 'strike':
        return `~~${text}~~`
      case 'link':
        return this.linkToMarkdown(text, mark)
      default:
        return text
    }
  }

  private markOpen(mark: AdfMark): string {
    switch (mark.type) {
      case 'code':
        return '`'
      case 'em':
        return '*'
      case 'strong':
        return '**'
      case 'strike':
        return '~~'
      case 'link':
        return typeof mark.attrs?.['href'] === 'string' ? '[' : ''
      default:
        return ''
    }
  }

  private markClose(mark: AdfMark): string {
    switch (mark.type) {
      case 'code':
        return '`'
      case 'em':
        return '*'
      case 'strong':
        return '**'
      case 'strike':
        return '~~'
      case 'link':
        return this.linkClose(mark)
      default:
        return ''
    }
  }

  private linkClose(mark: AdfMark): string {
    const href = mark.attrs?.['href']
    if (typeof href !== 'string') return ''
    const title = mark.attrs?.['title']
    const suffix = typeof title === 'string' ? ` "${this.encodeTitle(title)}"` : ''
    return `](${this.encodeDestination(href)}${suffix})`
  }

  private marksEqual(a: AdfMark, b: AdfMark): boolean {
    if (a.type !== b.type) return false
    if (a.type === 'link') return a.attrs?.['href'] === b.attrs?.['href'] && a.attrs?.['title'] === b.attrs?.['title']
    return true
  }

  /**
   * Collapses a link whose visible text equals its destination to the bare url,
   * but only when the destination needs no escaping and there's no title — so the
   * autolink re-parses to the same href. Otherwise the caller emits `[text](dest)`.
   */
  private tryBareUrl(text: string, mark: AdfMark): string | undefined {
    if (mark.type !== 'link') return undefined
    const href = mark.attrs?.['href']
    if (typeof href !== 'string') return undefined
    if (typeof mark.attrs?.['title'] === 'string') return undefined
    if (text !== href || this.encodeDestination(href) !== href) return undefined
    return href
  }

  private linkToMarkdown(text: string, mark: AdfMark): string {
    const href = mark.attrs?.['href']
    if (typeof href !== 'string') return text
    const bare = this.tryBareUrl(text, mark)
    if (bare !== undefined) return bare
    const title = mark.attrs?.['title']
    const suffix = typeof title === 'string' ? ` "${this.encodeTitle(title)}"` : ''
    return `[${text}](${this.encodeDestination(href)}${suffix})`
  }

  /**
   * Escapes a link destination so it re-parses to the same string: literal `\`
   * and `&` are backslash-escaped (mdast otherwise reads `&copy;` as an entity),
   * and a destination carrying spaces, control chars, or parens is wrapped in
   * `<...>` with its `<`/`>` escaped.
   */
  private encodeDestination(url: string): string {
    const escaped = url.replace(/[\\&]/g, (ch) => `\\${ch}`)
    // eslint-disable-next-line no-control-regex -- a control char in a bare destination is invalid, so force the <...> form
    if (/[ \t -()]/.test(url)) return `<${escaped.replace(/[<>]/g, (ch) => `\\${ch}`)}>`
    return escaped
  }

  /**
   * Escapes a link title emitted inside `"..."`: `\`, `&`, and the `"` delimiter
   * are backslash-escaped so the title re-parses unchanged instead of breaking
   * the link or being read as an entity.
   */
  private encodeTitle(title: string): string {
    return title.replace(/[\\&"]/g, (ch) => `\\${ch}`)
  }

  /**
   * Escapes literal text so mdast-decoded content doesn't re-parse as syntax:
   * `\`, `*`, and `` ` `` are the markers that would otherwise reinterpret plain
   * text as emphasis or code. Text inside a code span is left verbatim, and
   * characters that only matter at block scope (`[`, `|`, `>`, `!`) stay
   * unescaped so degraded literal blocks round-trip byte-for-byte. Marks like
   * emphasis are emitted via their own delimiters, not through this. A literal
   * text node that itself reads as a mention token (`@{id|name}`) is escaped to
   * `\@{…}` so it re-parses as text rather than a mention.
   */
  private escapeText(text: string, insideCode: boolean): string {
    if (insideCode) return text
    const escaped = text.replace(/[\\*`]/g, (ch) => `\\${ch}`)
    return escaped.replace(this.mentionToken(), (full) => `\\${full}`)
  }
}

export const markdownAdfConverter: MarkdownAdfConverter = new LayeredBodyAdfConverter()
