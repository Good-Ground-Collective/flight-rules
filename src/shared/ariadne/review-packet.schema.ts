import { z } from "zod";
import { AgentRecordIdSchema, optionalSchema } from "./ariadne.schema.js";

/**
 * Shapes in this file follow Ariadne's Review Packets API, contract version 1
 * (think-lp/ariadne docs/review-packets-api.md). Request schemas are strict and
 * reject over-long text: unlike board posts, a packet's annotations are never
 * cut to fit.
 */
export const packetLimits = {
  title: 200,
  objective: 600,
  highlight: 200,
  highlights: 5,
  prs: 30,
  focusAreas: 10,
  rationale: 2000,
  anchors: 10,
  path: 400,
  reviewers: 10,
  ticket: 100,
} as const;

export const focusAreaKinds = ["design-pattern", "business-logic", "data-schema", "other"] as const;
export const anchorSides = ["LEFT", "RIGHT"] as const;

const textSchema = (max: number) => z.string().min(1, "must not be blank").max(max, `must be at most ${max} characters`);

const oneLineTextSchema = (max: number) => textSchema(max).refine((value) => !/[\r\n]/.test(value), "must be one line");

const PositiveIntSchema = z.number().int().positive();

export const PacketIdSchema = AgentRecordIdSchema;

export const OperationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,80}$/, "must be 16–80 letters, digits, underscores or hyphens");

const HeadShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "must be a 40-character lowercase hex commit sha");

const GithubLoginSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "must be a GitHub login");

export const PacketAnchorSchema = z
  .strictObject({
    path: textSchema(packetLimits.path),
    line: PositiveIntSchema,
    startLine: optionalSchema(PositiveIntSchema),
    side: z.enum(anchorSides),
  })
  .refine((anchor) => anchor.startLine === undefined || anchor.startLine < anchor.line, {
    path: ["startLine"],
    message: "must be before line",
  });

const SignOffTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "must be an ISO 8601 UTC time ending in Z")
  .refine((value) => {
    const [year = 0, month = 0, day = 0] = value.slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "must be a real calendar date");

export const FocusAreaSchema = z.strictObject({
  id: AgentRecordIdSchema,
  kind: z.enum(focusAreaKinds),
  title: oneLineTextSchema(packetLimits.title),
  rationale: textSchema(packetLimits.rationale),
  anchors: z.array(PacketAnchorSchema).max(packetLimits.anchors, `up to ${packetLimits.anchors} anchors`),
});

export const PacketPrSchema = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/, "must be owner/name"),
  number: PositiveIntSchema,
  headSha: HeadShaSchema,
  title: oneLineTextSchema(packetLimits.title),
  ticket: optionalSchema(oneLineTextSchema(packetLimits.ticket)),
  signOff: z.strictObject({ at: SignOffTimeSchema, headSha: HeadShaSchema }).nullable().optional(),
  focusAreas: z.array(FocusAreaSchema).max(packetLimits.focusAreas, `up to ${packetLimits.focusAreas} focus areas per PR`),
});

export const PacketInputSchema = z.strictObject({
  id: PacketIdSchema,
  title: oneLineTextSchema(packetLimits.title),
  overview: z.strictObject({
    objective: textSchema(packetLimits.objective),
    highlights: z
      .array(oneLineTextSchema(packetLimits.highlight))
      .min(1, "at least 1 highlight")
      .max(packetLimits.highlights, `up to ${packetLimits.highlights} highlights`),
  }),
  prs: z
    .array(PacketPrSchema)
    .min(1, "at least 1 PR")
    .max(packetLimits.prs, `up to ${packetLimits.prs} PRs`),
  reviewers: z
    .array(GithubLoginSchema)
    .min(1, "at least 1 reviewer")
    .max(packetLimits.reviewers, `up to ${packetLimits.reviewers} reviewers`),
});

export const PacketUpdateSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  operationId: OperationIdSchema,
  packet: PacketInputSchema.omit({ id: true }),
});

const GithubSnapshotSchema = z.looseObject({ id: z.union([z.string(), z.number()]), login: z.string() });

export const PacketSchema = z.looseObject({
  id: z.string(),
  authorId: z.string(),
  title: z.string(),
  overview: z.looseObject({ objective: z.string(), highlights: z.array(z.string()) }),
  prs: z.array(z.looseObject({ repo: z.string(), number: z.number() })),
  reviewers: z.array(z.looseObject({ id: z.string(), github: GithubSnapshotSchema })),
  status: z.enum(["open", "closed"]),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ReviewerSchema = z.looseObject({ id: z.string(), name: z.string(), github: GithubSnapshotSchema });

/** Create, read and replace answer `{packet}`; the client hands back the packet itself. */
export const PacketResponseSchema = z.looseObject({ packet: PacketSchema }).transform((response) => response.packet);

export const ReviewerListResponseSchema = z.looseObject({ reviewers: z.array(ReviewerSchema) });

export type PacketInput = z.input<typeof PacketInputSchema>;
export type PacketUpdateInput = z.input<typeof PacketUpdateSchema>;
export type Packet = z.infer<typeof PacketSchema>;
export type Reviewer = z.infer<typeof ReviewerSchema>;
export type ReviewerListResponse = z.infer<typeof ReviewerListResponseSchema>;
