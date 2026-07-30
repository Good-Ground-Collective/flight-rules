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

/**
 * Lines beginning `flight-rules` inside fenced code blocks, prose excluded.
 * Fences are matched by their exact run length so a four-backtick block
 * containing three-backtick example content cannot desynchronise the toggle.
 */
const invocationsIn = (markdown: string): string[] => {
  const lines = markdown.split('\n')
  const found: string[] = []
  let openFence: string | null = null
  for (const line of lines) {
    const fence = /^\s*(`{3,})/.exec(line)?.[1]
    if (fence !== undefined) {
      if (openFence === null) {
        openFence = fence
        continue
      }
      // Only a run at least as long as the opener closes the block; a shorter
      // run is content inside it.
      if (fence.length >= openFence.length) openFence = null
      continue
    }
    if (openFence === null) continue
    const trimmed = line.trim().replace(/^\$ /, '')
    if (trimmed.startsWith('flight-rules ')) found.push(trimmed)
  }
  return found
}

/** A bare `<id>`/`<slug>` or a bracket-wrapped optional segment, never a real subcommand name. */
const looksLikePlaceholder = (token: string): boolean => /^[<[]/.test(token)

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
    if (child === undefined) {
      // A non-flag token that fails to match a child is only a tolerated
      // placeholder/positional-arg when it looks like one, or when `node`
      // is a leaf with nothing further to dispatch to. Otherwise `node`
      // still has real subcommands and this token was a failed attempt to
      // name one — e.g. a skill still saying `ticket get` after the CLI
      // renamed it to `ticket fetch`. That is drift, not a placeholder.
      if (looksLikePlaceholder(token) || node.commands.length === 0) break
      return `no command matched: ${invocation}`
    }
    node = child
    index += 1
  }
  // Only a real drift when nothing under the program matched *and* the walk
  // didn't stop because the very first token was a top-level flag (e.g.
  // `flight-rules --help`), which is a legitimate bare invocation.
  if (node === program && !stoppedOnFlag) return `no command matched: ${invocation}`
  const flags = new Set<string>()
  for (const token of tokens.slice(index)) {
    // Strip a single wrapping bracket (`[--from`, `<base>]`) so an optional
    // flag written as `[--flag <arg>]` in a skill's usage line still gets
    // checked against the CLI's real options instead of being skipped.
    const bare = token.replace(/^\[/, '').replace(/\]$/, '')
    if (!bare.startsWith('--')) continue
    const flag = bare.split('=')[0] ?? bare
    flags.add(flag)
    // `--no-x` is only valid when Commander was told that option is negatable;
    // inferring it from the presence of `--x` would accept flags that do not exist.
    const known =
      node.options.some((option) => option.long === flag) || flag === '--help'
    if (!known) return `unknown flag ${flag} for "${node.name()}": ${invocation}`
  }
  // Commander exits before the action body when a mandatory option is absent,
  // so a skill omitting one fails at runtime rather than at lint time. Checked
  // only for a fully-resolved leaf: a partially-walked path may be an
  // illustrative fragment rather than a complete invocation.
  const fullyResolved = node !== program && node.commands.length === 0
  if (fullyResolved && !flags.has('--help')) {
    const missing = node.options
      .filter((option) => option.mandatory)
      .map((option) => option.long)
      .filter((long): long is string => long !== undefined && !flags.has(long))
    if (missing.length > 0) {
      return `missing required ${missing.join(', ')} for "${node.name()}": ${invocation}`
    }
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
