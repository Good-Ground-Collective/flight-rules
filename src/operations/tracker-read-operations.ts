import { z } from "zod";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
import { CrossEpicEdgeFinder } from "../tasks/epic-boundary/epic-boundary.js";
import { DependencyPlannerService } from "../tasks/dependency-planner/dependency-planner.js";
import { ReviewPlanService } from "../tasks/review-plan/review-plan.js";
import { bodyFormatDetector } from "../tasks/body-sections/body-format-detector.js";
import { blobSectionSource, sectionSelector } from "../tasks/body-sections/body-sections.js";
import {
  EpicSchema,
  InitiativeSchema,
  TechnicalDesignSchema,
  TicketSchema,
  TrackerUserSchema,
  type Epic,
  type TaskTracker,
  type Ticket,
} from "../tasks/task-tracker/task-tracker.js";
import type { OperationDescriptor } from "./operation-registry.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
  type OperationRegistry,
} from "./operation-registry.js";
import type { OperationEffect } from "./operation.schema.js";

const propsSchema = z.object({
  getTracker: z.custom<() => TaskTracker>((value) => typeof value === "function"),
  getPrHost: z.custom<() => PullRequestHost>((value) => typeof value === "function").optional(),
  getConfig: z
    .custom<() => Pick<Config, "inReviewStatus">>((value) => typeof value === "function")
    .optional(),
});

const sectionNames = [
  "problem-statement",
  "solution",
  "acceptance-criteria",
  "technical-writeup",
  "guided-walkthrough",
  "symptom",
  "environment",
  "steps-to-reproduce",
  "expected-vs-actual",
  "root-cause",
  "fixed-when",
  "evidence",
  "reproduction-notes",
] as const;
const sectionNameSet = new Set<string>(sectionNames);
const sectionName = z
  .string()
  .refine(
    (value) => sectionNameSet.has(value),
    `unknown section — expected one of: ${sectionNames.join(", ")}`,
  );
const entityInput = z.strictObject({ id: z.string().min(1) });
const ticketInput = entityInput.extend({
  section: sectionName.optional(),
});
const ticketResult = TicketSchema.passthrough();
const epicResult = EpicSchema.extend({ childIssues: z.array(ticketResult) }).passthrough();
const initiativeResult = InitiativeSchema.extend({
  epics: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()),
}).passthrough();
const tddResult = TechnicalDesignSchema.passthrough();
const sectionResult = z.object({
  id: z.string(),
  section: z.string(),
  format: z.enum(["layered-body", "bug-report"]),
  markdown: z.string().nullable(),
  items: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
});
const edgeResult = z.object({
  ticket: z.string(),
  ticketEpic: z.string(),
  blockedBy: z.string(),
  blockerEpic: z.string().nullable(),
  justification: z.string().nullable(),
});
const planTicket = z.object({
  id: z.string(),
  status: z.string(),
  blockedBy: z.array(z.string()),
  epicId: z.string().optional(),
});
const dependencyPlan = z.object({
  waves: z.array(z.array(planTicket)),
  cycles: z.array(z.string()),
});
export const TrackerDependencyPlanSchema = dependencyPlan.extend({
  crossEpicEdges: z.array(edgeResult),
  warnings: z.array(z.string()),
});
export const TrackerReviewPlanSchema = z.object({
  epic: z.object({ id: z.string(), title: z.string() }).optional(),
  initiative: z.object({ id: z.string(), title: z.string() }).optional(),
  defaultBranch: z.string(),
  route: z.enum(["simple", "complex", "incomplete"]),
  reasons: z.array(z.string()),
  missing: z.array(z.string()),
  blocked: z.array(
    z.object({
      ticketId: z.string(),
      title: z.string(),
      wave: z.number(),
      blockedBy: z.array(z.string()),
      pr: z
        .object({
          number: z.number(),
          url: z.string(),
          headRefName: z.string(),
          baseRefName: z.string(),
        })
        .nullable(),
    }),
  ),
  unblocksOnMerge: z.array(z.string()),
  crossEpicEdges: z.array(edgeResult),
  warnings: z.array(z.string()),
  cycles: z.array(z.string()),
});

export interface TrackerReadOperations {
  operations(): OperationDescriptor[];
}

/** Shares tracker reads and graph plans across Commander and programmatic hosts. */
export class DefaultTrackerReadOperations implements TrackerReadOperations {
  private readonly props: z.infer<typeof propsSchema>;

  constructor(props: z.input<typeof propsSchema>) {
    this.props = propsSchema.parse(props);
  }

  operations(): OperationDescriptor[] {
    return [
      this.descriptor(
        "ticket-get",
        "Read a ticket and optionally select one body section.",
        ["read", "network"],
        ["ticket", "get"],
        ticketInput,
        z.union([ticketResult, sectionResult]),
        (input) => this.getTicket(input),
      ),
      this.descriptor(
        "ticket-transitions",
        "List available status transitions for a ticket.",
        ["read", "network"],
        ["ticket", "transitions"],
        entityInput,
        z.object({ id: z.string(), transitions: z.array(z.string()) }),
        async ({ id }) => ({ id, transitions: await this.props.getTracker().listTransitions(id) }),
      ),
      this.descriptor(
        "users-get",
        "List users available for tracker assignment.",
        ["read", "network"],
        ["users", "get"],
        z.strictObject({}),
        z.array(TrackerUserSchema.passthrough()),
        () => this.props.getTracker().getUsers(),
      ),
      this.descriptor(
        "tdd-get",
        "Read a technical design by its tracker identifier.",
        ["read", "network"],
        ["tdd", "get"],
        entityInput,
        tddResult,
        ({ id }) => this.props.getTracker().getTechnicalDesign(id),
      ),
      this.descriptor(
        "epic-get",
        "Read an epic and its tracker fields.",
        ["read", "network"],
        ["epic", "get"],
        entityInput,
        epicResult,
        ({ id }) => this.props.getTracker().getEpic(id),
      ),
      this.descriptor(
        "initiative-get",
        "Read an initiative and its linked epics.",
        ["read", "network"],
        ["initiative", "get"],
        entityInput,
        initiativeResult,
        ({ id }) => this.props.getTracker().getInitiative(id),
      ),
      this.descriptor(
        "epic-plan",
        "Plan dependency waves and cross-epic edges for an epic.",
        ["read", "network", "process"],
        ["epic", "plan"],
        entityInput,
        TrackerDependencyPlanSchema,
        ({ id }) => this.planEpic(id),
      ),
      this.descriptor(
        "epic-review-plan",
        "Build the review hand-off for an epic's open pull requests.",
        ["read", "network", "process"],
        ["epic", "review-plan"],
        entityInput,
        TrackerReviewPlanSchema,
        ({ id }) => this.reviewEpic(id),
      ),
      this.descriptor(
        "initiative-plan",
        "Plan dependency waves across every epic in an initiative.",
        ["read", "network", "process"],
        ["initiative", "plan"],
        entityInput,
        TrackerDependencyPlanSchema,
        ({ id }) => this.planInitiative(id),
      ),
      this.descriptor(
        "initiative-review-plan",
        "Build the review hand-off across an initiative's epics.",
        ["read", "network", "process"],
        ["initiative", "review-plan"],
        entityInput,
        TrackerReviewPlanSchema,
        ({ id }) => this.reviewInitiative(id),
      ),
    ];
  }

  registry(): OperationRegistry {
    return new MapOperationRegistry({
      operations: this.operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network", "process"] }),
    });
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

  private async getTicket(input: z.infer<typeof ticketInput>) {
    const ticket = await this.props.getTracker().getTicket(input.id);
    if (input.section === undefined) return ticket;
    const format = bodyFormatDetector.detect({
      body: ticket.body,
      metadata: ticket.metadata,
      issueType: ticket.issueType,
    });
    return sectionSelector.select(
      input.id,
      blobSectionSource.read({ body: ticket.body, format }),
      input.section,
    );
  }

  private async planEpic(id: string) {
    const tracker = this.props.getTracker();
    const epic = await tracker.getEpic(id);
    const plan = new DependencyPlannerService().plan(this.plannerTickets(epic.childIssues));
    const edges = new CrossEpicEdgeFinder(tracker);
    const crossEpicEdges = await edges.find([epic]);
    return { ...plan, crossEpicEdges, warnings: edges.warnings(crossEpicEdges) };
  }

  private async planInitiative(id: string) {
    const tracker = this.props.getTracker();
    const initiative = await tracker.getInitiative(id);
    const epics = await Promise.all(initiative.epics.map((epic) => tracker.getEpic(epic.id)));
    const tickets = epics.flatMap((epic) =>
      epic.childIssues.map((ticket) => ({ ticket, epicId: epic.id })),
    );
    const plan = new DependencyPlannerService().plan(
      tickets.map(({ ticket, epicId }) => ({
        id: ticket.id,
        status: ticket.status,
        blockedBy: ticket.blockedBy,
        epicId,
      })),
    );
    const edges = new CrossEpicEdgeFinder(tracker);
    const crossEpicEdges = await edges.find(epics);
    return { ...plan, crossEpicEdges, warnings: edges.warnings(crossEpicEdges) };
  }

  private async reviewEpic(id: string) {
    const tracker = this.props.getTracker();
    const epic = await tracker.getEpic(id);
    return this.reviewPlan({ epic, epics: [epic] });
  }

  private async reviewInitiative(id: string) {
    const tracker = this.props.getTracker();
    const initiative = await tracker.getInitiative(id);
    const epics = await Promise.all(initiative.epics.map((epic) => tracker.getEpic(epic.id)));
    return this.reviewPlan({ initiative, epics });
  }

  private async reviewPlan(input: {
    epic?: Epic;
    initiative?: { id: string; title: string };
    epics: Epic[];
  }) {
    const tracker = this.props.getTracker();
    const tickets = input.epics.flatMap((epic) => epic.childIssues);
    const plan = new DependencyPlannerService().plan(this.plannerTickets(tickets));
    const { inReviewStatus } = this.props.getConfig?.() ?? {};
    const service = new ReviewPlanService();
    const ids = service.inReviewTicketIds(plan, inReviewStatus);
    const host = this.props.getPrHost?.();
    if (host === undefined)
      throw new PullRequestHostUnavailableError(
        "pull request host is unavailable for review planning",
      );
    const pullRequests = ids.length > 0 ? await host.listOpenPullRequestsForTickets(ids) : [];
    const defaultBranch = await host.defaultBranch();
    const result = service.build({ plan, tickets, pullRequests, defaultBranch, inReviewStatus });
    const edges = new CrossEpicEdgeFinder(tracker);
    const crossEpicEdges = await edges.find(input.epics);
    return {
      ...(input.epic === undefined ? {} : { epic: { id: input.epic.id, title: input.epic.title } }),
      ...(input.initiative === undefined ? {} : { initiative: input.initiative }),
      defaultBranch,
      ...result,
      crossEpicEdges,
      warnings: edges.warnings(crossEpicEdges),
      cycles: plan.cycles,
    };
  }

  private plannerTickets(tickets: readonly Ticket[]) {
    return tickets.map((ticket) => ({
      id: ticket.id,
      status: ticket.status,
      blockedBy: ticket.blockedBy,
    }));
  }
}

export class PullRequestHostUnavailableError extends Error {
  override name = "PullRequestHostUnavailableError";
}
