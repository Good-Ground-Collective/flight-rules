import type { Attachment, Comment, CreateEpicInput, CreateInitiativeInput, CreateTicketInput, CreateTechnicalDesignInput, EntityMetadata, Epic, Initiative, TaskTracker, TechnicalDesign, Ticket, TrackerUser, UpdateEpicInput, UpdateInitiativeInput, UpdateTicketInput } from '../task-tracker/task-tracker.js';
export interface GitHubTrackerConfig {
    token: string;
    owner: string;
    repo: string;
}
export declare class GitHubTaskTracker implements TaskTracker {
    private octokit;
    private gql;
    private owner;
    private repo;
    private readonly bodyMetadata;
    constructor(config: GitHubTrackerConfig);
    createEpic(input: CreateEpicInput): Promise<Epic>;
    createInitiative(input: CreateInitiativeInput): Promise<Initiative>;
    getInitiative(id: string): Promise<Initiative>;
    linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void>;
    getEpic(id: string): Promise<Epic>;
    createTicket(input: CreateTicketInput): Promise<Ticket>;
    getTicket(id: string): Promise<Ticket>;
    linkTicketToEpic(ticketId: string, epicId: string): Promise<void>;
    blockTicket(ticketId: string, blockedById: string): Promise<void>;
    unblockTicket(ticketId: string, blockedById: string): Promise<void>;
    transitionTicket(ticketId: string, status: string): Promise<void>;
    listTransitions(): Promise<string[]>;
    /**
     * GitHub labels double as the tracker's type system — `epic`/`ticket` and
     * `status:<slug>` — so a generic label write could silently change a
     * ticket's size or status. Label lifecycle writes are Jira-only.
     */
    addLabel(ticketId: string, label: string): Promise<void>;
    removeLabel(ticketId: string, label: string): Promise<void>;
    updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void>;
    updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void>;
    updateEpicDescription(epicId: string, input: UpdateEpicInput): Promise<Epic>;
    updateTicketDescription(ticketId: string, input: UpdateTicketInput): Promise<Ticket>;
    updateInitiativeDescription(initiativeId: string, input: UpdateInitiativeInput): Promise<Initiative>;
    updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void>;
    createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>;
    getTechnicalDesign(id: string): Promise<TechnicalDesign>;
    addComment(entityId: string, body: string): Promise<Comment>;
    addAttachment(ticketId: string, filePath: string): Promise<Attachment>;
    getUsers(): Promise<TrackerUser[]>;
    ping(): Promise<void>;
    private replaceIssueBody;
    /**
     * The label set to write on an edit: the caller's labels plus the role
     * (`epic`/`ticket`) and any `status:` label the issue already carries, so a
     * `--labels` edit replaces the free-form labels without dropping the ones the
     * factory manages.
     */
    private mergeLabels;
    private resolveIssueId;
    /**
     * Every `status:` label the repo defines, paginated so a repo with more than
     * one page of labels cannot silently omit some. The vocabulary is repo-wide,
     * which is why `listTransitions` ignores the ticket id it is handed.
     */
    private statusLabelNames;
    private labelName;
    private mapComment;
    private mapTicket;
}
