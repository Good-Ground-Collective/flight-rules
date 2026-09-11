import { z } from 'zod'

export const entitySizes = ['ticket', 'epic', 'initiative'] as const
export type EntitySize = (typeof entitySizes)[number]

export const EntityMetadataSchema = z
  .object({
    tddId: z.number().optional(),
    epicId: z.number().optional(),
    notes: z.string().optional(),
  })
  .passthrough()

export type EntityMetadata = z.infer<typeof EntityMetadataSchema>

export const CommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().optional(),
  mediaUuid: z.string().optional(),
})

export const TechnicalDesignSchema = z.object({
  id: z.string(),
  epicId: z.string(),
  url: z.string().optional(),
  body: z.string(),
  comments: z.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const TicketSchema = z.object({
  id: z.string(),
  size: z.literal('ticket'),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  assignee: z.string().nullable(),
  attachments: z.array(AttachmentSchema).default([]),
  reporter: z.string().nullable().default(null),
  issueType: z.string().default('unknown'),
  blockedBy: z.array(z.string()).default([]),
  blocking: z.array(z.string()).default([]),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const EpicSchema = z.object({
  id: z.string(),
  size: z.literal('epic'),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  childIssues: z.array(TicketSchema),
  comments: z.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const CreateEpicInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([]),
  metadata: EntityMetadataSchema.partial().optional(),
})

export const CreateTicketInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  /** Absent for a standalone ticket: a ticket-sized RFC has no epic to parent to. */
  epicId: z.string().optional(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
  metadata: EntityMetadataSchema.partial().optional(),
})

export const CreateTechnicalDesignInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
  metadata: EntityMetadataSchema.partial().optional(),
})

/**
 * A body-replacing edit. `body` is required (an edit always rewrites the
 * human-facing description); `title` and `labels` are absent to leave those
 * fields untouched. Entity metadata is preserved by the tracker, not passed
 * here — it is re-merged from the existing description on write.
 */
export const UpdateEpicInputSchema = z.object({
  body: z.string(),
  title: z.string().optional(),
  labels: z.array(z.string()).optional(),
})

export const UpdateTicketInputSchema = z.object({
  body: z.string(),
  title: z.string().optional(),
  labels: z.array(z.string()).optional(),
})

export const UpdateInitiativeInputSchema = z.object({
  body: z.string(),
  title: z.string().optional(),
})

export const InitiativeSchema = z.object({
  id: z.string(),
  size: z.literal('initiative'),
  title: z.string(),
  body: z.string(),
  epics: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
})

export const CreateInitiativeInputSchema = z.object({
  title: z.string(),
  body: z.string(),
})

export type Comment = z.infer<typeof CommentSchema>
export type Attachment = z.infer<typeof AttachmentSchema>
export type TechnicalDesign = z.infer<typeof TechnicalDesignSchema>
export type Ticket = z.infer<typeof TicketSchema>
export type Epic = z.infer<typeof EpicSchema>
export type CreateEpicInput = z.infer<typeof CreateEpicInputSchema>
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>
export type CreateTechnicalDesignInput = z.infer<typeof CreateTechnicalDesignInputSchema>
export type Initiative = z.infer<typeof InitiativeSchema>
export type CreateInitiativeInput = z.infer<typeof CreateInitiativeInputSchema>
export type UpdateEpicInput = z.infer<typeof UpdateEpicInputSchema>
export type UpdateTicketInput = z.infer<typeof UpdateTicketInputSchema>
export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeInputSchema>

export interface TaskTracker {
  createEpic(input: CreateEpicInput): Promise<Epic>
  getEpic(id: string): Promise<Epic>
  createTicket(input: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  blockTicket(ticketId: string, blockedById: string): Promise<void>
  unblockTicket(ticketId: string, blockedById: string): Promise<void>
  transitionTicket(ticketId: string, status: string): Promise<void>
  listTransitions(ticketId: string): Promise<string[]>
  addLabel(ticketId: string, label: string): Promise<void>
  removeLabel(ticketId: string, label: string): Promise<void>
  updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateEpicDescription(epicId: string, input: UpdateEpicInput): Promise<Epic>
  updateTicketDescription(ticketId: string, input: UpdateTicketInput): Promise<Ticket>
  updateInitiativeDescription(initiativeId: string, input: UpdateInitiativeInput): Promise<Initiative>
  createInitiative(input: CreateInitiativeInput): Promise<Initiative>
  getInitiative(id: string): Promise<Initiative>
  linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void>
  createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>
  getTechnicalDesign(id: string): Promise<TechnicalDesign>
  addComment(entityId: string, body: string): Promise<Comment>
  addAttachment(ticketId: string, filePath: string): Promise<Attachment>
  getUsers(): Promise<string[]>
  ping(): Promise<void>
}
