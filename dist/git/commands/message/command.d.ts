import { Command } from 'commander';
/**
 * `commit-message` and `branch-name` produce what `git commit` and
 * `git checkout` would use without running git, for harnesses that only let
 * an agent run git directly (for example a worktree-isolated session).
 */
export declare function createCommitMessageCommand(): Command;
export declare function createBranchNameCommand(): Command;
