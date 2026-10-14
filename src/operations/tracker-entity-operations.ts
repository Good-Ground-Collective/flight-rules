import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  AttachmentSpecSchema,
  EvidenceUploadFailure,
  TrackerEvidenceService,
} from "../tasks/evidence/evidence.js";
import { portableContextGuard } from "../tasks/portable-context/portable-context.js";
import {
  CreateEpicInputSchema,
  CreateInitiativeInputSchema,
  CreateTechnicalDesignInputSchema,
  CreateTicketInputSchema,
  AttachmentSchema,
  EpicSchema,
  InitiativeSchema,
  TechnicalDesignSchema,
  TicketSchema,
  UpdateEpicInputSchema,
  UpdateInitiativeInputSchema,
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
}).strict();
const entityId = z.string().min(1);
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
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateTechnicalDesignInputSchema.parse(input);
    try {
      return await this.props.getTracker().createTechnicalDesign(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial" as const,
        data: { id: error.id, epicId: fields.epicId, body: fields.body },
        error: { name: error.name, message: error.message },
      };
    }
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
