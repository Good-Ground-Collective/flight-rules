import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'

const run = promisify(execFile)

export const BaseRefSchema = z
  .string()
  .regex(/^[^\s-]\S*$/, 'base must be a git ref or commit, and cannot start with "-"')

const GitRepositoryPathsPropsSchema = z.object({ cwd: z.string().min(1) })

export type GitRepositoryPathsProps = z.input<typeof GitRepositoryPathsPropsSchema>

/** Lists the repository-relative paths a charter selection is made from. */
export interface RepositoryPaths {
  /** Every tracked file plus untracked files git does not ignore. */
  inventory(): Promise<string[]>
  /** Files changed since the merge base with `base`, including uncommitted and untracked work. */
  changedSince(base: string): Promise<string[]>
}

export class GitRepositoryPaths implements RepositoryPaths {
  private readonly cwd: string

  constructor(props: GitRepositoryPathsProps) {
    this.cwd = GitRepositoryPathsPropsSchema.parse(props).cwd
  }

  async inventory(): Promise<string[]> {
    const root = await this.root()
    return this.paths(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  }

  async changedSince(base: string): Promise<string[]> {
    const ref = BaseRefSchema.parse(base)
    const root = await this.root()
    const mergeBase = (await this.git(root, ['merge-base', ref, 'HEAD'])).trim()
    if (mergeBase.length === 0) throw new RepositoryPathsError(`No merge base between ${ref} and HEAD`)

    const changed = await this.paths(root, ['diff', '-z', '--name-only', mergeBase])
    const untracked = await this.paths(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    return [...new Set([...changed, ...untracked])]
  }

  // Path queries run from the top level so the result never depends on which subdirectory the caller is in.
  private async root(): Promise<string> {
    return (await this.git(this.cwd, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '')
  }

  // NUL-delimited output keeps paths verbatim; newline output quotes non-ASCII and special characters.
  private async paths(root: string, args: string[]): Promise<string[]> {
    return (await this.git(root, args)).split('\0').filter(path => path.length > 0)
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
      return stdout
    } catch (cause) {
      throw new RepositoryPathsError(`git ${args[0]} failed in ${cwd}`, { cause })
    }
  }
}

export class RepositoryPathsError extends Error {
  override name = 'RepositoryPathsError'
}
