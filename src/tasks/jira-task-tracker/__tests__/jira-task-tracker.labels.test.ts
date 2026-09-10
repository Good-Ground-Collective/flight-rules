import { describe, it, expect, vi, beforeEach } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('../jira-client.js', () => ({
  JiraClient: class {
    request = request
  },
}))

import { JiraTaskTracker } from '../jira-task-tracker.js'

const makeTracker = () =>
  new JiraTaskTracker({ token: 'tok', host: 'acme.atlassian.net', email: 'me@acme.com', project: 'PROJ' })

describe('JiraTaskTracker labels', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('adds a label with a single PUT and no GET first', async () => {
    request.mockResolvedValue(undefined)

    await makeTracker().addLabel('PROJ-1', 'Agentic-Reproduction-Success')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('PUT', '/issue/PROJ-1', {
      update: { labels: [{ add: 'Agentic-Reproduction-Success' }] },
    })
    expect(request.mock.calls.some(([method]) => method === 'GET')).toBe(false)
  })

  it('removes a label with a single PUT and no GET first', async () => {
    request.mockResolvedValue(undefined)

    await makeTracker().removeLabel('PROJ-1', 'Agentic-Reproduction-In-Progress')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('PUT', '/issue/PROJ-1', {
      update: { labels: [{ remove: 'Agentic-Reproduction-In-Progress' }] },
    })
    expect(request.mock.calls.some(([method]) => method === 'GET')).toBe(false)
  })
})
