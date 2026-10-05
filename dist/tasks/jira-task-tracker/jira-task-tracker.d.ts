import type { JiraTrackerConfig } from './jira-interfaces.js';
import type { Attachment, Comment, CreateEpicInput, CreateInitiativeInput, CreateTechnicalDesignInput, CreateTicketInput, EntityMetadata, Epic, Initiative, TaskTracker, TechnicalDesign, Ticket, TrackerUser, UpdateEpicInput, UpdateInitiativeInput, UpdateTicketInput } from '../task-tracker/task-tracker.js';
/**
 * The Jira / Jira Product Discovery backend. Epics map to the Epic issue type
 * and tickets to Story; parentage rides the native `parent` field, and entity
 * metadata round-trips through the ADF description via {@link AdfMetadataService}.
 * Blocking dependencies ride "Blocks" issue links, resolved by name from the
 * instance, and entity metadata updates splice back through the description.
 * Initiatives map to JPD Ideas in the configured discovery project, linked to
 * delivery epics via the "Polaris issue link" type. Technical designs are
 * Confluence pages in the configured space, their metadata held in a native
 * content property and their URL stamped onto the parent epic.
 */
export declare class JiraTaskTracker implements TaskTracker {
    private readonly client;
    private readonly confluence;
    private readonly project;
    private readonly jpdProject;
    private readonly confluenceSpaceKey;
    private readonly metadata;
    private readonly bodyFormat;
    private readonly mimeTypes;
    private issueTypeNames;
    private blocksLinkType;
    private deliveryLinkType;
    private confluenceSpaceId;
    private jpdProjectVerified;
    constructor(config: JiraTrackerConfig);
    createEpic(input: CreateEpicInput): Promise<Epic>;
    getEpic(id: string): Promise<Epic>;
    createTicket(input: CreateTicketInput): Promise<Ticket>;
    getTicket(id: string): Promise<Ticket>;
    linkTicketToEpic(ticketId: string, epicId: string): Promise<void>;
    blockTicket(ticketId: string, blockedById: string): Promise<void>;
    unblockTicket(ticketId: string, blockedById: string): Promise<void>;
    transitionTicket(ticketId: string, status: string): Promise<void>;
    listTransitions(ticketId: string): Promise<string[]>;
    /**
     * Jira's `add`/`remove` label verbs are set operations, so the write is
     * atomic against whatever labels the issue already has — no read first.
     */
    addLabel(ticketId: string, label: string): Promise<void>;
    removeLabel(ticketId: string, label: string): Promise<void>;
    updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void>;
    updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void>;
    updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void>;
    updateEpicDescription(epicId: string, input: UpdateEpicInput): Promise<Epic>;
    updateTicketDescription(ticketId: string, input: UpdateTicketInput): Promise<Ticket>;
    updateInitiativeDescription(initiativeId: string, input: UpdateInitiativeInput): Promise<Initiative>;
    createInitiative(input: CreateInitiativeInput): Promise<Initiative>;
    getInitiative(id: string): Promise<Initiative>;
    linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void>;
    createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>;
    getTechnicalDesign(id: string): Promise<TechnicalDesign>;
    addComment(entityId: string, body: string): Promise<Comment>;
    /**
     * Uploads a file as a native Jira attachment and resolves the media UUID that
     * inline ADF media nodes address it by; Jira only reveals that UUID in the
     * redirect it issues for the attachment's content URL.
     */
    addAttachment(ticketId: string, filePath: string): Promise<Attachment>;
    getUsers(): Promise<TrackerUser[]>;
    ping(): Promise<void>;
    private searchChildren;
    private mapTicket;
    private mapAttachment;
    private mapAttachments;
    private blockingLinks;
    private replaceIssueBody;
    private spliceDescriptionMetadata;
    private deliveryLinkedKeys;
    private ensureJpdProject;
    private issueLinks;
    private fetchTransitions;
    private resolveMediaUuid;
    private extractMediaUuid;
    private resolveBlocksLinkType;
    private resolveDeliveryLinkType;
    private parseMetadata;
    /** @param media filenames to uploaded media UUIDs, empty until the read path can resolve an issue's attachments. */
    private extractBody;
    private isMetadataNode;
    private resolveIssueType;
    private availableIssueTypes;
    private resolveConfluenceSpaceId;
    private tddMetadataProperty;
    private mapTechnicalDesign;
}
