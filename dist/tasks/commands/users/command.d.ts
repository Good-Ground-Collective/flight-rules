import { Command } from 'commander';
import type { TaskTracker } from '../../task-tracker/task-tracker.js';
export declare function createUsersCommand(getTracker: () => TaskTracker): Command;
