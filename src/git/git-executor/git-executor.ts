import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

export interface GitExecutor {
  stage(files: string[]): Promise<void>
  commit(message: string): Promise<void>
  getCommitSha(): Promise<string>
  checkout(spec: BranchSpec, from?: string): Promise<string>
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

  async commit(message: string): Promise<void> {
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
}
