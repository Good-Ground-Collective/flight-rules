import type { AdfDocNode, AdfNode } from './adf.js'

const fenceOpen = /^```(\S*)\s*$/
const fenceClose = /^```\s*$/
const headingLine = /^(#{1,6})\s+(.*)$/
const taskLine = /^-\s+\[( |x|X)\]\s+(.*)$/
const bulletLine = /^-\s+(.*)$/
const detailsOpen = /^<details>/
const detailsClose = /^<\/details>/

export interface MarkdownAdfConverter {
  toAdf(markdown: string): AdfDocNode
  toMarkdown(nodes: AdfNode[]): string
}

/**
 * Bidirectional markdown ⇄ ADF conversion for the layered-body subset
 * (docs/layered-body-format.md): headings, paragraphs with bold / code marks,
 * fenced code blocks, task lists, bullet lists, and `<details>` blocks (mapped
 * to ADF expands). Written bodies render as structured content in the Jira UI,
 * while reads reconstruct markdown so downstream pipeline steps
 * (break-down-work, execution agents) keep getting the format they parse.
 * Anything outside the subset degrades gracefully: unknown markdown stays
 * literal paragraph text on write, unknown ADF nodes flatten to their text on
 * read.
 */
export class LayeredBodyAdfConverter implements MarkdownAdfConverter {
  toAdf(markdown: string): AdfDocNode {
    return { version: 1, type: 'doc', content: this.parseBlocks(markdown.replace(/\r\n/g, '\n').split('\n')) }
  }

  toMarkdown(nodes: AdfNode[]): string {
    return nodes
      .map((node) => this.blockToMarkdown(node))
      .filter((block) => block.length > 0)
      .join('\n\n')
  }

  private parseBlocks(lines: string[]): AdfNode[] {
    const nodes: AdfNode[] = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line === undefined || line.trim() === '') {
        i++
        continue
      }

      const fence = line.match(fenceOpen)
      if (fence) {
        const body: string[] = []
        let j = i + 1
        while (j < lines.length && !fenceClose.test(lines[j] ?? '')) {
          body.push(lines[j] ?? '')
          j++
        }
        nodes.push({
          type: 'codeBlock',
          attrs: fence[1] !== undefined && fence[1] !== '' ? { language: fence[1] } : {},
          content: body.length > 0 ? [{ type: 'text', text: body.join('\n') }] : [],
        })
        i = j + 1
        continue
      }

      const heading = line.match(headingLine)
      if (heading !== null && heading[1] !== undefined && heading[2] !== undefined) {
        nodes.push({ type: 'heading', attrs: { level: heading[1].length }, content: this.parseInline(heading[2]) })
        i++
        continue
      }

      if (detailsOpen.test(line.trim())) {
        const details = this.parseDetails(lines, i)
        if (details !== undefined) {
          nodes.push(details.node)
          i = details.next
          continue
        }
        // unclosed <details>: emit the opening line as literal text so parsing always advances
        nodes.push({ type: 'paragraph', content: this.parseInline(line) })
        i++
        continue
      }

      if (taskLine.test(line)) {
        const items: AdfNode[] = []
        while (i < lines.length) {
          const task = lines[i]?.match(taskLine)
          if (task === null || task === undefined || task[2] === undefined) break
          items.push({
            type: 'taskItem',
            attrs: { localId: `task-${items.length + 1}`, state: task[1]?.toLowerCase() === 'x' ? 'DONE' : 'TODO' },
            content: this.parseInline(task[2]),
          })
          i++
        }
        nodes.push({ type: 'taskList', attrs: { localId: 'task-list' }, content: items })
        continue
      }

      if (bulletLine.test(line)) {
        const items: AdfNode[] = []
        while (i < lines.length) {
          const bullet = lines[i]?.match(bulletLine)
          if (bullet === null || bullet === undefined || bullet[1] === undefined) break
          items.push({ type: 'listItem', content: [{ type: 'paragraph', content: this.parseInline(bullet[1]) }] })
          i++
        }
        nodes.push({ type: 'bulletList', content: items })
        continue
      }

      // hardBreaks between lines so single newlines survive the round-trip
      const paragraph: AdfNode[] = []
      while (i < lines.length) {
        const current = lines[i]
        if (current === undefined || current.trim() === '' || this.startsBlock(current)) break
        if (paragraph.length > 0) paragraph.push({ type: 'hardBreak' })
        paragraph.push(...this.parseInline(current))
        i++
      }
      if (paragraph.length > 0) nodes.push({ type: 'paragraph', content: paragraph })
    }
    return nodes
  }

  private startsBlock(line: string): boolean {
    return (
      fenceOpen.test(line) ||
      headingLine.test(line) ||
      taskLine.test(line) ||
      bulletLine.test(line) ||
      detailsOpen.test(line.trim())
    )
  }

  /**
   * Converts the `<details>` block spanning `lines[start..]` into an expand:
   * finds the matching `</details>` (nesting-aware), lifts the `<summary>`
   * into the expand title, and parses what remains as blocks. Returns
   * undefined for an unclosed block, which then falls through to plain
   * paragraph text.
   */
  private parseDetails(lines: string[], start: number): { node: AdfNode; next: number } | undefined {
    let depth = 0
    let end = -1
    for (let j = start; j < lines.length; j++) {
      // Count only line-anchored tags. A `<details>` mentioned mid-sentence or
      // inside inline code is prose, not structure, and must not affect nesting.
      const trimmed = (lines[j] ?? '').trim()
      if (detailsOpen.test(trimmed)) depth++
      if (detailsClose.test(trimmed)) depth--
      if (depth === 0) {
        end = j
        break
      }
    }
    if (end === -1) return undefined

    const block = lines.slice(start, end + 1).join('\n')
    const inner = block.replace(/^\s*<details>\s*/, '').replace(/\s*<\/details>\s*$/, '')
    const summary = inner.match(/^\s*<summary>([\s\S]*?)<\/summary>\s*/)
    const title = summary?.[1]?.trim() ?? ''
    const body = summary !== null ? inner.slice(summary[0].length) : inner
    return {
      node: { type: 'expand', attrs: { title }, content: this.parseBlocks(body.split('\n')) },
      next: end + 1,
    }
  }

  private parseInline(text: string): AdfNode[] {
    const nodes: AdfNode[] = []
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g
    let last = 0
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      if (match.index > last) nodes.push({ type: 'text', text: text.slice(last, match.index) })
      if (match[1] !== undefined) nodes.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] })
      else if (match[2] !== undefined) nodes.push({ type: 'text', text: match[2], marks: [{ type: 'code' }] })
      last = match.index + match[0].length
    }
    if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) })
    return nodes
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
        return (node.content ?? [])
          .map((item) => `- ${this.toMarkdown(item.content ?? []).replace(/\n/g, '\n  ')}`)
          .join('\n')
      case 'orderedList':
        return (node.content ?? [])
          .map((item, index) => `${index + 1}. ${this.toMarkdown(item.content ?? []).replace(/\n/g, '\n   ')}`)
          .join('\n')
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

  private inlineToMarkdown(nodes: AdfNode[]): string {
    return nodes
      .map((node) => {
        if (node.type === 'hardBreak') return '\n'
        let text = node.text ?? (node.content !== undefined ? this.inlineToMarkdown(node.content) : '')
        const marks = node.marks ?? []
        if (marks.some((mark) => mark.type === 'code')) text = `\`${text}\``
        if (marks.some((mark) => mark.type === 'strong')) text = `**${text}**`
        const link = marks.find((mark) => mark.type === 'link')
        const href = link?.attrs?.['href']
        if (typeof href === 'string') text = `[${text}](${href})`
        return text
      })
      .join('')
  }
}

export const markdownAdfConverter: MarkdownAdfConverter = new LayeredBodyAdfConverter()
