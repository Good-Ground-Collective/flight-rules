import { Command } from 'commander';
import type { GitExecutor } from '../../git-executor/git-executor.js';
export declare function createGitCommand(getExecutor: () => GitExecutor): Command;
