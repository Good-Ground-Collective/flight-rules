import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { EntityMetadataSchema, type EntityMetadata } from '../task-tracker/task-tracker.js'

const sentinelComment = '<!-- flight-rules:metadata -->'

const detailsBlockRe =
  /<details>\n<summary>LLM Context<\/summary>\n<!-- flight-rules:metadata -->\n\n```yaml\n([\s\S]*?)\n```\n\n<\/details>/

export class BodyMetadataService {
  parse(body: string): EntityMetadata {
    const match = detailsBlockRe.exec(body)
    if (match === null || match[1] === undefined) return {}
    const content = match[1].trim()
    if (content === '') return {}
    const raw: unknown = parseYaml(content)
    if (raw === null || raw === undefined) return {}
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('malformed flight-rules metadata block')
    }
    return EntityMetadataSchema.parse(raw)
  }

  splice(body: string, patch: Partial<EntityMetadata>): string {
    const existing = this.parse(body)
    const hasBlock = detailsBlockRe.test(body)

    const merged: Record<string, unknown> = { ...existing }
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) merged[k] = v
    }

    if (Object.keys(merged).length === 0 && !hasBlock) return body

    const yaml = stringifyYaml(merged).trimEnd()
    const block = [
      '<details>',
      '<summary>LLM Context</summary>',
      sentinelComment,
      '',
      '```yaml',
      yaml,
      '```',
      '',
      '</details>',
    ].join('\n')

    if (hasBlock) return body.replace(detailsBlockRe, block)
    return `${body}\n\n${block}`
  }
}
