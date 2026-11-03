import { Command } from "commander";
import { PreBashHook } from "../../pre-bash/pre-bash.js";
import { SubagentStatusRecorder } from "../../subagent-status/subagent-status.js";
import { UsageHandoffHook } from "../../usage-handoff/usage-handoff.js";
export declare function createHookCommand(getHandler?: () => PreBashHook, readStdin?: () => Promise<string>, getStatusRecorder?: () => SubagentStatusRecorder, getUsageHandoff?: () => UsageHandoffHook): Command;
