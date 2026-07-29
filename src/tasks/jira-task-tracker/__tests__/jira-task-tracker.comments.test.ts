import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adfBuilder, type AdfDocNode } from '../adf.js'
import { jiraAdfMetadataService } from '../adf-metadata.js'
import type { EntityMetadata } from '../../task-tracker/task-tracker.js'

const request = vi.hoisted(() => vi.fn())
vi.mock('../jira-client.js', () => ({
  JiraClient: class {
    request = request
  },
}))

import { JiraTaskTracker } from '../jira-task-tracker.js'

const makeTracker = () =>
  new JiraTaskTracker({ token: 'tok', host: 'acme.atlassian.net', email: 'me@acme.com', project: 'PROJ' })

const descriptionWith = (body: string, metadata: Partial<EntityMetadata>): AdfDocNode =>
  jiraAdfMetadataService.splice(adfBuilder.doc(body), metadata)

const issueDescription = (key: string, description: AdfDocNode | null) => ({
  id: `id-${key}`,
  key,
  fields: { description },
})

const putDescription = (key: string): AdfDocNode => {
  const call = request.mock.calls.find(([method, path]) => method === 'PUT' && path === `/issue/${key}`)
  const body = call?.[2] as { fields: { description: AdfDocNode } }
  return body.fields.description
}

describe('JiraTaskTracker.addComment', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('posts an ADF comment body and maps the response into a domain Comment', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'POST' && path === '/issue/PROJ-2/comment')
        return Promise.resolve({
          id: '10050',
          author: { displayName: 'Ada Lovelace' },
          created: '2026-07-10T10:00:00.000Z',
          updated: '2026-07-10T10:05:00.000Z',
        })
      throw new Error(`unexpected ${method} ${path}`)
    })

    const comment = await makeTracker().addComment('PROJ-2', 'Looks good to me')

    expect(comment).toEqual({
      id: '10050',
      body: 'Looks good to me',
      author: 'Ada Lovelace',
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: '2026-07-10T10:05:00.000Z',
    })

    const postCall = request.mock.calls.find(([method, path]) => method === 'POST' && path === '/issue/PROJ-2/comment')
    expect(postCall?.[2]).toEqual({ body: adfBuilder.doc('Looks good to me') })
  })
})

describe('JiraTaskTracker.updateTicketMetadata', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('inserts metadata into a description that carries none', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-2')
        return Promise.resolve(issueDescription('PROJ-2', adfBuilder.doc('the body')))
      if (method === 'PUT' && path === '/issue/PROJ-2') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().updateTicketMetadata('PROJ-2', { tddId: 7 })

    expect(jiraAdfMetadataService.parse(putDescription('PROJ-2'))).toEqual({ tddId: 7 })
  })

  it('treats a null description as an empty doc', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-2') return Promise.resolve(issueDescription('PROJ-2', null))
      if (method === 'PUT' && path === '/issue/PROJ-2') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().updateTicketMetadata('PROJ-2', { tddId: 3 })

    expect(jiraAdfMetadataService.parse(putDescription('PROJ-2'))).toEqual({ tddId: 3 })
  })
})

describe('JiraTaskTracker.updateEpicMetadata', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('merges the patch, ignores undefined fields, and preserves existing/unknown keys', async () => {
    const existing = descriptionWith('epic body', { epicId: 4, notes: 'keep me', custom: 'x' } as Partial<EntityMetadata>)
    request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/issue/PROJ-1') return Promise.resolve(issueDescription('PROJ-1', existing))
      if (method === 'PUT' && path === '/issue/PROJ-1') return Promise.resolve(undefined)
      throw new Error(`unexpected ${method} ${path}`)
    })

    await makeTracker().updateEpicMetadata('PROJ-1', { tddId: 9, notes: undefined })

    expect(jiraAdfMetadataService.parse(putDescription('PROJ-1'))).toEqual({
      epicId: 4,
      notes: 'keep me',
      custom: 'x',
      tddId: 9,
    })
  })
})
