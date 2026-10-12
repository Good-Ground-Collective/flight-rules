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
    return this.lines(['ls-files', '--cached', '--others', '--exclude-standard'])
  }

  async changedSince(base: string): Promise<string[]> {
    const ref = BaseRefSchema.parse(base)
    const [mergeBase] = await this.lines(['merge-base', ref, 'HEAD'])
    if (mergeBase === undefined) throw new RepositoryPathsError(`No merge base between ${ref} and HEAD`)

    const changed = await this.lines(['diff', '--name-only', mergeBase])
    const untracked = await this.lines(['ls-files', '--others', '--exclude-standard'])
    return [...new Set([...changed, ...untracked])]
  }

  private async lines(args: string[]): Promise<string[]> {
    try {
      const { stdout } = await run('git', args, { cwd: this.cwd, maxBuffer: 64 * 1024 * 1024 })
      return stdout.split('\n').filter(line => line.length > 0)
    } catch (cause) {
      throw new RepositoryPathsError(`git ${args[0]} failed in ${this.cwd}`, { cause })
    }
  }
}

export class RepositoryPathsError extends Error {
  override name = 'RepositoryPathsError'
}
