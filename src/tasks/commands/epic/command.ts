import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { resolveBody } from "../resolve-body.js";
import type { PullRequestHost } from "../../../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../../../shared/config.js";
import { z } from "zod";
import { RegistryCommandOperationClient } from "../../../operations/command-operation-client.js";
import {
  TrackerDependencyPlanSchema,
  TrackerReviewPlanSchema,
} from "../../../operations/tracker-read-operations.js";
import { DefaultTrackerEntityOperations } from "../../../operations/tracker-entity-operations.js";
import {
  LaunchOperationAccessPolicy,
  type OperationRegistry,
} from "../../../operations/operation-registry.js";

type CreateEpicOptions = {
  title: string;
  body?: string;
  bodyFile?: string;
  labels?: string;
  allowLocalPaths?: boolean;
};

type EditEpicOptions = {
  body?: string;
  bodyFile?: string;
  title?: string;
  labels?: string;
  allowLocalPaths?: boolean;
};

export function createEpicCommand(
  getTracker: () => TaskTracker,
  getPrHost: () => PullRequestHost,
  getConfig: () => Pick<Config, "inReviewStatus"> = () => ({}),
  registry?: OperationRegistry,
): Command {
  const epic = new Command("epic");
  const operations = new RegistryCommandOperationClient({
    registry:
      registry ??
      new DefaultTrackerEntityOperations({
        getTracker,
        getPrHost,
        getConfig,
        cwd: process.cwd(),
      }).registry(
        new LaunchOperationAccessPolicy({
          allowedEffects: ["read", "write", "network", "process"],
        }),
      ),
  });

  epic
    .command("create")
    .exitOverride()
    .requiredOption("--title <title>", "epic title")
    .option("--body <body>", "epic body (or use --body-file)")
    .option("--body-file <path>", "read the epic body from a file")
    .option("--labels <labels>", "comma-separated labels")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (opts: CreateEpicOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "epic-create",
        {
          title: opts.title,
          body,
          labels: opts.labels !== undefined ? opts.labels.split(",") : [],
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  epic
    .command("edit")
    .exitOverride()
    .argument("<id>", "epic id")
    .option("--body <body>", "new epic body (or use --body-file)")
    .option("--body-file <path>", "read the new epic body from a file")
    .option("--title <title>", "new epic title (unchanged if omitted)")
    .option("--labels <labels>", "comma-separated labels replacing existing free-form labels")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (id: string, opts: EditEpicOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "epic-edit",
        {
          id,
          body,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.labels !== undefined ? { labels: opts.labels.split(",") } : {}),
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  epic
    .command("get")
    .exitOverride()
    .argument("<id>", "epic id")
    .action(async (id: string) => {
      const result = await operations.invoke("epic-get", { id }, z.unknown());
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  epic
    .command("plan")
    .exitOverride()
    .argument("<id>", "epic id")
    .action(async (id: string) => {
      const result = await operations.invoke("epic-plan", { id }, TrackerDependencyPlanSchema);
      for (const warning of result.warnings) process.stderr.write(warning + "\n");
      process.stdout.write(
        JSON.stringify({
          waves: result.waves,
          cycles: result.cycles,
          crossEpicEdges: result.crossEpicEdges,
        }) + "\n",
      );
      if (result.cycles.length > 0) {
        throw new Error(`dependency cycle detected among tickets: ${result.cycles.join(", ")}`);
      }
    });

  epic
    .command("review-plan")
    .exitOverride()
    .argument("<id>", "epic id")
    .action(async (id: string) => {
      const result = await operations.invoke("epic-review-plan", { id }, TrackerReviewPlanSchema);
      for (const warning of result.warnings) process.stderr.write(warning + "\n");
      process.stdout.write(
        JSON.stringify({
          epic: result.epic,
          defaultBranch: result.defaultBranch,
          route: result.route,
          reasons: result.reasons,
          missing: result.missing,
          blocked: result.blocked,
          unblocksOnMerge: result.unblocksOnMerge,
          crossEpicEdges: result.crossEpicEdges,
        }) + "\n",
      );
      if (result.cycles.length > 0) {
        throw new Error(`dependency cycle detected among tickets: ${result.cycles.join(", ")}`);
      }
    });

  epic
    .command("link-initiative")
    .exitOverride()
    .argument("<epicId>", "epic id")
    .requiredOption("--initiative <id>", "initiative (milestone) id")
    .action(async (epicId: string, opts: { initiative: string }) => {
      await operations.invoke(
        "epic-link-initiative",
        { epicId, initiativeId: opts.initiative },
        z.unknown(),
      );
    });

  return epic;
}
