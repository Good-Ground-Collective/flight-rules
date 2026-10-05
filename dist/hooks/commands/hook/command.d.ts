import { Command } from "commander";
import { PreBashHook } from "../../pre-bash/pre-bash.js";
export declare function createHookCommand(getHandler?: () => PreBashHook, readStdin?: () => Promise<string>): Command;
