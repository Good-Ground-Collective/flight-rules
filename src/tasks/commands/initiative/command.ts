import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { resolveBody } from "../resolve-body.js";
import { DependencyPlannerService } from "../../dependency-planner/dependency-planner.js";

type CreateInitiativeOptions = { title: string; body?: string; bodyFile?: string };

export function createInitiativeCommand(getTracker: () => TaskTracker): Command {
  const initiative = new Command("initiative");

  initiative
    .command("create")
    .exitOverride()
    .requiredOption("--title <title>", "initiative title")
    .option("--body <body>", "initiative body (or use --body-file)")
    .option("--body-file <path>", "read the initiative body from a file")
    .action(async (opts: CreateInitiativeOptions) => {
      const result = await getTracker().createInitiative({
        title: opts.title,
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
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

  return initiative;
}
