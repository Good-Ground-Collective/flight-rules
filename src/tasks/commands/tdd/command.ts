import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { resolveBody } from "../resolve-body.js";
import { z } from "zod";
import { RegistryCommandOperationClient } from "../../../operations/command-operation-client.js";
import { DefaultTrackerEntityOperations } from "../../../operations/tracker-entity-operations.js";
import {
  LaunchOperationAccessPolicy,
  type OperationRegistry,
} from "../../../operations/operation-registry.js";

type CreateTddOptions = {
  title: string;
  body?: string;
  bodyFile?: string;
  epicId: string;
  allowLocalPaths?: boolean;
};

export function createTddCommand(
  getTracker: () => TaskTracker,
  registry?: OperationRegistry,
): Command {
  const tdd = new Command("tdd");
  const operations = new RegistryCommandOperationClient({
    registry:
      registry ??
      new DefaultTrackerEntityOperations({ getTracker, cwd: process.cwd() }).registry(
        new LaunchOperationAccessPolicy({
          allowedEffects: ["read", "write", "network", "process"],
        }),
      ),
  });

  tdd
    .command("create")
    .exitOverride()
    .requiredOption("--title <title>", "tdd title")
    .option("--body <body>", "tdd body (or use --body-file)")
    .option("--body-file <path>", "read the tdd body from a file")
    .requiredOption("--epic-id <id>", "parent epic id")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (opts: CreateTddOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "tdd-create",
        {
          title: opts.title,
          body,
          epicId: opts.epicId,
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  tdd
    .command("get")
    .exitOverride()
    .argument("<id>", "tdd id")
    .action(async (id: string) => {
      const result = await operations.invoke("tdd-get", { id }, z.unknown());
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  return tdd;
}
