import { describe, it, expect, vi, beforeEach } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('./jira-client.js', () => ({
  JiraClient: class {
    request = request
  },
}))

import { JiraTaskTracker } from './jira-task-tracker.js'

const makeTracker = () =>
  new JiraTaskTracker({
    token: 'tok',
    host: 'acme.atlassian.net',
    email: 'me@acme.com',
    project: 'PROJ',
    jpdProject: 'DISC',
  })

describe('JiraTaskTracker.ping', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('probes GET /myself for reachability', async () => {
    request.mockResolvedValueOnce({ accountId: '1' })
    await makeTracker().ping()
    expect(request).toHaveBeenCalledWith('GET', '/myself')
  })

  it('propagates a failed probe so check reports unreachable', async () => {
    request.mockRejectedValueOnce(new Error('Unauthorized'))
    await expect(makeTracker().ping()).rejects.toThrow('Unauthorized')
  })
})

describe('JiraTaskTracker.getUsers', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('returns assignable users for the project as display-name strings', async () => {
    request.mockResolvedValueOnce([
      { accountId: 'a1', displayName: 'Ada Lovelace' },
      { accountId: 'a2', displayName: 'Alan Turing' },
    ])
    const users = await makeTracker().getUsers()
    expect(users).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(request).toHaveBeenCalledWith('GET', '/user/assignable/search', undefined, {
      project: 'PROJ',
      maxResults: 100,
    })
  })
})
