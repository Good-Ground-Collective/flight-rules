import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

export interface GitExecutor {
  stage(files: string[]): Promise<void>
  commit(message: string): Promise<void>
  getCommitSha(): Promise<string>
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
}
