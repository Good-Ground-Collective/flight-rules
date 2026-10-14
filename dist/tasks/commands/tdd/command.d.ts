import { Command } from "commander";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import type { OperationRegistry } from "../../../operations/operation-registry.js";
export declare function createTddCommand(getTracker: () => TaskTracker, registry?: OperationRegistry): Command;
