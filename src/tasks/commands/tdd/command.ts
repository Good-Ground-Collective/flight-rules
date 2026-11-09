import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { resolveBody } from "../resolve-body.js";
import { collect } from "../../../shared/collect.js";
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
  attach: string[];
  allowLocalPaths?: boolean;
};

type CommentTddOptions = {
  body?: string;
  bodyFile?: string;
  allowLocalPaths?: boolean;
};

type EditTddOptions = {
  title?: string;
  body?: string;
  bodyFile?: string;
  attach: string[];
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
    .option("--attach <spec>", "file to attach, as <path>#<caption> (repeatable)", collect, [])
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
          attach: opts.attach,
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  tdd
    .command("edit")
    .exitOverride()
    .argument("<id>", "tdd id")
    .option("--title <title>", "new tdd title (unchanged if omitted)")
    .option("--body <body>", "new tdd body (or use --body-file)")
    .option("--body-file <path>", "read the new tdd body from a file")
    .option("--attach <spec>", "file to attach, as <path>#<caption> (repeatable)", collect, [])
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (id: string, opts: EditTddOptions) => {
      const hasBody = opts.body !== undefined || opts.bodyFile !== undefined;
      const body = hasBody ? resolveBody({ body: opts.body, bodyFile: opts.bodyFile }) : undefined;
      const result = await operations.invoke(
        "tdd-edit",
        {
          id,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(body !== undefined ? { body } : {}),
          attach: opts.attach,
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

  tdd
    .command("comment")
    .exitOverride()
    .argument("<id>", "tdd id")
    .option("--body <body>", "comment body (or use --body-file)")
    .option("--body-file <path>", "read the comment body from a file")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (id: string, opts: CommentTddOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "tdd-comment",
        { id, body, allowLocalPaths: opts.allowLocalPaths ?? false },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  return tdd;
}
