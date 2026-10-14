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

type CreateInitiativeOptions = {
  title: string;
  body?: string;
  bodyFile?: string;
  allowLocalPaths?: boolean;
};
type EditInitiativeOptions = {
  body?: string;
  bodyFile?: string;
  title?: string;
  allowLocalPaths?: boolean;
};

export function createInitiativeCommand(
  getTracker: () => TaskTracker,
  getPrHost: () => PullRequestHost,
  getConfig: () => Pick<Config, "inReviewStatus"> = () => ({}),
  registry?: OperationRegistry,
): Command {
  const initiative = new Command("initiative");
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

  initiative
    .command("create")
    .exitOverride()
    .requiredOption("--title <title>", "initiative title")
    .option("--body <body>", "initiative body (or use --body-file)")
    .option("--body-file <path>", "read the initiative body from a file")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (opts: CreateInitiativeOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "initiative-create",
        {
          title: opts.title,
          body,
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  initiative
    .command("edit")
    .exitOverride()
    .argument("<id>", "initiative id")
    .option("--body <body>", "new initiative body (or use --body-file)")
    .option("--body-file <path>", "read the new initiative body from a file")
    .option("--title <title>", "new initiative title (unchanged if omitted)")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (id: string, opts: EditInitiativeOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "initiative-edit",
        {
          id,
          body,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  initiative
    .command("get")
    .exitOverride()
    .argument("<id>", "initiative id")
    .action(async (id: string) => {
      const result = await operations.invoke("initiative-get", { id }, z.unknown());
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  initiative
    .command("plan")
    .exitOverride()
    .argument("<id>", "initiative id")
    .action(async (id: string) => {
      const result = await operations.invoke(
        "initiative-plan",
        { id },
        TrackerDependencyPlanSchema,
      );
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

  initiative
    .command("review-plan")
    .exitOverride()
    .argument("<id>", "initiative id")
    .action(async (id: string) => {
      const result = await operations.invoke(
        "initiative-review-plan",
        { id },
        TrackerReviewPlanSchema,
      );
      for (const warning of result.warnings) process.stderr.write(warning + "\n");
      process.stdout.write(
        JSON.stringify({
          initiative: result.initiative,
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

  return initiative;
}
