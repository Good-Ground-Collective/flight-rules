import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'

type ExecFileSyncFn = (file: string, args: readonly string[], cwd: string) => string

export interface WorktreeLocatorProps {
  execFileSyncFn?: ExecFileSyncFn
}

/**
 * Finds the main checkout behind a linked git worktree. Untracked files such
 * as local config and QA evidence live there, because a linked worktree
 * starts without them and is deleted when its work is done.
 */
export class WorktreeLocator {
  private readonly execFileSync: ExecFileSyncFn

  constructor(props: WorktreeLocatorProps = {}) {
    this.execFileSync =
      props.execFileSyncFn ??
      ((file, args, cwd) => execFileSync(file, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  }

  /** The main checkout's root when `cwd` is inside a linked worktree; otherwise undefined. */
  mainCheckoutFor(cwd: string): string | undefined {
    let output: string
    try {
      output = this.execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], cwd)
    } catch {
      return undefined
    }
    const [gitDir, commonDir] = output.trim().split('\n')
    if (gitDir === undefined || commonDir === undefined || gitDir === commonDir) return undefined
    // A bare repository has no main checkout to fall back to.
    if (basename(commonDir) !== '.git') return undefined
    return dirname(commonDir)
  }
}
