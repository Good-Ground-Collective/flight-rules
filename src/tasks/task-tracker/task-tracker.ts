import { z } from 'zod'

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

export const TechnicalDesignSchema = z.object({
  id: z.string(),
  epicId: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const TicketSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  assignee: z.string().nullable(),
  blockedBy: z.array(z.string()).default([]),
  blocking: z.array(z.string()).default([]),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z.string(),
})

export const EpicSchema = z.object({
  id: z.string(),
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
  epicId: z.string(),
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

export type Comment = z.infer<typeof CommentSchema>
export type TechnicalDesign = z.infer<typeof TechnicalDesignSchema>
export type Ticket = z.infer<typeof TicketSchema>
export type Epic = z.infer<typeof EpicSchema>
export type CreateEpicInput = z.infer<typeof CreateEpicInputSchema>
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>
export type CreateTechnicalDesignInput = z.infer<typeof CreateTechnicalDesignInputSchema>

export interface TaskTracker {
  createEpic(input: CreateEpicInput): Promise<Epic>
  getEpic(id: string): Promise<Epic>
  createTicket(input: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  blockTicket(ticketId: string, blockedById: string): Promise<void>
  unblockTicket(ticketId: string, blockedById: string): Promise<void>
  updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void>
  updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void>
  createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>
  getTechnicalDesign(id: string): Promise<TechnicalDesign>
  addComment(entityId: string, body: string): Promise<Comment>
}
