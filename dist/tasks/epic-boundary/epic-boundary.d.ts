import type { Epic, TaskTracker } from '../task-tracker/task-tracker.js';
/** The tracker surface the guard needs: parent lookup, the link itself, and where a reason is recorded. */
export type EpicBoundaryTracker = Pick<TaskTracker, 'getTicketEpicId' | 'blockTicket' | 'getTicket' | 'addComment' | 'updateTicketMetadata'>;
export type EpicLookup = Pick<TaskTracker, 'getTicketEpicId'>;
export interface BlockRequest {
    ticketId: string;
    blockerId: string;
    /** The `--cross-epic-reason` value; required only when the two tickets sit in different epics. */
    reason?: string | undefined;
}
export interface BlockOutcome {
    ticketEpic: string | null;
    blockerEpic: string | null;
    crossEpic: boolean;
    reasonRecorded: boolean;
    /** Parent epics that could not be resolved; the link still went ahead. */
    warnings: string[];
}
export interface CrossEpicEdge {
    ticket: string;
    ticketEpic: string;
    blockedBy: string;
    /** Null when the blocker has no parent epic or its parent could not be resolved. */
    blockerEpic: string | null;
    justification: string | null;
}
/** GitHub ids are bare issue numbers, so they read as `#12`; Jira keys read as themselves. */
export declare class TrackerRefFormatter {
    format(id: string): string;
}
export declare class CrossEpicDependencyError extends Error {
    name: string;
    constructor(props: {
        ticketId: string;
        ticketEpic: string;
        blockerId: string;
        blockerEpic: string;
    });
}
/**
 * Wraps `blockTicket` with the epic-boundary rule (docs/epic-boundaries.md): a
 * blocked-by edge between two epics needs a recorded reason. A parent that
 * cannot be resolved is a warning, never a refusal, so a tracker hiccup or a
 * standalone ticket never stops a link.
 */
export declare class EpicBoundaryGuard {
    private readonly tracker;
    constructor(tracker: EpicBoundaryTracker);
    block(request: BlockRequest): Promise<BlockOutcome>;
    private normalizeReason;
    private lookupParent;
    /**
     * The reason lands twice: a comment for people reading the ticket, and the
     * ticket's metadata so the plan verbs can show it without reading comments
     * (Jira's ticket read carries none). An identical reason already on record
     * is left alone, so re-running the same link does not repeat the comment.
     */
    private recordReason;
}
/**
 * Lists the blocked-by edges of open tickets that leave their epic. Blockers
 * inside the planned epics are placed from the epics themselves; any other
 * blocker is looked up once through the tracker, and a failed lookup reads as
 * 'epic unknown' rather than failing the plan.
 */
export declare class CrossEpicEdgeFinder {
    private readonly tracker;
    constructor(tracker: EpicLookup);
    find(epics: readonly Pick<Epic, 'id' | 'childIssues'>[]): Promise<CrossEpicEdge[]>;
    /** One human-readable warning line per edge, for stderr. */
    warnings(edges: readonly CrossEpicEdge[]): string[];
}
