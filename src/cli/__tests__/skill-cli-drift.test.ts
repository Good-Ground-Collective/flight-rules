import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { Command } from 'commander'
import { buildProgram } from '../cli.js'
import type { Config } from '../../shared/config.js'
import type { TaskTracker } from '../../tasks/task-tracker/task-tracker.js'
import type { PullRequestHost } from '../../pr/pull-request-host/pull-request-host.js'

// The program is only inspected, never executed, so the dependency getters
// never run — they exist to satisfy buildProgram's signature.
const program = buildProgram(
  (() => undefined) as unknown as () => TaskTracker,
  (() => undefined) as unknown as () => Config,
  (() => undefined) as unknown as () => PullRequestHost,
)

const skillsDir = join(import.meta.dirname, '..', '..', '..', 'skills')

const skillFiles = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(skillsDir, entry.name, 'SKILL.md'))

/** Lines beginning `flight-rules` inside fenced code blocks, prose excluded. */
const invocationsIn = (markdown: string): string[] => {
  const lines = markdown.split('\n')
  const found: string[] = []
  let fenced = false
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (!fenced) continue
    const trimmed = line.trim().replace(/^\$ /, '')
    if (trimmed.startsWith('flight-rules ')) found.push(trimmed)
  }
  return found
}

/** Walks the token path into the command tree, then checks each long flag. */
const resolve = (invocation: string): string => {
  const tokens = invocation.split(/\s+/).slice(1)
  let node: Command = program
  let index = 0
  // Tracks whether the walk stopped because it hit a flag (fine — the
  // remaining tokens are just options on `node`) rather than because a
  // token that looked like a subcommand failed to match anything.
  let stoppedOnFlag = false
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) break
    if (token.startsWith('-')) {
      stoppedOnFlag = true
      break
    }
    const child = node.commands.find(
      (candidate) => candidate.name() === token || candidate.aliases().includes(token),
    )
    if (child === undefined) break
    node = child
    index += 1
  }
  // Only a real drift when nothing under the program matched *and* the walk
  // didn't stop because the very first token was a top-level flag (e.g.
  // `flight-rules --help`), which is a legitimate bare invocation.
  if (node === program && !stoppedOnFlag) return `no command matched: ${invocation}`
  for (const token of tokens.slice(index)) {
    if (!token.startsWith('--')) continue
    const flag = token.split('=')[0] ?? token
    const known =
      node.options.some((option) => option.long === flag) ||
      flag === '--help' ||
      node.options.some((option) => option.long === flag.replace(/^--no-/, '--'))
    if (!known) return `unknown flag ${flag} for "${node.name()}": ${invocation}`
  }
  return 'ok'
}

describe('skills reference a real CLI surface', () => {
  it('finds skills to check', () => {
    expect(skillFiles.length).toBeGreaterThan(0)
  })

  it.each(skillFiles)('%s uses only commands and flags the CLI defines', (file) => {
    const invocations = invocationsIn(readFileSync(file, 'utf8'))
    const failures = invocations.map(resolve).filter((result) => result !== 'ok')
    expect(failures).toEqual([])
  })
})
