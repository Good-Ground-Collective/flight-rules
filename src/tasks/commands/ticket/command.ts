import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { resolveBody } from "../resolve-body.js";
import { collect } from "../../../shared/collect.js";
import { EpicBoundaryGuard } from "../../epic-boundary/epic-boundary.js";
import { TrackerEvidenceService } from "../../evidence/evidence.js";
import { z } from "zod";
import { RegistryCommandOperationClient } from "../../../operations/command-operation-client.js";
import { DefaultTrackerEntityOperations } from "../../../operations/tracker-entity-operations.js";
import {
  LaunchOperationAccessPolicy,
  type OperationRegistry,
} from "../../../operations/operation-registry.js";

type CreateTicketOptions = {
  title: string;
  body?: string;
  bodyFile?: string;
  epicId?: string;
  labels?: string;
  assignee?: string;
  allowLocalPaths?: boolean;
};

type EditTicketOptions = {
  body?: string;
  bodyFile?: string;
  title?: string;
  labels?: string;
  attach: string[];
  allowLocalPaths?: boolean;
};

export function createTicketCommand(
  getTracker: () => TaskTracker,
  registry?: OperationRegistry,
): Command {
  const ticket = new Command("ticket");
  const operations = new RegistryCommandOperationClient({
    registry:
      registry ??
      new DefaultTrackerEntityOperations({ getTracker, cwd: process.cwd() }).registry(
        new LaunchOperationAccessPolicy({
          allowedEffects: ["read", "write", "network", "process"],
        }),
      ),
  });

  ticket
    .command("create")
    .exitOverride()
    .requiredOption("--title <title>", "ticket title")
    .option("--body <body>", "ticket body (or use --body-file)")
    .option("--body-file <path>", "read the ticket body from a file")
    .option("--epic-id <id>", "parent epic id; omit to create a standalone ticket")
    .option("--labels <labels>", "comma-separated labels")
    .option("--assignee <user>", "assignee login")
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (opts: CreateTicketOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "ticket-create",
        {
          title: opts.title,
          body,
          labels: opts.labels !== undefined ? opts.labels.split(",") : [],
          ...(opts.epicId !== undefined ? { epicId: opts.epicId } : {}),
          ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  ticket
    .command("edit")
    .exitOverride()
    .argument("<id>", "ticket id")
    .option("--body <body>", "new ticket body (or use --body-file)")
    .option("--body-file <path>", "read the new ticket body from a file")
    .option("--title <title>", "new ticket title (unchanged if omitted)")
    .option("--labels <labels>", "comma-separated labels replacing existing free-form labels")
    .option("--attach <spec>", "file to attach, as <path>#<caption> (repeatable)", collect, [])
    .option(
      "--allow-local-paths",
      "accept machine-local paths in the body (see docs/layered-body-format.md)",
    )
    .action(async (id: string, opts: EditTicketOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const result = await operations.invoke(
        "ticket-edit",
        {
          id,
          body,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.labels !== undefined ? { labels: opts.labels.split(",") } : {}),
          attach: opts.attach,
          allowLocalPaths: opts.allowLocalPaths ?? false,
        },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  ticket
    .command("get")
    .exitOverride()
    .argument("<id>", "ticket id")
    .option("--section <name>", "extract a single body section (e.g. acceptance-criteria)")
    .action(async (id: string, opts: { section?: string }) => {
      const result = await operations.invoke(
        "ticket-get",
        { id, ...(opts.section === undefined ? {} : { section: opts.section }) },
        z.unknown(),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  ticket
    .command("block")
    .exitOverride()
    .argument("<id>", "ticket id to block")
    .requiredOption("--by <blockerId>", "id of the ticket that must close first")
    .option(
      "--cross-epic-reason <why>",
      "one-line justification, required when the two tickets sit in different epics (see docs/epic-boundaries.md)",
    )
    .action(async (id: string, opts: { by: string; crossEpicReason?: string }) => {
      const outcome = await new EpicBoundaryGuard(getTracker()).block({
        ticketId: id,
        blockerId: opts.by,
        reason: opts.crossEpicReason,
      });
      for (const warning of outcome.warnings) process.stderr.write(`warning: ${warning}\n`);
    });

  ticket
    .command("unblock")
    .exitOverride()
    .argument("<id>", "ticket id to unblock")
    .requiredOption("--by <blockerId>", "id of the blocking ticket to remove")
    .action(async (id: string, opts: { by: string }) => {
      await getTracker().unblockTicket(id, opts.by);
    });

  ticket
    .command("status")
    .exitOverride()
    .argument("<id>", "ticket id to transition")
    .requiredOption("--to <status>", 'target status, e.g. "In Progress" or "In Review"')
    .action(async (id: string, opts: { to: string }) => {
      await getTracker().transitionTicket(id, opts.to);
      process.stdout.write(JSON.stringify({ id, status: opts.to }) + "\n");
    });

  ticket
    .command("transitions")
    .exitOverride()
    .argument("<id>", "ticket id")
    .action(async (id: string) => {
      const result = await operations.invoke("ticket-transitions", { id }, z.unknown());
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  ticket
    .command("comment")
    .exitOverride()
    .argument("<id>", "ticket id")
    .option("--body <body>", "comment body (or use --body-file)")
    .option("--body-file <path>", "read the comment body from a file")
    .option("--attach <spec>", "file to attach, as <path>#<caption> (repeatable)", collect, [])
    .action(async (id: string, opts: { body?: string; bodyFile?: string; attach: string[] }) => {
      const tracker = getTracker();
      const raw = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
      const body =
        opts.attach.length === 0
          ? raw
          : (
              await new TrackerEvidenceService({ tracker }).attach({
                ticketId: id,
                body: raw,
                specs: opts.attach,
              })
            ).body;
      const comment = await tracker.addComment(id, body);
      process.stdout.write(JSON.stringify(comment) + "\n");
    });

  ticket
    .command("label")
    .exitOverride()
    .argument("<id>", "ticket id")
    .option("--add <label>", "label to add (repeatable)", collect, [])
    .option("--remove <label>", "label to remove (repeatable)", collect, [])
    .action(async (id: string, opts: { add: string[]; remove: string[] }) => {
      if (opts.add.length === 0 && opts.remove.length === 0) {
        throw new Error("ticket label needs at least one --add or --remove");
      }
      const tracker = getTracker();
      // Removals run first so a swap never leaves both lifecycle labels present if the addition fails.
      for (const label of opts.remove) await tracker.removeLabel(id, label);
      for (const label of opts.add) await tracker.addLabel(id, label);
      process.stdout.write(JSON.stringify({ id, added: opts.add, removed: opts.remove }) + "\n");
    });

  return ticket;
}
