import { Command } from "commander";
import type { OperationRegistry } from "../../../operations/operation-registry.js";
/**
 * `commit-message` and `branch-name` produce what `git commit` and
 * `git checkout` would use without running git, for harnesses that only let
 * an agent run git directly (for example a worktree-isolated session).
 */
export declare function createCommitMessageCommand(registry: OperationRegistry): Command;
export declare function createBranchNameCommand(registry: OperationRegistry): Command;
