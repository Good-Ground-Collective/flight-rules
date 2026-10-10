import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { resolveBody } from "../resolve-body.js";
import { portableContextGuard } from "../../portable-context/portable-context.js";
import { DependencyPlannerService } from "../../dependency-planner/dependency-planner.js";
import { ReviewPlanService } from "../../review-plan/review-plan.js";
import type { PullRequestHost } from "../../../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../../../shared/config.js";

type CreateInitiativeOptions = { title: string; body?: string; bodyFile?: string; allowLocalPaths?: boolean };
type EditInitiativeOptions = { body?: string; bodyFile?: string; title?: string; allowLocalPaths?: boolean };

export function createInitiativeCommand(
  getTracker: () => TaskTracker,
  getPrHost: () => PullRequestHost,
  getConfig: () => Pick<Config, "inReviewStatus"> = () => ({}),
): Command {
  const initiative = new Command("initiative");

  initiative
    .command("create")
    .exitOverride()
    .requiredOption("--title <title>", "initiative title")
    .option("--body <body>", "initiative body (or use --body-file)")
    .option("--body-file <path>", "read the initiative body from a file")
    .option("--allow-local-paths", "accept machine-local paths in the body (see docs/layered-body-format.md)")
    .action(async (opts: CreateInitiativeOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      portableContextGuard.assertPortable(body, { allowLocalPaths: opts.allowLocalPaths });
      const result = await getTracker().createInitiative({
        title: opts.title,
        body,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  initiative
    .command("edit")
    .exitOverride()
    .argument("<id>", "initiative id")
    .option("--body <body>", "new initiative body (or use --body-file)")
    .option("--body-file <path>", "read the new initiative body from a file")
    .option("--title <title>", "new initiative title (unchanged if omitted)")
    .option("--allow-local-paths", "accept machine-local paths in the body (see docs/layered-body-format.md)")
    .action(async (id: string, opts: EditInitiativeOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      portableContextGuard.assertPortable(body, { allowLocalPaths: opts.allowLocalPaths });
      const result = await getTracker().updateInitiativeDescription(id, {
        body,
        ...(opts.title !== undefined ? { title: opts.title } : {}),
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  initiative
    .command("get")
    .exitOverride()
    .argument("<id>", "initiative id")
    .action(async (id: string) => {
      const result = await getTracker().getInitiative(id);
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  initiative
    .command("plan")
    .exitOverride()
    .argument("<id>", "initiative id")
    .action(async (id: string) => {
      const tracker = getTracker();
      const initiativeData = await tracker.getInitiative(id);
      const epics = await Promise.all(initiativeData.epics.map((e) => tracker.getEpic(e.id)));
      const planner = new DependencyPlannerService();
      const plan = planner.plan(
        epics
          .flatMap((e) => e.childIssues)
          .map((ticket) => ({
            id: ticket.id,
            status: ticket.status,
            blockedBy: ticket.blockedBy,
          })),
      );
      process.stdout.write(JSON.stringify(plan) + "\n");
      if (plan.cycles.length > 0) {
        throw new Error(`dependency cycle detected among tickets: ${plan.cycles.join(", ")}`);
      }
    });

  initiative
    .command("review-plan")
    .exitOverride()
    .argument("<id>", "initiative id")
    .action(async (id: string) => {
      const tracker = getTracker();
      const initiativeData = await tracker.getInitiative(id);
      const epics = await Promise.all(initiativeData.epics.map((e) => tracker.getEpic(e.id)));
      const tickets = epics.flatMap((e) => e.childIssues);
      const plan = new DependencyPlannerService().plan(
        tickets.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          blockedBy: ticket.blockedBy,
        })),
      );
      const { inReviewStatus } = getConfig();
      const reviewPlan = new ReviewPlanService();
      const inReviewIds = reviewPlan.inReviewTicketIds(plan, inReviewStatus);

      const host = getPrHost();
      const pullRequests = inReviewIds.length > 0 ? await host.listOpenPullRequestsForTickets(inReviewIds) : [];
      const defaultBranch = await host.defaultBranch();

      const result = reviewPlan.build({ plan, tickets, pullRequests, defaultBranch, inReviewStatus });
      process.stdout.write(
        JSON.stringify({
          initiative: { id: initiativeData.id, title: initiativeData.title },
          defaultBranch,
          route: result.route,
          reasons: result.reasons,
          missing: result.missing,
          blocked: result.blocked,
          unblocksOnMerge: result.unblocksOnMerge,
        }) + "\n",
      );
      if (plan.cycles.length > 0) {
        throw new Error(`dependency cycle detected among tickets: ${plan.cycles.join(", ")}`);
      }
    });

  return initiative;
}
