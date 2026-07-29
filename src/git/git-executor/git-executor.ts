import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod'
import { SemanticTypeSchema, semanticTypes } from '../semantic-types.js';

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

export interface BranchSpec {
  type: string
  scope: string
  description?: string
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
    // `--only` excludes paths staged by anyone else; git rejects it without a pathspec, hence the fallback.
    if (files !== undefined && files.length > 0) {
      await this.execFile('git', ['commit', '--only', '-m', message, '--', ...files])
      return
    }
    await this.execFile('git', ['commit', '-m', message])
  }

  async getCommitSha(): Promise<string> {
    const { stdout } = await this.execFile('git', ['rev-parse', 'HEAD'])
    return stdout.trim()
  }

  async checkout(spec: BranchSpec, from?: string): Promise<string> {
    const semanticTypeValidation = SemanticTypeSchema.safeParse(spec.type)
    if (!semanticTypeValidation.success) {
      throw new Error(
        `invalid branch type "${spec.type}" — must be one of: ${semanticTypes.join(', ')}`,
      )
    }
    if (spec.scope.trim() === '') {
      throw new Error('branch scope is required')
    }
    const slug =
      spec.description !== undefined && spec.description !== '' ? `-${spec.description}` : ''
    const branch = `${spec.type}/${spec.scope}${slug}`
    const args = ['checkout', '-b', branch]
    if (from !== undefined) args.push(from)
    await this.execFile('git', args)
    return branch
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
}
