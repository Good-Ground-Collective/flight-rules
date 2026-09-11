/**
 * A structural, permissive view of an Atlassian Document Format node. Real Jira
 * descriptions carry heterogeneous block content (paragraphs, expands, code
 * blocks, …), so nodes are walked by `type`/`attrs` rather than modelled
 * exhaustively.
 */
export interface AdfNode {
  type: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
  text?: string
  marks?: AdfMark[]
}

export interface AdfMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface AdfTextNode {
  type: 'text'
  text: string
}

export interface AdfParagraphNode {
  type: 'paragraph'
  content: AdfTextNode[]
}

export interface AdfCodeBlockNode {
  type: 'codeBlock'
  attrs: { language: string }
  content: AdfTextNode[]
}

/**
 * An inline @mention. `attrs.id` is the Atlassian account id and is the only
 * required field; `attrs.text` (`@Display Name`) is a hint Jira may re-resolve
 * from the id on render. A mention sits inside a paragraph's inline content
 * beside text nodes, never as a block.
 */
export interface AdfMentionNode {
  type: 'mention'
  attrs: { id: string; text?: string }
}

export interface AdfDocNode {
  version: 1
  type: 'doc'
  content: AdfNode[]
}

export interface AdfExpandNode {
  type: 'expand'
  attrs: { title: string }
  content: AdfNode[]
}

export interface AdfTableCellNode {
  type: 'tableHeader' | 'tableCell'
  attrs: Record<string, never>
  content: AdfNode[]
}

export interface AdfTableRowNode {
  type: 'tableRow'
  content: AdfTableCellNode[]
}

export interface AdfTableNode {
  type: 'table'
  content: AdfTableRowNode[]
}

export interface AdfBlockquoteNode {
  type: 'blockquote'
  content: AdfNode[]
}

export type AdfPanelType = 'info' | 'note' | 'success' | 'warning' | 'error'

export interface AdfPanelNode {
  type: 'panel'
  attrs: { panelType: AdfPanelType }
  content: AdfNode[]
}

export interface AdfBuilder {
  doc(text: string): AdfDocNode
  codeBlock(text: string, language?: string): AdfCodeBlockNode
  expand(title: string, child: AdfNode): AdfExpandNode
}

export class DefaultAdfBuilder implements AdfBuilder {
  doc(text: string): AdfDocNode {
    return {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
  }

  codeBlock(text: string, language = 'yaml'): AdfCodeBlockNode {
    return {
      type: 'codeBlock',
      attrs: { language },
      content: [{ type: 'text', text }],
    }
  }

  expand(title: string, child: AdfNode): AdfExpandNode {
    return {
      type: 'expand',
      attrs: { title },
      content: [child],
    }
  }
}

export const adfBuilder: AdfBuilder = new DefaultAdfBuilder()
