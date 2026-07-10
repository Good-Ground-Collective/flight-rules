import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { EntityMetadataSchema, type EntityMetadata } from '../task-tracker/task-tracker.js'
import { adfBuilder, type AdfDocNode, type AdfNode } from './adf.js'

const metadataTitle = 'LLM Context'

export interface AdfMetadataService {
  parse(doc: AdfDocNode): EntityMetadata
  splice(doc: AdfDocNode, patch: Partial<EntityMetadata>): AdfDocNode
}

// The ADF-native counterpart to BodyMetadataService: it round-trips
// EntityMetadata through a YAML code block inside an "LLM Context" expand node,
// so Jira issues carry the same metadata GitHub encodes in an HTML <details>.
export class JiraAdfMetadataService implements AdfMetadataService {
  parse(doc: AdfDocNode): EntityMetadata {
    const yaml = this.readMetadataYaml(doc)
    if (yaml === undefined) return {}
    const raw: unknown = parseYaml(yaml)
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return {}
    // `size` is derived from the entity's kind, not stored — drop any legacy
    // copy so it is ignored on read and cleaned out on the next splice.
    Reflect.deleteProperty(raw, 'size')
    return EntityMetadataSchema.parse(raw)
  }

  splice(doc: AdfDocNode, patch: Partial<EntityMetadata>): AdfDocNode {
    const merged: Record<string, unknown> = { ...this.parse(doc) }
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined) merged[key] = value
    })

    const node = adfBuilder.expand(metadataTitle, adfBuilder.codeBlock(stringifyYaml(merged).trimEnd()))
    const contentWithoutMetadata = doc.content.filter((n) => !this.isMetadataExpand(n))
    return { ...doc, content: [...contentWithoutMetadata, node] }
  }

  private readMetadataYaml(doc: AdfDocNode): string | undefined {
    const expand = doc.content.find((n) => this.isMetadataExpand(n))
    const codeBlock = expand?.content?.find((n) => n.type === 'codeBlock')
    const text = codeBlock?.content?.find((n) => n.type === 'text')?.text
    if (text === undefined || text.trim() === '') return undefined
    return text
  }

  private isMetadataExpand(node: AdfNode): boolean {
    return node.type === 'expand' && node.attrs?.['title'] === metadataTitle
  }
}

export const jiraAdfMetadataService: AdfMetadataService = new JiraAdfMetadataService()
