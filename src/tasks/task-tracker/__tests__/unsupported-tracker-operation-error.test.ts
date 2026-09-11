import { describe, it, expect } from 'vitest'
import { UnsupportedTrackerOperationError } from '../unsupported-tracker-operation-error.js'

describe('UnsupportedTrackerOperationError', () => {
  it('sets name, tracker, operation, and is an instanceof Error', () => {
    const error = new UnsupportedTrackerOperationError({ tracker: 'GitHub', operation: 'adding a label' })

    expect(error.name).toBe('UnsupportedTrackerOperationError')
    expect(error.tracker).toBe('GitHub')
    expect(error.operation).toBe('adding a label')
    expect(error).toBeInstanceOf(Error)
  })

  it('includes the operation in the message without a remedy', () => {
    const error = new UnsupportedTrackerOperationError({ tracker: 'GitHub', operation: 'adding a label' })

    expect(error.message).toBe('The GitHub tracker does not support adding a label')
  })

  it('appends the remedy to the message when given', () => {
    const error = new UnsupportedTrackerOperationError({
      tracker: 'GitHub',
      operation: 'adding a label',
      remedy: 'use --tracker jira',
    })

    expect(error.message).toBe('The GitHub tracker does not support adding a label — use --tracker jira')
  })

  it('rejects an empty operation', () => {
    expect(() => new UnsupportedTrackerOperationError({ tracker: 'GitHub', operation: '' })).toThrow()
  })
})
