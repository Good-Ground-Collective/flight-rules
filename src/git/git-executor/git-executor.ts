import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod'
import { branchNamer, type BranchSpec } from '../branch-namer/branch-namer.js'
export type { BranchSpec } from '../branch-namer/branch-namer.js'

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

/** Where a branch started: a new branch, or a disposable worktree branch renamed in place. */
export interface BranchStart {
  branch: string
  renamedFrom: string | null
}

export const PushSpecSchema = z.object({
  // A detached HEAD makes `rev-parse --abbrev-ref` yield the literal "HEAD", which would push a ref rather than a branch.
  branch: z
    .string()
    .min(1, 'branch is required')
    .refine((branch) => branch !== 'HEAD', {
      message: 'cannot push from a detached HEAD — check out a branch first',
    }),
  remote: z.string().min(1).default('origin'),
  // Defaults true to match the CLI's `--no-set-upstream`, so a programmatic push tracks the branch too.
  setUpstream: z.boolean().default(true),
})

export type PushSpec = z.input<typeof PushSpecSchema>

export interface GitExecutor {
  stage(files: string[]): Promise<void>
  // Restricted to `files` when given: anything else in the index is left behind.
  commit(message: string, files?: readonly string[]): Promise<void>
  getCommitSha(): Promise<string>
  checkout(spec: BranchSpec, from?: string): Promise<string>
  /**
   * Like `checkout`, but in a linked worktree whose current branch is
   * disposable (no upstream, no commits of its own, not the default branch,
   * and at `from` when one is given) it renames that branch instead of
   * stacking a second branch on it.
   */
  startBranch(spec: BranchSpec, from?: string): Promise<BranchStart>
  getCurrentBranch(): Promise<string>
  push(spec: PushSpec): Promise<void>
}

export class NodeGitExecutor implements GitExecutor {
  private readonly execFile: ExecFileFn

  constructor(execFileFn?: ExecFileFn) {
    const promisified = promisify(execFile)
    this.execFile = execFileFn ?? ((file, args) => promisified(file, [...args]))
  }

  async stage(files: string[]): Promise<void> {
    if (files.length === 0) return
    await this.execFile('git', ['add', '--', ...files])
  }

  async commit(message: string, files?: readonly string[]): Promise<void> {
    // `--only` needs a pathspec (hence the fallback); `--cleanup=whitespace` stops `commit.cleanup=strip` eating markdown `#` lines.
    if (files !== undefined && files.length > 0) {
      await this.execFile('git', ['commit', '--cleanup=whitespace', '--only', '-m', message, '--', ...files])
      return
    }
    await this.execFile('git', ['commit', '--cleanup=whitespace', '-m', message])
  }

  async getCommitSha(): Promise<string> {
    const { stdout } = await this.execFile('git', ['rev-parse', 'HEAD'])
    return stdout.trim()
  }

  async checkout(spec: BranchSpec, from?: string): Promise<string> {
    const branch = branchNamer.name(spec)
    const args = ['checkout', '-b', branch]
    if (from !== undefined) args.push(from)
    await this.execFile('git', args)
    return branch
  }

  async startBranch(spec: BranchSpec, from?: string): Promise<BranchStart> {
    const branch = branchNamer.name(spec)
    const current = await this.getCurrentBranch()
    if (await this.isDisposableWorktreeBranch(current, from)) {
      await this.execFile('git', ['branch', '-m', branch])
      return { branch, renamedFrom: current }
    }
    return { branch: await this.checkout(spec, from), renamedFrom: null }
  }

  async getCurrentBranch(): Promise<string> {
    const { stdout } = await this.execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    return stdout.trim()
  }

  async push(spec: PushSpec): Promise<void> {
    const parsed = PushSpecSchema.parse(spec)
    const args = ['push']
    if (parsed.setUpstream) args.push('--set-upstream')
    args.push(parsed.remote, parsed.branch)
    await this.execFile('git', args)
  }

  private async isDisposableWorktreeBranch(current: string, from: string | undefined): Promise<boolean> {
    if (current === 'HEAD') return false
    const { stdout: dirs } = await this.execFile('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
    const [gitDir, commonDir] = dirs.trim().split('\n')
    if (gitDir === undefined || gitDir === commonDir) return false
    if (await this.succeeds(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])) return false
    if (current === (await this.defaultBranch())) return false
    const { stdout: unique } = await this.execFile('git', [
      'rev-list', '--count', 'HEAD', '--not', `--exclude=${current}`, '--branches', '--remotes',
    ])
    if (unique.trim() !== '0') return false
    if (from === undefined) return true
    const [{ stdout: head }, { stdout: base }] = await Promise.all([
      this.execFile('git', ['rev-parse', 'HEAD']),
      this.execFile('git', ['rev-parse', `${from}^{commit}`]),
    ])
    return head.trim() === base.trim()
  }

  private async defaultBranch(): Promise<string | undefined> {
    try {
      const { stdout } = await this.execFile('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      return stdout.trim().replace(/^origin\//, '')
    } catch {
      return undefined
    }
  }

  private async succeeds(args: readonly string[]): Promise<boolean> {
    try {
      await this.execFile('git', args)
      return true
    } catch {
      return false
    }
  }

}
