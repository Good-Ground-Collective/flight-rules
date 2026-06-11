import { describe, it, expect } from 'vitest'
import {
  CommentSchema,
  TicketSchema,
  EpicSchema,
  CreateEpicInputSchema,
  CreateTicketInputSchema,
  CreateTechnicalDesignInputSchema,
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
})

describe('EpicSchema', () => {
  it('parses a valid epic with no TDD', () => {
    const result = EpicSchema.parse({
      id: '10',
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
