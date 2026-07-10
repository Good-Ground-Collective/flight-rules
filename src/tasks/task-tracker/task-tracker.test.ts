import { describe, it, expect } from 'vitest'
import {
  CommentSchema,
  EntityMetadataSchema,
  TicketSchema,
  EpicSchema,
  CreateEpicInputSchema,
  CreateTicketInputSchema,
  CreateTechnicalDesignInputSchema,
  InitiativeSchema,
  CreateInitiativeInputSchema,
} from './task-tracker.js'

describe('CommentSchema', () => {
  it('parses a valid comment', () => {
    const result = CommentSchema.parse({
      id: 'c1',
      body: 'hello',
      author: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.id).toBe('c1')
  })
})

describe('TicketSchema', () => {
  it('parses a valid ticket', () => {
    const result = TicketSchema.parse({
      id: '1',
      size: 'ticket',
      status: 'open',
      labels: ['bug'],
      title: 'Fix login',
      body: 'Details',
      comments: [],
      assignee: null,
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.id).toBe('1')
    expect(result.assignee).toBeNull()
  })

  it('defaults blockedBy and blocking to empty arrays', () => {
    const result = TicketSchema.parse({
      id: '1',
      size: 'ticket',
      status: 'open',
      labels: [],
      title: 'T',
      body: 'B',
      comments: [],
      assignee: null,
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.blockedBy).toEqual([])
    expect(result.blocking).toEqual([])
  })
})

describe('EpicSchema', () => {
  it('parses a valid epic with no TDD', () => {
    const result = EpicSchema.parse({
      id: '10',
      size: 'epic',
      status: 'open',
      labels: [],
      title: 'Auth system',
      body: 'Big project',
      childIssues: [],
      comments: [],
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.tdd).toBeUndefined()
  })
})

describe('CreateEpicInputSchema', () => {
  it('defaults labels to empty array', () => {
    const result = CreateEpicInputSchema.parse({ title: 'T', body: 'B' })
    expect(result.labels).toEqual([])
  })
})

describe('CreateTicketInputSchema', () => {
  it('defaults labels to empty array', () => {
    const result = CreateTicketInputSchema.parse({ title: 'T', body: 'B', epicId: '1' })
    expect(result.labels).toEqual([])
  })
})

describe('CreateTechnicalDesignInputSchema', () => {
  it('parses all fields', () => {
    const result = CreateTechnicalDesignInputSchema.parse({ title: 'T', body: 'B', epicId: '1' })
    expect(result.epicId).toBe('1')
  })
})

describe('EntityMetadataSchema', () => {
  it('parses known fields', () => {
    const result = EntityMetadataSchema.parse({ tddId: 1, epicId: 2, notes: 'hi' })
    expect(result.tddId).toBe(1)
    expect(result.epicId).toBe(2)
    expect(result.notes).toBe('hi')
  })

  it('passes unknown keys through', () => {
    const result = EntityMetadataSchema.parse({ tddId: 1, foo: 'bar' })
    expect((result as Record<string, unknown>)['foo']).toBe('bar')
  })
})

describe('InitiativeSchema', () => {
  it('parses an initiative with linked epics', () => {
    const result = InitiativeSchema.parse({
      id: '5',
      size: 'initiative',
      title: 'Q3 Platform',
      body: 'The big push',
      epics: [{ id: '19', title: 'Decomposition' }],
    })
    expect(result.id).toBe('5')
    expect(result.epics).toEqual([{ id: '19', title: 'Decomposition' }])
  })

  it('defaults epics to an empty array when omitted', () => {
    const result = InitiativeSchema.parse({ id: '5', size: 'initiative', title: 'T', body: 'B' })
    expect(result.epics).toEqual([])
  })

  it('parses create input', () => {
    const result = CreateInitiativeInputSchema.parse({ title: 'T', body: 'B' })
    expect(result.title).toBe('T')
  })
})

describe('EpicSchema metadata', () => {
  it('defaults metadata to empty object', () => {
    const result = EpicSchema.parse({
      id: '10',
      size: 'epic',
      status: 'open',
      labels: [],
      title: 'T',
      body: 'B',
      childIssues: [],
      comments: [],
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.metadata).toEqual({})
  })
})

describe('TicketSchema metadata', () => {
  it('defaults metadata to empty object', () => {
    const result = TicketSchema.parse({
      id: '1',
      size: 'ticket',
      status: 'open',
      labels: [],
      title: 'T',
      body: 'B',
      comments: [],
      assignee: null,
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.metadata).toEqual({})
  })
})
