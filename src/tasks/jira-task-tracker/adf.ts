export interface AdfTextNode {
  type: 'text'
  text: string
}

export interface AdfParagraphNode {
  type: 'paragraph'
  content: AdfTextNode[]
}

export interface AdfDocNode {
  version: 1
  type: 'doc'
  content: AdfParagraphNode[]
}

export interface AdfExpandNode {
  type: 'expand'
  attrs: { title: string }
  content: unknown[]
}

export interface AdfBuilder {
  doc(text: string): AdfDocNode
  expand(title: string, child: unknown): AdfExpandNode
}

export class DefaultAdfBuilder implements AdfBuilder {
  doc(text: string): AdfDocNode {
    return {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
  }

  expand(title: string, child: unknown): AdfExpandNode {
    return {
      type: 'expand',
      attrs: { title },
      content: [child],
    }
  }
}

export const adfBuilder: AdfBuilder = new DefaultAdfBuilder()
