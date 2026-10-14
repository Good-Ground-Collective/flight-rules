import { Command } from "commander";
import { z } from "zod";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { RegistryCommandOperationClient } from "../../../operations/command-operation-client.js";
import { DefaultTrackerReadOperations } from "../../../operations/tracker-read-operations.js";
import type { OperationRegistry } from "../../../operations/operation-registry.js";

export function createUsersCommand(
  getTracker: () => TaskTracker,
  registry?: OperationRegistry,
): Command {
  const users = new Command("users");
  const operations = new RegistryCommandOperationClient({
    registry: registry ?? new DefaultTrackerReadOperations({ getTracker }).registry(),
  });

  users
    .command("get")
    .exitOverride()
    .action(async () => {
      const result = await operations.invoke("users-get", {}, z.unknown());
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  return users;
}
