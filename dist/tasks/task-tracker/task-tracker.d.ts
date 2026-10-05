import { z } from 'zod';
export declare const entitySizes: readonly ["ticket", "epic", "initiative"];
export type EntitySize = (typeof entitySizes)[number];
export declare const TrackerUserSchema: z.ZodObject<{
    accountId: z.ZodString;
    displayName: z.ZodString;
}, z.core.$strip>;
export type TrackerUser = z.infer<typeof TrackerUserSchema>;
export declare const EntityMetadataSchema: z.ZodObject<{
    tddId: z.ZodOptional<z.ZodNumber>;
    epicId: z.ZodOptional<z.ZodNumber>;
    notes: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        bug: "bug";
        story: "story";
    }>>;
}, z.core.$loose>;
export type EntityMetadata = z.infer<typeof EntityMetadataSchema>;
export declare const CommentSchema: z.ZodObject<{
    id: z.ZodString;
    body: z.ZodString;
    author: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const AttachmentSchema: z.ZodObject<{
    id: z.ZodString;
    filename: z.ZodString;
    mimeType: z.ZodString;
    size: z.ZodOptional<z.ZodNumber>;
    mediaUuid: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const TechnicalDesignSchema: z.ZodObject<{
    id: z.ZodString;
    epicId: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    body: z.ZodString;
    comments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    metadata: z.ZodDefault<z.ZodObject<{
        tddId: z.ZodOptional<z.ZodNumber>;
        epicId: z.ZodOptional<z.ZodNumber>;
        notes: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            bug: "bug";
            story: "story";
        }>>;
    }, z.core.$loose>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const TicketSchema: z.ZodObject<{
    id: z.ZodString;
    size: z.ZodLiteral<"ticket">;
    status: z.ZodString;
    labels: z.ZodArray<z.ZodString>;
    title: z.ZodString;
    body: z.ZodString;
    comments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    assignee: z.ZodNullable<z.ZodString>;
    attachments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        filename: z.ZodString;
        mimeType: z.ZodString;
        size: z.ZodOptional<z.ZodNumber>;
        mediaUuid: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    reporter: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    issueType: z.ZodDefault<z.ZodString>;
    blockedBy: z.ZodDefault<z.ZodArray<z.ZodString>>;
    blocking: z.ZodDefault<z.ZodArray<z.ZodString>>;
    metadata: z.ZodDefault<z.ZodObject<{
        tddId: z.ZodOptional<z.ZodNumber>;
        epicId: z.ZodOptional<z.ZodNumber>;
        notes: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            bug: "bug";
            story: "story";
        }>>;
    }, z.core.$loose>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const EpicSchema: z.ZodObject<{
    id: z.ZodString;
    size: z.ZodLiteral<"epic">;
    status: z.ZodString;
    labels: z.ZodArray<z.ZodString>;
    title: z.ZodString;
    body: z.ZodString;
    childIssues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        size: z.ZodLiteral<"ticket">;
        status: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        title: z.ZodString;
        body: z.ZodString;
        comments: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            body: z.ZodString;
            author: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
        }, z.core.$strip>>;
        assignee: z.ZodNullable<z.ZodString>;
        attachments: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            filename: z.ZodString;
            mimeType: z.ZodString;
            size: z.ZodOptional<z.ZodNumber>;
            mediaUuid: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        reporter: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        issueType: z.ZodDefault<z.ZodString>;
        blockedBy: z.ZodDefault<z.ZodArray<z.ZodString>>;
        blocking: z.ZodDefault<z.ZodArray<z.ZodString>>;
        metadata: z.ZodDefault<z.ZodObject<{
            tddId: z.ZodOptional<z.ZodNumber>;
            epicId: z.ZodOptional<z.ZodNumber>;
            notes: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                bug: "bug";
                story: "story";
            }>>;
        }, z.core.$loose>>;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    comments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    tdd: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        epicId: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        body: z.ZodString;
        comments: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            body: z.ZodString;
            author: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
        }, z.core.$strip>>;
        metadata: z.ZodDefault<z.ZodObject<{
            tddId: z.ZodOptional<z.ZodNumber>;
            epicId: z.ZodOptional<z.ZodNumber>;
            notes: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                bug: "bug";
                story: "story";
            }>>;
        }, z.core.$loose>>;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    metadata: z.ZodDefault<z.ZodObject<{
        tddId: z.ZodOptional<z.ZodNumber>;
        epicId: z.ZodOptional<z.ZodNumber>;
        notes: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            bug: "bug";
            story: "story";
        }>>;
    }, z.core.$loose>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreateEpicInputSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    labels: z.ZodDefault<z.ZodArray<z.ZodString>>;
    metadata: z.ZodOptional<z.ZodObject<{
        tddId: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        epicId: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        kind: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
            bug: "bug";
            story: "story";
        }>>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export declare const CreateTicketInputSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    epicId: z.ZodOptional<z.ZodString>;
    labels: z.ZodDefault<z.ZodArray<z.ZodString>>;
    assignee: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodObject<{
        tddId: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        epicId: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        kind: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
            bug: "bug";
            story: "story";
        }>>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export declare const CreateTechnicalDesignInputSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    epicId: z.ZodString;
    metadata: z.ZodOptional<z.ZodObject<{
        tddId: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        epicId: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        kind: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
            bug: "bug";
            story: "story";
        }>>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
/**
 * A body-replacing edit. `body` is required (an edit always rewrites the
 * human-facing description); `title` and `labels` are absent to leave those
 * fields untouched. Entity metadata is preserved by the tracker, not passed
 * here — it is re-merged from the existing description on write.
 */
export declare const UpdateEpicInputSchema: z.ZodObject<{
    body: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const UpdateTicketInputSchema: z.ZodObject<{
    body: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const UpdateInitiativeInputSchema: z.ZodObject<{
    body: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const InitiativeSchema: z.ZodObject<{
    id: z.ZodString;
    size: z.ZodLiteral<"initiative">;
    title: z.ZodString;
    body: z.ZodString;
    epics: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const CreateInitiativeInputSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
}, z.core.$strip>;
export type Comment = z.infer<typeof CommentSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type TechnicalDesign = z.infer<typeof TechnicalDesignSchema>;
export type Ticket = z.infer<typeof TicketSchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type CreateEpicInput = z.infer<typeof CreateEpicInputSchema>;
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;
export type CreateTechnicalDesignInput = z.infer<typeof CreateTechnicalDesignInputSchema>;
export type Initiative = z.infer<typeof InitiativeSchema>;
export type CreateInitiativeInput = z.infer<typeof CreateInitiativeInputSchema>;
export type UpdateEpicInput = z.infer<typeof UpdateEpicInputSchema>;
export type UpdateTicketInput = z.infer<typeof UpdateTicketInputSchema>;
export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeInputSchema>;
export interface TaskTracker {
    createEpic(input: CreateEpicInput): Promise<Epic>;
    getEpic(id: string): Promise<Epic>;
    createTicket(input: CreateTicketInput): Promise<Ticket>;
    getTicket(id: string): Promise<Ticket>;
    linkTicketToEpic(ticketId: string, epicId: string): Promise<void>;
    blockTicket(ticketId: string, blockedById: string): Promise<void>;
    unblockTicket(ticketId: string, blockedById: string): Promise<void>;
    transitionTicket(ticketId: string, status: string): Promise<void>;
    listTransitions(ticketId: string): Promise<string[]>;
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
    addAttachment(ticketId: string, filePath: string): Promise<Attachment>;
    getUsers(): Promise<TrackerUser[]>;
    ping(): Promise<void>;
}
