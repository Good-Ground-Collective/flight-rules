import { Command, Option } from "commander";
import type { Config } from "../../../shared/config.js";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import type { ToolProbe } from "../../tool-probe/tool-probe.js";
import { QaInstructionsFinder } from "../../qa-instructions/qa-instructions.js";
import {
  NodeRepositoryReadiness,
  type RepositoryReadiness,
} from "../../readiness/repository-readiness.js";
import { ReadinessOptionsSchema, WorkflowSchema } from "../../readiness/readiness.schema.js";

export class ReadinessFailedError extends Error {
  override name = "ReadinessFailedError";
}

export function createCheckCommand(
  getConfig: () => Config,
  getTracker: () => TaskTracker,
  getConfigPath: () => string,
  getProbe: () => ToolProbe,
  getFinder: () => QaInstructionsFinder = () => new QaInstructionsFinder(),
  getReadiness: () => RepositoryReadiness = () => new NodeRepositoryReadiness(),
): Command {
  const check = new Command("check");
  check
    .addOption(
      new Option(
        "--workflow <name>",
        "check readiness for this workflow before its first mutation",
      ).choices(WorkflowSchema.options),
    )
    .exitOverride()
    .action(async (options: { workflow?: string }) => {
      const parsed = ReadinessOptionsSchema.parse({ workflow: options.workflow });
      const report = await getReadiness().inspect({
        config: getConfig,
        tracker: getTracker,
        configPath: getConfigPath,
        probe: getProbe(),
        finder: getFinder(),
        options: parsed,
      });
      process.stdout.write(JSON.stringify(report) + "\n");
      if (!report.ok)
        throw new ReadinessFailedError("flight-rules check failed — see report above");
    });
  return check;
}
