import { z } from 'zod'

const UnsupportedTrackerOperationPropsSchema = z.object({
  tracker: z.string().min(1),
  operation: z.string().min(1),
  remedy: z.string().min(1).optional(),
})

export type UnsupportedTrackerOperationProps = z.infer<typeof UnsupportedTrackerOperationPropsSchema>

/**
 * Thrown when a tracker backend has no answer for part of the TaskTracker
 * contract, so a caller can tell "this tracker will never do this" from an
 * API failure worth retrying.
 */
export class UnsupportedTrackerOperationError extends Error {
  readonly tracker: string
  readonly operation: string

  constructor(props: UnsupportedTrackerOperationProps) {
    const parsed = UnsupportedTrackerOperationPropsSchema.parse(props)
    super(
      `The ${parsed.tracker} tracker does not support ${parsed.operation}` +
        (parsed.remedy !== undefined ? ` — ${parsed.remedy}` : ''),
    )
    this.name = 'UnsupportedTrackerOperationError'
    this.tracker = parsed.tracker
    this.operation = parsed.operation
  }
}
