import { Command } from "commander";
import { CommitGuard } from "../../commit-guard/commit-guard.js";
export declare function createHookCommand(getGuard?: () => CommitGuard, readStdin?: () => Promise<string>): Command;
