import type { Epic, TaskTracker } from '../task-tracker/task-tracker.js'

/** The tracker surface the guard needs: parent lookup, the link itself, and where a reason is recorded. */
export type EpicBoundaryTracker = Pick<
  TaskTracker,
  'getTicketEpicId' | 'blockTicket' | 'getTicket' | 'addComment' | 'updateTicketMetadata'
>

export type EpicLookup = Pick<TaskTracker, 'getTicketEpicId'>

export interface BlockRequest {
  ticketId: string
  blockerId: string
  /** The `--cross-epic-reason` value; required only when the two tickets sit in different epics. */
  reason?: string | undefined
}

export interface BlockOutcome {
  ticketEpic: string | null
  blockerEpic: string | null
  crossEpic: boolean
  reasonRecorded: boolean
  /** Parent epics that could not be resolved; the link still went ahead. */
  warnings: string[]
}

export interface CrossEpicEdge {
  ticket: string
  ticketEpic: string
  blockedBy: string
  /** Null when the blocker has no parent epic or its parent could not be resolved. */
  blockerEpic: string | null
  justification: string | null
}

interface ParentLookup {
  epic: string | null
  warning: string | null
}

/** GitHub ids are bare issue numbers, so they read as `#12`; Jira keys read as themselves. */
export class TrackerRefFormatter {
  format(id: string): string {
    return /^\d+$/.test(id) ? `#${id}` : id
  }
}

const refs = new TrackerRefFormatter()

export class CrossEpicDependencyError extends Error {
  override name = 'CrossEpicDependencyError'

  constructor(props: {
    ticketId: string
    ticketEpic: string
    blockerId: string
    blockerEpic: string
  }) {
    const ticket = refs.format(props.ticketId)
    const blocker = refs.format(props.blockerId)
    const ticketEpic = refs.format(props.ticketEpic)
    const blockerEpic = refs.format(props.blockerEpic)
    super(
      `refusing to block ${ticket} (epic ${ticketEpic}) on ${blocker} (epic ${blockerEpic}): ` +
        `blocked-by edges stay inside one epic. Move ${ticket} into epic ${blockerEpic}, merge the two tickets, ` +
        `or finish epic ${blockerEpic} before epic ${ticketEpic} starts. If the edge is absolutely necessary, ` +
        `pass --cross-epic-reason "<why>" and it is recorded on ${ticket}.`,
    )
  }
}

/**
 * Wraps `blockTicket` with the epic-boundary rule (docs/epic-boundaries.md): a
 * blocked-by edge between two epics needs a recorded reason. A parent that
 * cannot be resolved is a warning, never a refusal, so a tracker hiccup or a
 * standalone ticket never stops a link.
 */
export class EpicBoundaryGuard {
  constructor(private readonly tracker: EpicBoundaryTracker) {}

  async block(request: BlockRequest): Promise<BlockOutcome> {
    const reason = this.normalizeReason(request.reason)
    const [ticket, blocker] = await Promise.all([
      this.lookupParent(request.ticketId),
      this.lookupParent(request.blockerId),
    ])
    const warnings = [ticket.warning, blocker.warning].filter((w): w is string => w !== null)
    const sameEpic = ticket.epic !== null && ticket.epic === blocker.epic
    const crossEpic = ticket.epic !== null && blocker.epic !== null && ticket.epic !== blocker.epic

    if (crossEpic && reason === undefined) {
      throw new CrossEpicDependencyError({
        ticketId: request.ticketId,
        ticketEpic: ticket.epic ?? '',
        blockerId: request.blockerId,
        blockerEpic: blocker.epic ?? '',
      })
    }

    await this.tracker.blockTicket(request.ticketId, request.blockerId)

    // A same-epic edge needs no reason, so one passed anyway is dropped rather than recorded.
    const reasonRecorded = reason !== undefined && !sameEpic
    if (reasonRecorded) await this.recordReason(request, ticket.epic, blocker.epic, reason)

    return {
      ticketEpic: ticket.epic,
      blockerEpic: blocker.epic,
      crossEpic,
      reasonRecorded,
      warnings,
    }
  }

  private normalizeReason(reason: string | undefined): string | undefined {
    if (reason === undefined) return undefined
    const oneLine = reason.replace(/\s+/g, ' ').trim()
    if (oneLine === '')
      throw new Error('--cross-epic-reason needs a one-line justification, not an empty string')
    return oneLine
  }

  private async lookupParent(ticketId: string): Promise<ParentLookup> {
    try {
      const epic = (await this.tracker.getTicketEpicId(ticketId)) ?? null
      if (epic !== null) return { epic, warning: null }
      return {
        epic: null,
        warning: `${refs.format(ticketId)} has no parent epic; the epic-boundary check was skipped`,
      }
    } catch (error) {
      return {
        epic: null,
        warning: `could not resolve the parent epic of ${refs.format(ticketId)} (${error instanceof Error ? error.message : String(error)}); the epic-boundary check was skipped`,
      }
    }
  }

  /**
   * The reason lands twice: a comment for people reading the ticket, and the
   * ticket's metadata so the plan verbs can show it without reading comments
   * (Jira's ticket read carries none). An identical reason already on record
   * is left alone, so re-running the same link does not repeat the comment.
   */
  private async recordReason(
    request: BlockRequest,
    ticketEpic: string | null,
    blockerEpic: string | null,
    reason: string,
  ): Promise<void> {
    const { ticketId, blockerId } = request
    const existing = (await this.tracker.getTicket(ticketId)).metadata.crossEpicReasons ?? {}
    if (existing[blockerId] === reason) return

    const blocker = refs.format(blockerId)
    const blockerPart =
      blockerEpic === null ? blocker : `${blocker} (epic ${refs.format(blockerEpic)})`
    const ticketPart =
      ticketEpic === null ? '' : `, while this ticket is in epic ${refs.format(ticketEpic)}`
    await this.tracker.addComment(
      ticketId,
      `Cross-epic dependency: blocked by ${blockerPart}${ticketPart}. Reason: ${reason}`,
    )
    await this.tracker.updateTicketMetadata(ticketId, {
      crossEpicReasons: { ...existing, [blockerId]: reason },
    })
  }
}

/**
 * Lists the blocked-by edges of open tickets that leave their epic. Blockers
 * inside the planned epics are placed from the epics themselves; any other
 * blocker is looked up once through the tracker, and a failed lookup reads as
 * 'epic unknown' rather than failing the plan.
 */
export class CrossEpicEdgeFinder {
  constructor(private readonly tracker: EpicLookup) {}

  async find(epics: readonly Pick<Epic, 'id' | 'childIssues'>[]): Promise<CrossEpicEdge[]> {
    const epicOf = new Map<string, string>()
    for (const epic of epics) for (const ticket of epic.childIssues) epicOf.set(ticket.id, epic.id)

    const external = [
      ...new Set(
        epics.flatMap((epic) =>
          epic.childIssues.flatMap((ticket) => ticket.blockedBy.filter((id) => !epicOf.has(id))),
        ),
      ),
    ]
    const resolved = await Promise.all(
      external.map(
        async (id) => [id, await this.tracker.getTicketEpicId(id).catch(() => null)] as const,
      ),
    )
    for (const [id, epic] of resolved)
      if (epic !== null && epic !== undefined) epicOf.set(id, epic)

    return epics.flatMap((epic) =>
      epic.childIssues
        .filter((ticket) => ticket.status !== 'closed')
        .flatMap((ticket) =>
          ticket.blockedBy
            .filter((blockerId) => epicOf.get(blockerId) !== epic.id)
            .map((blockerId) => ({
              ticket: ticket.id,
              ticketEpic: epic.id,
              blockedBy: blockerId,
              blockerEpic: epicOf.get(blockerId) ?? null,
              justification: ticket.metadata.crossEpicReasons?.[blockerId] ?? null,
            })),
        ),
    )
  }

  /** One human-readable warning line per edge, for stderr. */
  warnings(edges: readonly CrossEpicEdge[]): string[] {
    return edges.map((edge) => {
      const blockerEpic =
        edge.blockerEpic === null ? 'epic unknown' : `epic ${refs.format(edge.blockerEpic)}`
      const why =
        edge.justification === null
          ? 'no justification recorded'
          : `justification: ${edge.justification}`
      return (
        `warning: cross-epic dependency: ${refs.format(edge.ticket)} (epic ${refs.format(edge.ticketEpic)}) ` +
        `is blocked by ${refs.format(edge.blockedBy)} (${blockerEpic}); ${why}`
      )
    })
  }
}
