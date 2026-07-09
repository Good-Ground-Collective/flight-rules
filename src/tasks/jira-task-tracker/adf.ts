// A structural, permissive view of an Atlassian Document Format node. Real Jira
// descriptions carry heterogeneous block content (paragraphs, expands, code
// blocks, …), so nodes are walked by `type`/`attrs` rather than modelled
// exhaustively.
export interface AdfNode {
  type: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
  text?: string
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
