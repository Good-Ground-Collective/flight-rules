import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import type { PullRequestHost } from "../../../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../../../shared/config.js";
import type { OperationRegistry } from "../../../operations/operation-registry.js";
export declare function createEpicCommand(getTracker: () => TaskTracker, getPrHost: () => PullRequestHost, getConfig?: () => Pick<Config, "inReviewStatus">, registry?: OperationRegistry): Command;
