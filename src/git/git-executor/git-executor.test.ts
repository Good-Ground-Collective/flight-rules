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

describe('NodeGitExecutor.checkout', () => {
  it('builds a semantic branch name and creates it off current HEAD', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    const branch = await executor.checkout({ type: 'feat', scope: '25', description: 'sharpen-the-saw' })
    expect(branch).toBe('feat/25-sharpen-the-saw')
    expect(exec).toHaveBeenCalledWith('git', ['checkout', '-b', 'feat/25-sharpen-the-saw'])
  })

  it('omits the description slug when not provided', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    const branch = await executor.checkout({ type: 'fix', scope: '30' })
    expect(branch).toBe('fix/30')
    expect(exec).toHaveBeenCalledWith('git', ['checkout', '-b', 'fix/30'])
  })

  it('branches off a given base when from is provided (stacking)', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await executor.checkout({ type: 'feat', scope: '25', description: 'saw' }, 'feat/22-research-agent')
    expect(exec).toHaveBeenCalledWith('git', ['checkout', '-b', 'feat/25-saw', 'feat/22-research-agent'])
  })

  it('rejects a type outside the semantic set', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await expect(executor.checkout({ type: 'banana', scope: '25' })).rejects.toThrow(/banana/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('rejects an empty scope', async () => {
    const exec = makeExec()
    const executor = new NodeGitExecutor(exec)
    await expect(executor.checkout({ type: 'feat', scope: '   ' })).rejects.toThrow(/scope/)
    expect(exec).not.toHaveBeenCalled()
  })
})
