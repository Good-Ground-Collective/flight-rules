import { z } from "zod";
import type { AriadneBoard, BoardOutcome } from "../shared/ariadne/ariadne-board.js";
import type { AriadnePackets } from "../shared/ariadne/ariadne-packets.js";
import { packetIdGenerator } from "../shared/ariadne/packet-id-generator.js";
import {
  ActivityInputSchema,
  ActivityResponseSchema,
  HeartbeatInputSchema,
  HeartbeatResponseSchema,
  ItemInputSchema,
  ItemListResponseSchema,
  ItemResponseSchema,
} from "../shared/ariadne/ariadne.schema.js";
import {
  PacketSchema,
  ReviewerListResponseSchema,
} from "../shared/ariadne/review-packet.schema.js";
import type { OperationDescriptor } from "./operation-registry.js";
import type { OperationEffect } from "./operation.schema.js";

const BoardResultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("skipped"),
      reason: z.enum([
        "disabled",
        "no-token",
        "invalid-url",
        "not-jira-ticket",
        "nothing-recorded",
      ]),
      notices: z.array(z.string()).optional(),
    }),
    z.object({
      status: z.literal("failed"),
      message: z.string(),
      notices: z.array(z.string()).optional(),
    }),
    z.object({ status: z.literal("ok"), value, notices: z.array(z.string()).optional() }),
  ]);

const packetInput = z.unknown();
const packetIdInput = z.strictObject({ title: z.string() });
const packetUpdateInput = z.strictObject({
  id: z.string().min(1),
  packet: z.unknown(),
  expectedRevision: z.number().int().nonnegative(),
});
const packetOutput = PacketSchema;
const reviewersOutput = ReviewerListResponseSchema;
const AriadneOperationsPropsSchema = z.object({
  getBoard: z.custom<() => AriadneBoard>((value) => typeof value === "function"),
  getPackets: z.custom<() => AriadnePackets>((value) => typeof value === "function"),
});

const inputSchemas = {
  heartbeat: z.object({
    input: HeartbeatInputSchema.omit({ session: true }).extend({
      session: z.string().optional(),
      ticket: z.string().optional(),
      step: z.string(),
      repo: z.string().optional(),
      branch: z.string().optional(),
      skill: z.string().optional(),
      detail: z.string().optional(),
    }),
    options: z.object({ strict: z.boolean().optional(), skill: z.string().optional() }).optional(),
  }),
  item: z.object({
    input: ItemInputSchema.omit({ session: true }).extend({
      session: z.string().optional(),
      ticket: z.string().optional(),
      title: z.string(),
      detail: z.string().optional(),
      options: z.array(z.string()).optional(),
      id: z.string().optional(),
    }),
    options: z.object({ strict: z.boolean().optional(), skill: z.string().optional() }).optional(),
  }),
  activity: z.object({
    input: ActivityInputSchema.omit({ session: true }).extend({
      session: z.string().optional(),
      ticket: z.string().optional(),
      text: z.string(),
      id: z.string().optional(),
    }),
    options: z.object({ strict: z.boolean().optional(), skill: z.string().optional() }).optional(),
  }),
  items: z.strictObject({
    session: z.string().optional(),
    ticket: z.string().optional(),
    strict: z.boolean().optional(),
  }),
} as const;

export interface AriadneOperations {
  operations(): OperationDescriptor[];
}

/** Shares Ariadne board and packet behavior across CLI and programmatic callers. */
export class DefaultAriadneOperations implements AriadneOperations {
  private readonly props: {
    getBoard: () => AriadneBoard;
    getPackets: () => AriadnePackets;
  };

  constructor(props: z.input<typeof AriadneOperationsPropsSchema>) {
    this.props = AriadneOperationsPropsSchema.parse(props);
  }

  operations(): OperationDescriptor[] {
    return [
      this.descriptor(
        "board-post-heartbeat",
        "Report a run heartbeat to Ariadne.",
        ["write", "network"],
        ["board", "post", "heartbeat"],
        inputSchemas.heartbeat,
        BoardResultSchema(HeartbeatResponseSchema),
        ({ input, options }) =>
          this.mapBoard(this.props.getBoard().heartbeat(input, this.boardOptions(options))),
      ),
      this.descriptor(
        "board-post-item",
        "Post a question or request to an Ariadne run.",
        ["write", "network"],
        ["board", "post", "item"],
        inputSchemas.item,
        BoardResultSchema(ItemResponseSchema),
        ({ input, options }) =>
          this.mapBoard(
            this.props.getBoard().item(input, {
              ...this.boardOptions(options),
              bootstrapMissingSession: false,
            }),
          ),
      ),
      this.descriptor(
        "board-post-activity",
        "Add activity to an Ariadne run.",
        ["write", "network"],
        ["board", "post", "activity"],
        inputSchemas.activity,
        BoardResultSchema(ActivityResponseSchema),
        ({ input, options }) =>
          this.mapBoard(
            this.props.getBoard().activity(input, {
              ...this.boardOptions(options),
              bootstrapMissingSession: false,
            }),
          ),
      ),
      this.descriptor(
        "board-items",
        "List items for an Ariadne run.",
        ["read", "network"],
        ["board", "items"],
        inputSchemas.items,
        BoardResultSchema(ItemListResponseSchema),
        ({ session, ticket, strict }) =>
          this.mapBoard(
            this.props.getBoard().items(session, strict === undefined ? {} : { strict }, ticket),
          ),
      ),
      this.descriptor(
        "packet-create",
        "Publish a validated Ariadne review packet.",
        ["write", "network"],
        ["packet", "create"],
        z.strictObject({ packet: packetInput }),
        packetOutput,
        ({ packet }) => this.props.getPackets().create(packet),
      ),
      this.descriptor(
        "packet-new-id",
        "Generate a reusable Ariadne review packet id.",
        [],
        ["packet", "new-id"],
        packetIdInput,
        z.object({ id: z.string() }),
        ({ title }) => ({ id: packetIdGenerator.generate(title) }),
      ),
      this.descriptor(
        "packet-update",
        "Replace a review packet at its expected revision.",
        ["write", "network"],
        ["packet", "update"],
        packetUpdateInput,
        packetOutput,
        ({ id, packet, expectedRevision }) =>
          this.props.getPackets().update(id, { packet, expectedRevision }),
      ),
      this.descriptor(
        "packet-get",
        "Read an Ariadne review packet and its revision.",
        ["read", "network"],
        ["packet", "get"],
        z.object({ id: z.string().min(1) }),
        packetOutput,
        ({ id }) => this.props.getPackets().get(id),
      ),
      this.descriptor(
        "packet-reviewers",
        "List Ariadne members who can review packets.",
        ["read", "network"],
        ["packet", "reviewers"],
        z.strictObject({}),
        reviewersOutput,
        () => this.props.getPackets().reviewers(),
      ),
    ];
  }

  private boardOptions(
    options: { strict?: boolean | undefined; skill?: string | undefined } | undefined,
  ): { strict?: boolean; skill?: string } {
    return {
      ...(options?.strict === undefined ? {} : { strict: options.strict }),
      ...(options?.skill === undefined ? {} : { skill: options.skill }),
    };
  }

  private async mapBoard<T>(outcome: Promise<BoardOutcome<T>>): Promise<unknown> {
    const result = await outcome;
    if (result.status === "posted") return { ...result, status: "ok" };
    return result;
  }

  private descriptor<TInput, TOutput>(
    id: string,
    description: string,
    effects: OperationEffect[],
    path: string[],
    inputSchema: z.ZodType<TInput>,
    outputSchema: z.ZodType<TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): OperationDescriptor<TInput, TOutput> {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler,
    };
  }
}
