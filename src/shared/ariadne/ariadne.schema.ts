import { z } from "zod";

/**
 * The production Ariadne API; the `ariadne.url` config key overrides it.
 * Shapes in this file follow Ariadne's Agents API, contract version 1
 * (think-lp/ariadne docs/agents-api.md).
 */
export const defaultAriadneUrl = "https://ariadne-api-xohlbba2ea-uc.a.run.app";

export const agentStates = ["nominal", "caution", "abort", "hold"] as const;
export const agentItemKinds = ["question", "blocker", "testable", "wave-gate"] as const;
export const agentActivityLevels = ["info", "success", "caution", "abort"] as const;

export type AgentState = (typeof agentStates)[number];
export type AgentItemKind = (typeof agentItemKinds)[number];
export type AgentActivityLevel = (typeof agentActivityLevels)[number];

export const agentLimits = {
  step: 60,
  heartbeatDetail: 500,
  title: 200,
  itemDetail: 2000,
  option: 60,
  options: 6,
  text: 500,
  branch: 255,
} as const;

/** Tidies agent-written text to what the API accepts, instead of failing a report over a long title. */
class AgentTextNormalizer {
  /** Whitespace runs collapse to a space and control characters go. */
  oneLine(value: string, max: number): string {
    // eslint-disable-next-line no-control-regex -- the API rejects control characters, so they are removed here
    return this.cut(value.replace(/[\x00-\x08\x0e-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim(), max);
  }

  /** Line feeds stay; tabs become spaces and other control characters go. */
  multiLine(value: string, max: number): string {
    const normalized = value
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      // eslint-disable-next-line no-control-regex -- the API rejects control characters other than line feeds
      .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "")
      .trim();
    return this.cut(normalized, max);
  }

  /** Overlong text ends in an ellipsis, never in half a surrogate pair. */
  private cut(value: string, max: number): string {
    if (value.length <= max) return value;
    const head = value.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "");
    return `${head.trimEnd()}…`;
  }
}

const normalizer = new AgentTextNormalizer();

const oneLineSchema = (max: number) =>
  z
    .string()
    .transform((value) => normalizer.oneLine(value, max))
    .pipe(z.string().min(1, "must not be blank"));

const multiLineSchema = (max: number) =>
  z
    .string()
    .transform((value) => normalizer.multiLine(value, max))
    .pipe(z.string().min(1, "must not be blank"));

/** Optional fields may be omitted, null or "". */
const optionalSchema = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());

export const AgentSessionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/, "must be 1–80 letters, digits, underscores or hyphens");

/** A record's own id (`--id`), the same alphabet as a session id. */
export const AgentRecordIdSchema = AgentSessionIdSchema;

export const TicketKeySchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$/, "must be a Jira issue key: project key, hyphen, number"));

const RepoSchema = z
  .string()
  .regex(/^(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/)?[A-Za-z0-9_.-]{1,100}$/, "must be owner/name or name")
  .refine((value) => !value.includes(".."), "must not contain ..");

const BranchSchema = z
  .string()
  .regex(/^[A-Za-z0-9_+@][A-Za-z0-9._/+@-]{0,254}$/, "must be a branch name as git prints it")
  .refine((value) => !value.includes(".."), "must not contain ..");

const SkillSchema = z.string().regex(/^[A-Za-z0-9:._-]{1,80}$/, "must be up to 80 of A-Z a-z 0-9 : . _ -");

/**
 * Request schemas are strict, so a payload can only ever carry these fields:
 * keys, titles and short status lines, never source code, diffs or ticket bodies.
 */
export const HeartbeatInputSchema = z.strictObject({
  session: AgentSessionIdSchema,
  step: oneLineSchema(agentLimits.step),
  state: z.enum(agentStates),
  ticket: optionalSchema(TicketKeySchema),
  repo: optionalSchema(RepoSchema),
  branch: optionalSchema(BranchSchema),
  skill: optionalSchema(SkillSchema),
  detail: optionalSchema(oneLineSchema(agentLimits.heartbeatDetail)),
});

export const ItemInputSchema = z.strictObject({
  session: AgentSessionIdSchema,
  kind: z.enum(agentItemKinds),
  title: oneLineSchema(agentLimits.title),
  ticket: optionalSchema(TicketKeySchema),
  detail: optionalSchema(multiLineSchema(agentLimits.itemDetail)),
  options: z
    .array(oneLineSchema(agentLimits.option))
    .max(agentLimits.options, `up to ${agentLimits.options} options`)
    .refine((labels) => new Set(labels).size === labels.length, "options must be distinct")
    .optional(),
  id: optionalSchema(AgentRecordIdSchema),
});

export const ActivityInputSchema = z.strictObject({
  session: AgentSessionIdSchema,
  text: oneLineSchema(agentLimits.text),
  level: optionalSchema(z.enum(agentActivityLevels)),
  ticket: optionalSchema(TicketKeySchema),
  id: optionalSchema(AgentRecordIdSchema),
});

/** POST /v1/agents/heartbeat. Text fields are tidied to one line and cut to their limits. */
export interface HeartbeatInput {
  session: string;
  /** One line up to 60 characters: implement, verify 2/3, pr, qa. */
  step: string;
  state: AgentState;
  /** A Jira issue key; stored upper case. */
  ticket?: string | undefined;
  /** owner/name or name. */
  repo?: string | undefined;
  branch?: string | undefined;
  skill?: string | undefined;
  /** One line up to 500 characters. */
  detail?: string | undefined;
}

/** POST /v1/agents/items. */
export interface ItemInput {
  session: string;
  kind: AgentItemKind;
  /** One line up to 200 characters. */
  title: string;
  ticket?: string | undefined;
  /** Up to 2,000 characters; line breaks allowed. */
  detail?: string | undefined;
  /** Up to six distinct one-line labels of up to 60 characters. */
  options?: string[] | undefined;
  /** Client id; the first write for a session and id wins, and a repost returns the stored item. */
  id?: string | undefined;
}

/** POST /v1/agents/activity. */
export interface ActivityInput {
  session: string;
  /** One line up to 500 characters. */
  text: string;
  level?: AgentActivityLevel | undefined;
  ticket?: string | undefined;
  id?: string | undefined;
}

/** Response records are loose: a later contract may add fields without breaking this client. */
export const AgentSessionSchema = z.looseObject({
  id: z.string(),
  ownerId: z.string(),
  ticket: z.string().nullable(),
  step: z.string(),
  state: z.string(),
  lastHeartbeat: z.string(),
  running: z.boolean(),
});

export const AgentItemSchema = z.looseObject({
  id: z.string(),
  session: z.string(),
  kind: z.string(),
  ticket: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  options: z.array(z.string()),
  status: z.string(),
  chosenOption: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});

export const AgentActivitySchema = z.looseObject({
  id: z.string(),
  at: z.string(),
  session: z.string(),
  ticket: z.string().nullable(),
  level: z.string(),
  text: z.string(),
});

export const HeartbeatResponseSchema = z.looseObject({ session: AgentSessionSchema });
export const ItemResponseSchema = z.looseObject({ item: AgentItemSchema, created: z.boolean() });
export const ActivityResponseSchema = z.looseObject({ activity: AgentActivitySchema, created: z.boolean() });
export const ItemListResponseSchema = z.looseObject({ items: z.array(AgentItemSchema) });

/** Every error but 401 is `{error, message}`; 401 is `{error: "unauthorized"}`. */
export const AgentErrorBodySchema = z.looseObject({ error: z.string(), message: z.string().optional() });

export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentItem = z.infer<typeof AgentItemSchema>;
export type AgentActivity = z.infer<typeof AgentActivitySchema>;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
export type ItemResponse = z.infer<typeof ItemResponseSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;
