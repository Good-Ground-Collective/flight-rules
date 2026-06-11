import { describe, it, expect, vi } from 'vitest'
import { NodeGitExecutor } from './git-executor.js'

const makeExec = (stdout = '') =>
  vi.fn().mockResolvedValue({ stdout, stderr: '' })

describe('NodeGitExecutor.stage', () => {
  it('calls git add -- with provided files', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.stage(['src/foo.ts', 'src/bar.ts'])
    expect(exec).toHaveBeenCalledWith('git', ['add', '--', 'src/foo.ts', 'src/bar.ts'])
  })

  it('does nothing when files array is empty', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.stage([])
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('NodeGitExecutor.commit', () => {
  it('calls git commit -m with the message', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.commit('feat(scope): description')
    expect(exec).toHaveBeenCalledWith('git', ['commit', '-m', 'feat(scope): description'])
  })
})

describe('NodeGitExecutor.getCommitSha', () => {
  it('returns trimmed output of git rev-parse HEAD', async () => {
    const exec = makeExec('abc123\n')
    const executor = new NodeGitExecutor(exec)
    const sha = await executor.getCommitSha()
    expect(sha).toBe('abc123')
    expect(exec).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'])
  })
})
