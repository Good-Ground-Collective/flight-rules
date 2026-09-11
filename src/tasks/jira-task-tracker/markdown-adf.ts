import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { List, ListItem, PhrasingContent, Root, RootContent } from 'mdast'
import type { AdfDocNode, AdfMark, AdfNode } from './adf.js'

const detailsOpen = /^<details>/
const detailsClose = /^<\/details>/
const summaryTag = /<summary>([\s\S]*?)<\/summary>/

export interface MarkdownAdfConverter {
  toAdf(markdown: string): AdfDocNode
  toMarkdown(nodes: AdfNode[]): string
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
 * node, so the emitter reapplies a text node's marks innermost-first following
 * their stored order, which keeps a link inside or outside a bold consistent
 * with how it was authored. Anything outside the mapped subset (images, tables,
 * blockquotes) degrades to literal text sliced from the node's source position
 * on write, so it round-trips unchanged until its own node-family ticket claims
 * it; unknown ADF nodes flatten to their text on read.
 */
export class LayeredBodyAdfConverter implements MarkdownAdfConverter {
  toAdf(markdown: string): AdfDocNode {
    const source = markdown.replace(/\r\n/g, '\n')
    const tree = this.parse(source)
    return { version: 1, type: 'doc', content: this.blocks(tree.children, source) }
  }

  toMarkdown(nodes: AdfNode[]): string {
    return nodes
      .map((node) => this.blockToMarkdown(node))
      .filter((block) => block.length > 0)
      .join('\n\n')
  }

  private parse(markdown: string): Root {
    return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  }

  private blocks(nodes: RootContent[], source: string): AdfNode[] {
    const out: AdfNode[] = []
    let i = 0
    while (i < nodes.length) {
      const node = nodes[i]
      if (node === undefined) {
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
      out.push(this.blockNode(node, source))
      i++
    }
    return out
  }

  private blockNode(node: RootContent, source: string): AdfNode {
    switch (node.type) {
      case 'heading':
        return { type: 'heading', attrs: { level: node.depth }, content: this.inline(node.children, source) }
      case 'paragraph':
        return { type: 'paragraph', content: this.inline(node.children, source) }
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
      default:
        return this.literalBlock(node, source)
    }
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
      return [this.taskList(node, source)]
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

  private taskList(node: List, source: string): AdfNode {
    const content = node.children.map((item, index) => {
      const first = item.children[0]
      return {
        type: 'taskItem',
        attrs: { localId: `task-${index + 1}`, state: item.checked === true ? 'DONE' : 'TODO' },
        content: first !== undefined && first.type === 'paragraph' ? this.inline(first.children, source) : [],
      }
    })
    return { type: 'taskList', attrs: { localId: 'task-list' }, content }
  }

  private inline(nodes: PhrasingContent[], source: string, marks: AdfMark[] = []): AdfNode[] {
    const out: AdfNode[] = []
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out.push(...this.textSegments(node.value, marks))
          break
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

  private literalBlock(node: RootContent, source: string): AdfNode {
    return { type: 'paragraph', content: this.textSegments(this.literal(node, source), []) }
  }

  private literal(node: RootContent | PhrasingContent, source: string): string {
    return source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0)
  }

  private blockToMarkdown(node: AdfNode): string {
    switch (node.type) {
      case 'heading': {
        const level = typeof node.attrs?.['level'] === 'number' ? node.attrs['level'] : 1
        return `${'#'.repeat(level)} ${this.inlineToMarkdown(node.content ?? [])}`
      }
      case 'paragraph':
        return this.inlineToMarkdown(node.content ?? [])
      case 'codeBlock': {
        const language = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : ''
        const text = (node.content ?? []).map((child) => child.text ?? '').join('')
        return `\`\`\`${language}\n${text}\n\`\`\``
      }
      case 'taskList':
        return (node.content ?? [])
          .map(
            (item) =>
              `- [${item.attrs?.['state'] === 'DONE' ? 'x' : ' '}] ${this.inlineToMarkdown(item.content ?? [])}`,
          )
          .join('\n')
      case 'bulletList':
        return (node.content ?? []).map((item) => this.listItemToMarkdown(item, '- ')).join('\n')
      case 'orderedList': {
        const order = typeof node.attrs?.['order'] === 'number' ? node.attrs['order'] : 1
        return (node.content ?? []).map((item, index) => this.listItemToMarkdown(item, `${order + index}. `)).join('\n')
      }
      case 'expand': {
        const title = typeof node.attrs?.['title'] === 'string' ? node.attrs['title'] : ''
        return `<details><summary>${title}</summary>\n\n${this.toMarkdown(node.content ?? [])}\n\n</details>`
      }
      case 'rule':
        return '---'
      default:
        // unknown blocks (table, panel, media, …) flatten so UI-authored content never throws
        return node.text ?? this.toMarkdown(node.content ?? [])
    }
  }

  /**
   * Emits one list item and its nested blocks. ADF holds a nested list as a
   * sibling of the item's paragraph, so a nested list joins onto the item with a
   * single newline while any other block joins with a blank line; continuation
   * lines then indent by the marker width, nesting `- ` at two spaces, `1. ` at
   * three, and `10. ` at four.
   */
  private listItemToMarkdown(item: AdfNode, marker: string): string {
    let body = ''
    for (const block of item.content ?? []) {
      const rendered = this.blockToMarkdown(block)
      if (rendered.length === 0) continue
      const nestedList = block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList'
      body = body.length === 0 ? rendered : `${body}${nestedList ? '\n' : '\n\n'}${rendered}`
    }
    const indent = ' '.repeat(marker.length)
    return `${marker}${body.replace(/\n/g, `\n${indent}`)}`
  }

  private inlineToMarkdown(nodes: AdfNode[]): string {
    return nodes
      .map((node) => {
        if (node.type === 'hardBreak') return '\n'
        const inner = node.text ?? (node.content !== undefined ? this.inlineToMarkdown(node.content) : '')
        return [...(node.marks ?? [])].reverse().reduce((text, mark) => this.applyMark(text, mark), inner)
      })
      .join('')
  }

  /**
   * Wraps text in the markdown for one mark, called innermost-first so a text
   * node's marks reproduce their stored nesting: `[**x**](u)` keeps the link
   * outside the bold, `**[x](u)**` keeps it inside. A link whose text already
   * equals its href collapses to the bare url; marks with no markdown syntax
   * (underline, textColor, subsup, border) emit their text unchanged.
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

  private linkToMarkdown(text: string, mark: AdfMark): string {
    const href = mark.attrs?.['href']
    if (typeof href !== 'string') return text

    const title = mark.attrs?.['title']
    const suffix = typeof title === 'string' ? ` "${title}"` : ''
    return text === href && suffix === '' ? href : `[${text}](${href}${suffix})`
  }
}

export const markdownAdfConverter: MarkdownAdfConverter = new LayeredBodyAdfConverter()
