import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PullRequestTemplate } from '../../git/pr-template/pr-template.js'

const { createMock, requestReviewersMock, addLabelsMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  requestReviewersMock: vi.fn(),
  addLabelsMock: vi.fn(),
}))

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    rest = {
      pulls: { create: createMock, requestReviewers: requestReviewersMock },
      issues: { addLabels: addLabelsMock },
    }
  },
}))

import { GitHubPullRequestHost } from './pull-request-host.js'

const template: PullRequestTemplate = {
  type: 'feat',
  scope: 'KAN-31',
  description: 'add pr create',
  summary: 'Adds the command.',
  changes: ['a'],
  baseBranch: 'main',
  headBranch: 'feat/KAN-31-pr-create-command',
  reviewers: [],
  labels: [],
}

describe('GitHubPullRequestHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMock.mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/o/r/pull/42' } })
    requestReviewersMock.mockResolvedValue({})
    addLabelsMock.mockResolvedValue({})
  })

  it('creates the PR with the rendered title, base, and head', async () => {
    const host = new GitHubPullRequestHost({ token: 't', owner: 'o', repo: 'r' })
    const result = await host.createPullRequest(template)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'o',
        repo: 'r',
        base: 'main',
        head: 'feat/KAN-31-pr-create-command',
        title: 'feat(KAN-31): add pr create',
      }),
    )
    expect(result).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42' })
  })

  it('requests reviewers and adds labels when provided', async () => {
    const host = new GitHubPullRequestHost({ token: 't', owner: 'o', repo: 'r' })
    await host.createPullRequest({ ...template, reviewers: ['alice'], labels: ['wave-1'] })
    expect(requestReviewersMock).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 42, reviewers: ['alice'] }))
    expect(addLabelsMock).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 42, labels: ['wave-1'] }))
  })

  it('skips reviewer and label calls when none are provided', async () => {
    const host = new GitHubPullRequestHost({ token: 't', owner: 'o', repo: 'r' })
    await host.createPullRequest(template)
    expect(requestReviewersMock).not.toHaveBeenCalled()
    expect(addLabelsMock).not.toHaveBeenCalled()
  })

  it('still resolves when the reviewer request fails (best-effort)', async () => {
    requestReviewersMock.mockRejectedValue(new Error('cannot request review from the author'))
    const host = new GitHubPullRequestHost({ token: 't', owner: 'o', repo: 'r' })
    await expect(host.createPullRequest({ ...template, reviewers: ['self'] })).resolves.toEqual({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
    })
  })

  it('rejects construction with an empty token', () => {
    expect(() => new GitHubPullRequestHost({ token: '', owner: 'o', repo: 'r' })).toThrow()
  })
})
