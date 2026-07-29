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

const blocksType = { id: '10100', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }
const linkTypes = (types: unknown[] = [blocksType]) => ({ issueLinkTypes: types })

const issueLinks = (key: string, links: unknown[]) => ({
  id: `id-${key}`,
  key,
  fields: { summary: 'Summary', issuelinks: links },
})

const postLinkBody = (): Record<string, unknown> => {
  const call = request.mock.calls.find(([method, path]) => method === 'POST' && path === '/issueLink')
  return call?.[2] as Record<string, unknown>
}

describe('JiraTaskTracker.blockTicket', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('creates a Blocks link with the blocker outward and the blocked ticket inward', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes())
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issueLinks('PROJ-2', []))
      if (method === 'POST' && path === '/issueLink') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().blockTicket('PROJ-2', 'PROJ-9')

    expect(postLinkBody()).toEqual({
      type: { name: 'Blocks' },
      inwardIssue: { key: 'PROJ-2' },
      outwardIssue: { key: 'PROJ-9' },
    })
  })

  it('rejects a self-block without touching the API', async () => {
    request.mockImplementation((method: string, path: string) => {
      throw new Error(`unexpected ${method} ${path}`)
    })

    await expect(makeTracker().blockTicket('PROJ-2', 'PROJ-2')).rejects.toThrow(/cannot block itself/)
    expect(request).not.toHaveBeenCalled()
  })

  it('no-ops when the Blocks link already exists', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes())
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(issueLinks('PROJ-2', [{ type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-9' } }]))
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().blockTicket('PROJ-2', 'PROJ-9')

    expect(request.mock.calls.some(([method]) => method === 'POST')).toBe(false)
  })

  it('throws a clear error when no Blocks link type is configured', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType')
        return Promise.resolve(linkTypes([{ id: '1', name: 'Relates', inward: 'relates to', outward: 'relates to' }]))
      throw new Error(`unexpected ${method} ${path}`)
    })

    await expect(makeTracker().blockTicket('PROJ-2', 'PROJ-9')).rejects.toThrow(/Blocks.*link type/)
  })
})

describe('JiraTaskTracker.unblockTicket', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('finds the matching Blocks link and deletes it by id', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes())
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(
          issueLinks('PROJ-2', [
            { id: '55', type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-9' } },
            { id: '56', type: { name: 'Relates' }, outwardIssue: { key: 'PROJ-8' } },
          ]),
        )
      if (method === 'DELETE' && path === '/issueLink/55') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().unblockTicket('PROJ-2', 'PROJ-9')

    expect(request.mock.calls.some(([method, path]) => method === 'DELETE' && path === '/issueLink/55')).toBe(true)
  })

  it('no-ops when no matching Blocks link is present', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes())
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issueLinks('PROJ-2', []))
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().unblockTicket('PROJ-2', 'PROJ-9')

    expect(request.mock.calls.some(([method]) => method === 'DELETE')).toBe(false)
  })
})

describe('JiraTaskTracker Blocks link-type resolution', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('resolves the link type once and reuses it across calls', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes())
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issueLinks('PROJ-2', []))
      if (method === 'POST' && path === '/issueLink') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    const tracker = makeTracker()
    await tracker.blockTicket('PROJ-2', 'PROJ-9')
    await tracker.blockTicket('PROJ-2', 'PROJ-8')

    const linkTypeFetches = request.mock.calls.filter(([method, path]) => method === 'GET' && path === '/issueLinkType')
    expect(linkTypeFetches).toHaveLength(1)
  })

  it('matches the instance-configured casing rather than a hardcoded name', async () => {
    const renamed = { id: '9', name: 'BLOCKS', inward: 'is blocked by', outward: 'blocks' }
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issueLinkType') return Promise.resolve(linkTypes([renamed]))
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issueLinks('PROJ-2', []))
      if (method === 'POST' && path === '/issueLink') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().blockTicket('PROJ-2', 'PROJ-9')

    expect(postLinkBody()['type']).toEqual({ name: 'BLOCKS' })
  })
})
