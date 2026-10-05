import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { resolveConfigPath } from '../../shared/config.js'

type ExecFileSyncFn = (file: string, args: readonly string[], cwd: string) => string

export interface EvidenceDir {
  path: string
  /** Whether git ignores the path in the repo that holds it; null outside any repo. */
  gitignored: boolean | null
}

export interface EvidenceLocationProps {
  cwd: string
  /** The main checkout when cwd is a linked worktree. */
  mainCheckout?: string | undefined
  execFileSyncFn?: ExecFileSyncFn
}

/**
 * Where QA evidence for a ticket is written: `evidence/<ticket>` inside the
 * host's config directory (`.claude/` or `.agents/`) of the main checkout,
 * so evidence outlives a linked worktree and never shows in its status.
 */
export class EvidenceLocation {
  private readonly root: string
  private readonly execFileSync: ExecFileSyncFn

  constructor(props: EvidenceLocationProps) {
    this.root = props.mainCheckout ?? props.cwd
    this.execFileSync =
      props.execFileSyncFn ??
      ((file, args, cwd) => execFileSync(file, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  }

  dirFor(ticket: string): EvidenceDir {
    if (ticket.trim() === '' || /[/\\]|\.\./.test(ticket)) {
      throw new Error(`invalid ticket id "${ticket}" for an evidence directory`)
    }
    const path = join(dirname(resolveConfigPath(this.root, undefined)), 'evidence', ticket)
    return { path, gitignored: this.isIgnored(path) }
  }

  private isIgnored(path: string): boolean | null {
    try {
      this.execFileSync('git', ['check-ignore', '-q', '--no-index', path], this.root)
      return true
    } catch (err) {
      // check-ignore exits 1 for "not ignored" and 128 when there is no repo.
      return typeof err === 'object' && err !== null && 'status' in err && err.status === 1 ? false : null
    }
  }
}
