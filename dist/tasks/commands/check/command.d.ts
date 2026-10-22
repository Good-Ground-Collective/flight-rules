import { Command } from "commander";
import type { Config } from "../../../shared/config.js";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import type { ToolProbe } from "../../tool-probe/tool-probe.js";
import { QaInstructionsFinder } from "../../qa-instructions/qa-instructions.js";
import { type RepositoryReadiness } from "../../readiness/repository-readiness.js";
export declare class ReadinessFailedError extends Error {
    name: string;
}
export declare function createCheckCommand(getConfig: () => Config, getTracker: () => TaskTracker, getConfigPath: () => string, getProbe: () => ToolProbe, getFinder?: () => QaInstructionsFinder, getReadiness?: () => RepositoryReadiness): Command;
