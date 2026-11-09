import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  AttachmentSpecSchema,
  EvidenceUploadFailure,
  TechnicalDesignAttachmentUploader,
  TrackerEvidenceService,
} from "../tasks/evidence/evidence.js";
import { portableContextGuard } from "../tasks/portable-context/portable-context.js";
import {
  CreateEpicInputSchema,
  CreateInitiativeInputSchema,
  CommentSchema,
  CreateTechnicalDesignInputSchema,
  CreateTicketInputSchema,
  AttachmentSchema,
  EpicSchema,
  InitiativeSchema,
  TechnicalDesignSchema,
  TicketSchema,
  UpdateEpicInputSchema,
  UpdateInitiativeInputSchema,
  UpdateTechnicalDesignInputSchema,
  UpdateTicketInputSchema,
  type TaskTracker,
  TaskTrackerPartialWriteError,
} from "../tasks/task-tracker/task-tracker.js";
import type { OperationDescriptor, OperationHandlerResult } from "./operation-registry.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
  type OperationAccessPolicy,
  type OperationRegistry,
} from "./operation-registry.js";
import { DefaultTrackerReadOperations } from "./tracker-read-operations.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
import { DefaultTicketLifecycleOperations } from "./ticket-lifecycle-operations.js";

const labelListSchema = z
  .array(z.string())
  .transform((labels) => [...new Set(labels.map((label) => label.trim()).filter(Boolean))]);
const labelsSchema = labelListSchema.default([]);
const createEpicInput = z
  .object({
    ...CreateEpicInputSchema.shape,
    labels: labelsSchema,
    allowLocalPaths: z.boolean().default(false),
  })
  .strict();
const updateEpicInput = z
  .object({
    ...UpdateEpicInputSchema.shape,
    labels: labelListSchema.optional(),
    allowLocalPaths: z.boolean().default(false),
  })
  .strict();
const createInitiativeInput = CreateInitiativeInputSchema.extend({
  allowLocalPaths: z.boolean().default(false),
}).strict();
const updateInitiativeInput = UpdateInitiativeInputSchema.extend({
  allowLocalPaths: z.boolean().default(false),
}).strict();
const createTicketInput = z
  .object({
    ...CreateTicketInputSchema.shape,
    labels: labelsSchema,
    allowLocalPaths: z.boolean().default(false),
  })
  .strict();
const updateTicketInput = z
  .object({
    ...UpdateTicketInputSchema.shape,
    labels: labelListSchema.optional(),
    allowLocalPaths: z.boolean().default(false),
    attach: z.array(z.string().min(1)).default([]),
  })
  .strict();
const createTddInput = CreateTechnicalDesignInputSchema.extend({
  allowLocalPaths: z.boolean().default(false),
  attach: z.array(z.string().min(1)).default([]),
}).strict();
const updateTddInput = UpdateTechnicalDesignInputSchema.extend({
  allowLocalPaths: z.boolean().default(false),
  attach: z.array(z.string().min(1)).default([]),
}).strict();
const entityId = z.string().min(1);
const commentTddInput = z
  .object({ id: entityId, body: z.string(), allowLocalPaths: z.boolean().default(false) })
  .strict();
const linkInput = z.object({ epicId: entityId, initiativeId: entityId }).strict();
const partialTicketEdit = z.object({
  id: entityId,
  attachments: z.array(AttachmentSchema),
  body: z.string(),
});
const ticketEditResult = z.union([TicketSchema, partialTicketEdit]);
const partialTicketCreate = z.object({ id: entityId, title: z.string() });
const ticketCreateResult = z.union([TicketSchema, partialTicketCreate]);
const partialEntityWrite = z.object({
  id: entityId,
  title: z.string().optional(),
  body: z.string().optional(),
});
const partialTddCreate = z.object({ id: entityId, epicId: entityId, body: z.string() });

const propsSchema = z.object({
  getTracker: z.custom<() => TaskTracker>((value) => typeof value === "function"),
  getPrHost: z.custom<() => PullRequestHost>((value) => typeof value === "function").optional(),
  getConfig: z
    .custom<() => Pick<Config, "inReviewStatus">>((value) => typeof value === "function")
    .optional(),
  cwd: z.string().min(1),
  trustedRoots: z.array(z.string().min(1)).default([]),
});

export interface TrackerEntityOperations {
  operations(): OperationDescriptor[];
  registry(policy?: OperationAccessPolicy): OperationRegistry;
}

/** Shares guarded tracker entity writes across CLI, MCP, and SDK callers. */
export class DefaultTrackerEntityOperations implements TrackerEntityOperations {
  private readonly props: z.infer<typeof propsSchema>;
  private readonly roots: string[];

  constructor(props: z.input<typeof propsSchema>) {
    this.props = propsSchema.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync(root)))];
  }

  operations(): OperationDescriptor[] {
    return [
      ...new DefaultTrackerReadOperations({
        getTracker: this.props.getTracker,
        ...(this.props.getPrHost === undefined ? {} : { getPrHost: this.props.getPrHost }),
        ...(this.props.getConfig === undefined ? {} : { getConfig: this.props.getConfig }),
      }).operations(),
      ...new DefaultTicketLifecycleOperations({
        getTracker: this.props.getTracker,
        cwd: this.props.cwd,
        trustedRoots: this.props.trustedRoots,
      }).operations(),
      this.descriptor(
        "epic-create",
        "Create an epic with portable context and labels.",
        ["write", "network"],
        ["epic", "create"],
        createEpicInput,
        z.union([EpicSchema, partialEntityWrite]),
        (input) => this.createEpic(input),
      ),
      this.descriptor(
        "epic-edit",
        "Update an epic description, title, or labels.",
        ["write", "network"],
        ["epic", "edit"],
        z.object({ id: entityId, ...updateEpicInput.shape }).strict(),
        z.union([EpicSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editEpic(id, input),
      ),
      this.descriptor(
        "epic-link-initiative",
        "Link an epic to an initiative.",
        ["write", "network"],
        ["epic", "link-initiative"],
        linkInput,
        z.object({ epicId: entityId, initiativeId: entityId }),
        async ({ epicId, initiativeId }) => {
          await this.props.getTracker().linkEpicToInitiative(epicId, initiativeId);
          return { epicId, initiativeId };
        },
      ),
      this.descriptor(
        "initiative-create",
        "Create an initiative with portable context.",
        ["write", "network"],
        ["initiative", "create"],
        createInitiativeInput,
        z.union([InitiativeSchema, partialEntityWrite]),
        (input) => this.createInitiative(input),
      ),
      this.descriptor(
        "initiative-edit",
        "Update an initiative description or title.",
        ["write", "network"],
        ["initiative", "edit"],
        z.object({ id: entityId, ...updateInitiativeInput.shape }).strict(),
        z.union([InitiativeSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editInitiative(id, input),
      ),
      this.descriptor(
        "ticket-create",
        "Create a ticket with its parent, labels, and assignee.",
        ["write", "network"],
        ["ticket", "create"],
        createTicketInput,
        ticketCreateResult,
        (input) => this.createTicket(input),
      ),
      this.descriptor(
        "ticket-edit",
        "Update a ticket and attach local evidence files.",
        ["write", "network"],
        ["ticket", "edit"],
        z.object({ id: entityId, ...updateTicketInput.shape }).strict(),
        ticketEditResult,
        ({ id, ...input }) => this.editTicket(id, input),
      ),
      this.descriptor(
        "tdd-create",
        "Create a technical design under its parent epic.",
        ["write", "network"],
        ["tdd", "create"],
        createTddInput,
        z.union([TechnicalDesignSchema, partialTddCreate]),
        (input) => this.createTdd(input),
      ),
      this.descriptor(
        "tdd-comment",
        "Post a comment on a technical design.",
        ["write", "network"],
        ["tdd", "comment"],
        commentTddInput,
        CommentSchema,
        (input) => this.commentOnTdd(input),
      ),
      this.descriptor(
        "tdd-edit",
        "Update a technical design's title and/or body.",
        ["write", "network"],
        ["tdd", "edit"],
        z.object({ id: entityId, ...updateTddInput.shape }).strict(),
        z.union([TechnicalDesignSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editTdd(id, input),
      ),
    ];
  }

  registry(policy?: OperationAccessPolicy): OperationRegistry {
    return new MapOperationRegistry({
      operations: this.operations(),
      policy:
        policy ??
        new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network", "process"] }),
    });
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

  private async createEpic(input: z.infer<typeof createEpicInput>) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateEpicInputSchema.parse(input);
    try {
      return await this.props.getTracker().createEpic(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial" as const,
        data: { id: error.id, title: fields.title, body: fields.body },
        error: { name: error.name, message: error.message },
      };
    }
  }

  private async editEpic(id: string, input: z.infer<typeof updateEpicInput>) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = UpdateEpicInputSchema.parse(input);
    try {
      return await this.props.getTracker().updateEpicDescription(id, fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial" as const,
        data: {
          id,
          ...(fields.title === undefined ? {} : { title: fields.title }),
          body: fields.body,
        },
        error: { name: error.name, message: error.message },
      };
    }
  }

  private async createInitiative(input: z.infer<typeof createInitiativeInput>) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateInitiativeInputSchema.parse(input);
    try {
      return await this.props.getTracker().createInitiative(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial" as const,
        data: { id: error.id, title: fields.title, body: fields.body },
        error: { name: error.name, message: error.message },
      };
    }
  }

  private async editInitiative(id: string, input: z.infer<typeof updateInitiativeInput>) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = UpdateInitiativeInputSchema.parse(input);
    try {
      return await this.props.getTracker().updateInitiativeDescription(id, fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial" as const,
        data: {
          id,
          ...(fields.title === undefined ? {} : { title: fields.title }),
          body: fields.body,
        },
        error: { name: error.name, message: error.message },
      };
    }
  }

  private async createTicket(input: z.infer<typeof createTicketInput>) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateTicketInputSchema.parse(input);
    try {
      return await this.props.getTracker().createTicket(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial" as const,
        data: { id: error.id, title: fields.title },
        error: { name: error.name, message: error.message },
      };
    }
  }

  private async editTicket(id: string, input: z.infer<typeof updateTicketInput>) {
    const specs = input.attach;
    const safeSpecs = specs.map((spec) => {
      const parsed = AttachmentSpecSchema.parse(spec);
      return `${this.trustedFilePath(parsed.path)}#${parsed.caption}`;
    });
    const tracker = this.props.getTracker();
    const evidence = new TrackerEvidenceService({ tracker });
    let body = input.body;
    let attachments: Awaited<ReturnType<TrackerEvidenceService["attach"]>>["attachments"] = [];
    if (safeSpecs.length > 0) {
      body = evidence.prepareBody({ body, specs: safeSpecs });
      this.assertPortable(body, input.allowLocalPaths);
      try {
        const result = await evidence.attach({
          ticketId: id,
          body: input.body,
          specs: safeSpecs,
        });
        body = result.body;
        attachments = result.attachments;
      } catch (error) {
        if (!(error instanceof EvidenceUploadFailure) || error.attachments.length === 0) {
          if (error instanceof EvidenceUploadFailure) throw error.cause;
          throw error;
        }
        return {
          status: "partial" as const,
          data: { id, attachments: error.attachments, body: input.body },
          error: {
            name: error.cause instanceof Error ? error.cause.name : "Error",
            message: error.cause instanceof Error ? error.cause.message : String(error.cause),
          },
        };
      }
    } else {
      this.assertPortable(body, input.allowLocalPaths);
    }
    try {
      const fields = UpdateTicketInputSchema.parse(input);
      return await tracker.updateTicketDescription(id, { ...fields, body });
    } catch (error) {
      if (attachments.length === 0 && !TaskTrackerPartialWriteError.isPartialWrite(error))
        throw error;
      return {
        status: "partial" as const,
        data: { id, attachments, body },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async createTdd(input: z.infer<typeof createTddInput>) {
    const { allowLocalPaths, attach, ...rest } = input;
    const fields = CreateTechnicalDesignInputSchema.parse(rest);
    const tracker = this.props.getTracker();
    if (attach.length === 0) {
      this.assertPortable(fields.body, allowLocalPaths);
      try {
        return await tracker.createTechnicalDesign(fields);
      } catch (error) {
        return this.partialTddCreate(error, fields);
      }
    }

    tracker.assertTechnicalDesignAttachments();
    const specs = this.trustedSpecs(attach);
    const evidence = new TrackerEvidenceService({
      tracker: new TechnicalDesignAttachmentUploader({ tracker }),
    });
    const prepared = evidence.prepareBody({ body: fields.body, specs });
    this.assertPortable(prepared, allowLocalPaths);

    let id: string | undefined;
    try {
      const created = await tracker.createTechnicalDesign({ ...fields, body: prepared });
      id = created.id;
      const uploaded = await evidence.attach({ ticketId: id, body: fields.body, specs });
      return await tracker.updateTechnicalDesign(id, { body: uploaded.body });
    } catch (error) {
      const cause = error instanceof EvidenceUploadFailure ? error.cause : error;
      if (id === undefined) return this.partialTddCreate(cause, fields);
      return {
        status: "partial" as const,
        data: { id, epicId: fields.epicId, body: fields.body },
        error: {
          name: cause instanceof Error ? cause.name : "Error",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  private partialTddCreate(error: unknown, fields: { epicId: string; body: string }) {
    if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
    return {
      status: "partial" as const,
      data: { id: error.id, epicId: fields.epicId, body: fields.body },
      error: { name: error.name, message: error.message },
    };
  }

  private trustedSpecs(attach: readonly string[]): string[] {
    return attach.map((spec) => {
      const parsed = AttachmentSpecSchema.parse(spec);
      return `${this.trustedFilePath(parsed.path)}#${parsed.caption}`;
    });
  }

  private async commentOnTdd(input: z.infer<typeof commentTddInput>) {
    this.assertPortable(input.body, input.allowLocalPaths);
    return this.props.getTracker().addTechnicalDesignComment(input.id, input.body);
  }

  private async editTdd(id: string, input: z.infer<typeof updateTddInput>) {
    const { allowLocalPaths, attach, ...rest } = input;
    if (rest.body === undefined && rest.title === undefined) {
      throw new Error("tdd edit needs a new title, a new body, or both");
    }
    if (attach.length > 0 && rest.body === undefined) {
      throw new Error("tdd edit --attach needs a new body to reference the attached files");
    }
    let fields = UpdateTechnicalDesignInputSchema.parse(rest);
    const tracker = this.props.getTracker();
    if (fields.body === undefined) {
      return this.updateTdd(id, fields);
    }
    if (attach.length === 0) {
      this.assertPortable(fields.body, allowLocalPaths);
      return this.updateTdd(id, fields);
    }

    tracker.assertTechnicalDesignAttachments();
    const specs = this.trustedSpecs(attach);
    const evidence = new TrackerEvidenceService({
      tracker: new TechnicalDesignAttachmentUploader({ tracker }),
    });
    this.assertPortable(evidence.prepareBody({ body: fields.body, specs }), allowLocalPaths);
    try {
      const uploaded = await evidence.attach({ ticketId: id, body: fields.body, specs });
      fields = { ...fields, body: uploaded.body };
    } catch (error) {
      if (!(error instanceof EvidenceUploadFailure)) throw error;
      if (error.attachments.length === 0) throw error.cause;
      return this.partialTddEdit(id, fields, error.cause);
    }
    return this.updateTdd(id, fields);
  }

  private async updateTdd(id: string, fields: z.infer<typeof UpdateTechnicalDesignInputSchema>) {
    try {
      return await this.props.getTracker().updateTechnicalDesign(id, fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return this.partialTddEdit(id, fields, error);
    }
  }

  private partialTddEdit(
    id: string,
    fields: z.infer<typeof UpdateTechnicalDesignInputSchema>,
    cause: unknown,
  ) {
    return {
      status: "partial" as const,
      data: {
        id,
        ...(fields.title === undefined ? {} : { title: fields.title }),
        ...(fields.body === undefined ? {} : { body: fields.body }),
      },
      error: {
        name: cause instanceof Error ? cause.name : "Error",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }

  private assertPortable(body: string, allowLocalPaths = false): void {
    portableContextGuard.assertPortable(body, { allowLocalPaths });
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
