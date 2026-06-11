import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CommitMessageInput {
  type: string
  scope: string
  description: string
  body?: string
  footers: string[]
  model?: string
}

export interface CommitMessageBuilder {
  build(input: CommitMessageInput): string
}

export class DefaultCommitMessageBuilder implements CommitMessageBuilder {
  private readonly pluginVersion: string
  private readonly harnessVersion: string | undefined

  constructor(binPath: string, agentEnv: string | undefined) {
    this.pluginVersion = DefaultCommitMessageBuilder.readPluginVersion(binPath)
    this.harnessVersion = DefaultCommitMessageBuilder.parseHarnessVersion(agentEnv)
  }

  build(input: CommitMessageInput): string {
    const sections: string[] = []

    sections.push(`${input.type}(${input.scope}): ${input.description}`)

    if (input.body !== undefined) {
      sections.push(input.body)
    }

    const trailers: string[] = [
      ...input.footers,
      `Flight-Rules-Version: ${this.pluginVersion}`,
      ...(this.harnessVersion !== undefined ? [`Harness-Version: ${this.harnessVersion}`] : []),
      ...(input.model !== undefined ? [`Model-Used: ${input.model}`] : []),
    ]

    sections.push(trailers.join('\n'))

    return sections.join('\n\n')
  }

  private static readPluginVersion(binPath: string): string {
    try {
      const pkgPath = join(dirname(binPath), '..', 'package.json')
      const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'version' in parsed &&
        typeof parsed.version === 'string'
      ) {
        return parsed.version
      }
      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private static parseHarnessVersion(agentEnv: string | undefined): string | undefined {
    if (!agentEnv) return undefined
    const match = /^(.+)_(\d+-\d+-\d+)_agent$/.exec(agentEnv)
    if (match?.[1] === undefined || match?.[2] === undefined) return undefined
    return `${match[1]}@${match[2].replace(/-/g, '.')}`
  }
}
