import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  EpicBoundaryGuard,
  type EpicBoundaryTracker,
} from "../tasks/epic-boundary/epic-boundary.js";
import {
  AttachmentSpecSchema,
  EvidenceUploadFailure,
  TrackerEvidenceService,
  type EvidenceAttachment,
} from "../tasks/evidence/evidence.js";
import {
  AttachmentSchema,
  CommentSchema,
  type Comment,
  type TaskTracker,
} from "../tasks/task-tracker/task-tracker.js";
import type { OperationDescriptor, OperationHandlerResult } from "./operation-registry.js";

const propsSchema = z.object({
  getTracker: z.custom<() => TaskTracker>((value) => typeof value === "function"),
  cwd: z.string().min(1),
  trustedRoots: z.array(z.string().min(1)).default([]),
});
const idSchema = z.string().min(1);
const blockInput = z
  .object({ ticketId: idSchema, blockerId: idSchema, reason: z.string().optional() })
  .strict();
const ticketPairInput = z.object({ ticketId: idSchema, blockerId: idSchema }).strict();
const statusInput = z.object({ id: idSchema, status: z.string().min(1) }).strict();
const commentInput = z
  .object({
    id: idSchema,
    body: z.string(),
    attach: z.array(z.string().min(1)).default([]),
  })
  .strict();
const labelInput = z
  .object({
    id: idSchema,
    add: z.array(z.string()).default([]),
    remove: z.array(z.string()).default([]),
  })
  .strict()
  .refine((input) => input.add.length > 0 || input.remove.length > 0, {
    message: "ticket label needs at least one --add or --remove",
  });

const blockResult = z.object({
  ticketId: idSchema,
  blockerId: idSchema,
  ticketEpic: idSchema.nullable(),
  blockerEpic: idSchema.nullable(),
  crossEpic: z.boolean(),
  reasonRecorded: z.boolean(),
  warnings: z.array(z.string()),
});
const blockPartial = z.object({
  ticketId: idSchema,
  blockerId: idSchema,
  completedSteps: z.array(z.string()),
});
const ticketPairResult = z.object({ ticketId: idSchema, blockerId: idSchema });
const statusResult = z.object({ id: idSchema, status: z.string() });
const commentPartial = z.object({
  id: idSchema,
  attachments: z.array(
    AttachmentSchema.extend({ path: z.string(), caption: z.string(), referenced: z.boolean() }),
  ),
  body: z.string(),
  completedSteps: z.array(z.string()),
});
const commentResult = z.union([CommentSchema, commentPartial]);
const labelResult = z.object({
  id: idSchema,
  added: z.array(z.string()),
  removed: z.array(z.string()),
});
const labelPartial = z.object({
  id: idSchema,
  added: z.array(z.string()),
  removed: z.array(z.string()),
  requestedAdd: z.array(z.string()),
  requestedRemove: z.array(z.string()),
  completedSteps: z.array(z.string()),
});

export interface TicketLifecycleOperations {
  operations(): OperationDescriptor[];
}

/** Shares guarded ticket lifecycle changes across Commander and programmatic hosts. */
export class DefaultTicketLifecycleOperations implements TicketLifecycleOperations {
  private readonly props: z.infer<typeof propsSchema>;
  private readonly roots: string[];

  constructor(props: z.input<typeof propsSchema>) {
    this.props = propsSchema.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync(root)))];
  }

  operations(): OperationDescriptor[] {
    return [
      this.descriptor(
        "ticket-block",
        "Block a ticket with an epic-boundary justification when needed.",
        ["write", "network"],
        ["ticket", "block"],
        blockInput,
        z.union([blockResult, blockPartial]),
        (input) => this.block(input),
      ),
      this.descriptor(
        "ticket-unblock",
        "Remove a blocked-by relationship from a ticket.",
        ["write", "network"],
        ["ticket", "unblock"],
        ticketPairInput,
        ticketPairResult,
        (input) => this.unblock(input),
      ),
      this.descriptor(
        "ticket-status",
        "Transition a ticket to a supported tracker status.",
        ["write", "network"],
        ["ticket", "status"],
        statusInput,
        statusResult,
        (input) => this.transition(input),
      ),
      this.descriptor(
        "ticket-comment",
        "Add a ticket comment with trusted evidence attachments.",
        ["write", "network"],
        ["ticket", "comment"],
        commentInput,
        commentResult,
        (input) => this.comment(input),
      ),
      this.descriptor(
        "ticket-label",
        "Remove and add ticket labels in safe order.",
        ["write", "network"],
        ["ticket", "label"],
        labelInput,
        z.union([labelPartial, labelResult]),
        (input) => this.updateLabels(input),
      ),
    ];
  }

  private descriptor<TInput, TOutput>(
    id: string,
    description: string,
    effects: ("write" | "network")[],
    path: string[],
    inputSchema: z.ZodType<TInput>,
    outputSchema: z.ZodType<TOutput>,
    handler: (
      input: TInput,
    ) => OperationHandlerResult<TOutput> | Promise<OperationHandlerResult<TOutput>>,
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

  private async block(input: z.infer<typeof blockInput>) {
    const completedSteps: string[] = [];
    const tracker = this.props.getTracker();
    const observed: EpicBoundaryTracker = {
      getTicketEpicId: (ticketId) => tracker.getTicketEpicId(ticketId),
      blockTicket: async (ticketId, blockerId) => {
        await tracker.blockTicket(ticketId, blockerId);
        completedSteps.push("blocked-by-linked");
      },
      getTicket: (ticketId) => tracker.getTicket(ticketId),
      addComment: async (ticketId, body) => {
        const result = await tracker.addComment(ticketId, body);
        completedSteps.push("reason-commented");
        return result;
      },
      updateTicketMetadata: async (ticketId, patch) => {
        await tracker.updateTicketMetadata(ticketId, patch);
        completedSteps.push("reason-recorded");
      },
    };

    try {
      const outcome = await new EpicBoundaryGuard(observed).block(input);
      return {
        ticketId: input.ticketId,
        blockerId: input.blockerId,
        ...outcome,
      };
    } catch (error) {
      if (completedSteps.length === 0) throw error;
      return {
        status: "partial" as const,
        data: {
          ticketId: input.ticketId,
          blockerId: input.blockerId,
          completedSteps,
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async unblock(input: z.infer<typeof ticketPairInput>) {
    await this.props.getTracker().unblockTicket(input.ticketId, input.blockerId);
    return input;
  }

  private async transition(input: z.infer<typeof statusInput>) {
    await this.props.getTracker().transitionTicket(input.id, input.status);
    return input;
  }

  private async comment(
    input: z.infer<typeof commentInput>,
  ): Promise<OperationHandlerResult<Comment | z.infer<typeof commentPartial>>> {
    const tracker = this.props.getTracker();
    const safeSpecs = input.attach.map((spec) => {
      const parsed = AttachmentSpecSchema.parse(spec);
      return `${this.trustedFilePath(parsed.path)}#${parsed.caption}`;
    });
    const evidence = new TrackerEvidenceService({ tracker });
    let body = input.body;
    let attachments: EvidenceAttachment[] = [];

    if (safeSpecs.length > 0) {
      try {
        const attached = await evidence.attach({ ticketId: input.id, body, specs: safeSpecs });
        body = attached.body;
        attachments = attached.attachments;
      } catch (error) {
        if (!(error instanceof EvidenceUploadFailure) || error.attachments.length === 0)
          throw error;
        const rewritten = evidence.prepareBody({
          body,
          specs: error.attachments.map((attachment) => `${attachment.path}#${attachment.caption}`),
        });
        return {
          status: "partial",
          data: {
            id: input.id,
            attachments: error.attachments,
            body: rewritten,
            completedSteps: error.attachments.map(
              (attachment) => `attachment-uploaded:${attachment.id}`,
            ),
          },
          error: {
            name: error.cause instanceof Error ? error.cause.name : "Error",
            message: error.cause instanceof Error ? error.cause.message : String(error.cause),
          },
        };
      }
    }

    try {
      return await tracker.addComment(input.id, body);
    } catch (error) {
      if (attachments.length === 0) throw error;
      return {
        status: "partial",
        data: {
          id: input.id,
          attachments,
          body,
          completedSteps: [
            "attachments-uploaded",
            ...attachments.map((attachment) => `attachment-uploaded:${attachment.id}`),
          ],
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async updateLabels(
    input: z.infer<typeof labelInput>,
  ): Promise<OperationHandlerResult<z.infer<typeof labelResult> | z.infer<typeof labelPartial>>> {
    const tracker = this.props.getTracker();
    const completedSteps: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    try {
      for (const label of input.remove) {
        await tracker.removeLabel(input.id, label);
        removed.push(label);
        completedSteps.push(`removed:${label}`);
      }
      for (const label of input.add) {
        await tracker.addLabel(input.id, label);
        added.push(label);
        completedSteps.push(`added:${label}`);
      }
      return { id: input.id, added: input.add, removed: input.remove };
    } catch (error) {
      if (completedSteps.length === 0) throw error;
      return {
        status: "partial",
        data: {
          id: input.id,
          added,
          removed,
          requestedAdd: input.add,
          requestedRemove: input.remove,
          completedSteps,
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private trustedFilePath(path: string): string {
    const absolute = isAbsolute(path) ? path : resolve(this.props.cwd, path);
    if (!existsSync(absolute)) throw new Error(`Attachment file does not exist: ${path}`);
    const realPath = realpathSync(absolute);
    const stat = statSync(realPath);
    const contained = this.roots.some((root) => {
      const fromRoot = relative(root, realPath);
      return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
    });
    if (!contained || !stat.isFile())
      throw new Error(`Attachment file is outside trusted roots: ${path}`);
    return realPath;
  }
}
