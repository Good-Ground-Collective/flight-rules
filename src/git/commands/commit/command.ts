import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Command } from 'commander'
import type { GitExecutor } from '../../git-executor/git-executor.js'

export function readPluginVersion(binPath: string): string {
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

export function parseHarnessVersion(agentEnv: string | undefined): string | undefined {
  if (!agentEnv) return undefined
  const match = /^(.+)_(\d+-\d+-\d+)_agent$/.exec(agentEnv)
  if (match?.[1] === undefined || match?.[2] === undefined) return undefined
  return `${match[1]}@${match[2].replace(/-/g, '.')}`
}

export function buildCommitMessage(opts: {
  type: string
  scope: string
  description: string
  body?: string
  footers: string[]
  pluginVersion: string
  harnessVersion: string | undefined
  model: string | undefined
}): string {
  const sections: string[] = []

  sections.push(`${opts.type}(${opts.scope}): ${opts.description}`)

  if (opts.body !== undefined) {
    sections.push(opts.body)
  }

  const trailers: string[] = [
    ...opts.footers,
    `Flight-Rules-Version: ${opts.pluginVersion}`,
    ...(opts.harnessVersion !== undefined ? [`Harness-Version: ${opts.harnessVersion}`] : []),
    ...(opts.model !== undefined ? [`Model-Used: ${opts.model}`] : []),
  ]

  sections.push(trailers.join('\n'))

  return sections.join('\n\n')
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

type GitCommitOptions = {
  type: string
  scope: string
  description: string
  file: string[]
  body?: string
  footer: string[]
  model?: string
}

export function createGitCommand(getExecutor: () => GitExecutor): Command {
  const git = new Command('git')

  git
    .command('commit')
    .exitOverride()
    .requiredOption('--type <type>', 'conventional commit type')
    .requiredOption('--scope <scope>', 'conventional commit scope')
    .requiredOption('--description <description>', 'commit description')
    .option('--file <file>', 'file to stage (repeatable)', collect, [])
    .option('--body <body>', 'commit body')
    .option('--footer <footer>', 'commit footer (repeatable)', collect, [])
    .option('--model <model>', 'model identifier')
    .action(async (opts: GitCommitOptions) => {
      const pluginVersion = readPluginVersion(process.argv[1] ?? '')
      const harnessVersion = parseHarnessVersion(process.env['AI_AGENT'])
      const message = buildCommitMessage({
        type: opts.type,
        scope: opts.scope,
        description: opts.description,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        footers: opts.footer,
        pluginVersion,
        harnessVersion,
        model: opts.model,
      })
      const executor = getExecutor()
      await executor.stage(opts.file)
      await executor.commit(message)
      const sha = await executor.getCommitSha()
      process.stdout.write(JSON.stringify({ sha, message }) + '\n')
    })

  return git
}
