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
 * node, so the emitter coalesces each text node's stored (outermost-first) marks
 * into shared spans — opening a delimiter when a mark first applies across
 * adjacent nodes and closing it only once it stops — which keeps a link inside
 * or outside a bold consistent with how it was authored and avoids re-opening a
 * span per node. Anything outside the mapped subset (images, tables,
 * blockquotes) degrades to literal text sliced from the node's source position
 * on write, so it round-trips unchanged until its own node-family ticket claims
 * it; unknown ADF nodes flatten to their text on read. A `@{accountId|Display
 * Name}` token in inline text becomes an ADF `mention` node and back; identity
 * is resolved outside the converter, so the display written is only a hint.
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
        case 'text':
          out.push(...this.mentionSegments(node.value, this.literal(node, source), marks))
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

  /**
   * Splits `@{accountId|Display Name}` tokens out of a text value into inline
   * `mention` nodes, emitting the surrounding text (and soft breaks) as before.
   * mdast strips a leading backslash, so `\@{…}` and `@{…}` decode to the same
   * value; escape is recovered from the raw source, where the k-th token pairs
   * positionally with the k-th decoded match. A token without a pipe (`@{Name}`)
   * or an escaped one stays literal text. Mentions never carry marks.
   */
  private mentionSegments(value: string, raw: string, marks: AdfMark[]): AdfNode[] {
    const escaped = this.escapedTokenFlags(raw)
    const out: AdfNode[] = []
    const regex = this.mentionToken()
    let buffer = ''
    let cursor = 0
    let token = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(value)) !== null) {
      const isMention = escaped[token] !== true && match[2] !== undefined
      token++
      buffer += value.slice(cursor, match.index)
      cursor = match.index + match[0].length
      if (!isMention) {
        buffer += match[0]
        continue
      }
      if (buffer.length > 0) {
        out.push(...this.textSegments(buffer, marks))
        buffer = ''
      }
      out.push(this.mention(match[1] ?? '', match[2] ?? ''))
    }
    buffer += value.slice(cursor)
    if (buffer.length > 0 || out.length === 0) out.push(...this.textSegments(buffer, marks))
    return out
  }

  /**
   * Flags each mention token in the raw source as escaped when an odd run of
   * backslashes precedes it, so `\@{…}` is literal but `\\@{…}` is a real
   * mention behind an escaped backslash. Tokens keep source order, pairing with
   * the decoded matches one-for-one.
   */
  private escapedTokenFlags(raw: string): boolean[] {
    const regex = this.mentionToken()
    const flags: boolean[] = []
    let match: RegExpExecArray | null
    while ((match = regex.exec(raw)) !== null) {
      let backslashes = 0
      for (let i = match.index - 1; i >= 0 && raw[i] === '\\'; i--) backslashes++
      flags.push(backslashes % 2 === 1)
    }
    return flags
  }

  private mention(id: string, display: string): AdfNode {
    return { type: 'mention', attrs: { id, ...(display !== '' ? { text: `@${display}` } : {}) } }
  }

  /**
   * The canonical mention token `@{accountId|Display Name}`, its pipe and display
   * optional so a literal `@{Name}` is still recognized. Built fresh per call
   * because the `g` flag carries `lastIndex` and the inline walk recurses.
   */
  private mentionToken(): RegExp {
    return /@\{([^|{}]+)(?:\|([^{}]*))?\}/g
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
        // A taskItem is inline-only, so it renders as a single checklist line.
        return (node.content ?? [])
          .map((item) => `- [${item.attrs?.['state'] === 'DONE' ? 'x' : ' '}] ${this.inlineToMarkdown(item.content ?? [])}`)
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
  private inlineToMarkdown(nodes: AdfNode[]): string {
    let out = ''
    const open: AdfMark[] = []
    const closeFrom = (from: number): void => {
      while (open.length > from) {
        const mark = open.pop()
        if (mark !== undefined) out += this.markClose(mark)
      }
    }
    for (const node of nodes) {
      if (node.type === 'mention') {
        // A mention carries no marks, so it emits without disturbing the open span.
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
        const inner = node.content !== undefined ? this.inlineToMarkdown(node.content) : ''
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
      for (let k = common; k < marks.length; k++) {
        const mark = marks[k]
        if (mark === undefined) continue
        out += this.markOpen(mark)
        open.push(mark)
      }
      out += this.escapeText(node.text, open.some((mark) => mark.type === 'code'))
    }
    closeFrom(0)
    return out
  }

  /**
   * Emits a `mention` node as `@{id|display}`, dropping the leading `@` from
   * `attrs.text`, and `@{id|}` when `attrs.text` is absent so the read is Jira's
   * to re-resolve from the id.
   */
  private mentionToMarkdown(node: AdfNode): string {
    const id = typeof node.attrs?.['id'] === 'string' ? node.attrs['id'] : ''
    const text = node.attrs?.['text']
    const display = typeof text === 'string' ? (text.startsWith('@') ? text.slice(1) : text) : ''
    return `@{${id}|${display}}`
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
    return escaped.replace(this.mentionToken(), (full, _id, display) => (display !== undefined ? `\\${full}` : full))
  }
}

export const markdownAdfConverter: MarkdownAdfConverter = new LayeredBodyAdfConverter()
