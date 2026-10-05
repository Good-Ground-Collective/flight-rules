import { z } from "zod";
/** The fields of a Claude Code PreToolUse hook payload this guard reads. */
export declare const PreToolUseInputSchema: z.ZodObject<{
    tool_name: z.ZodOptional<z.ZodString>;
    tool_input: z.ZodOptional<z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export interface PreToolUseDecision {
    hookSpecificOutput: {
        hookEventName: "PreToolUse";
        permissionDecision: "deny";
        permissionDecisionReason: string;
    };
}
export interface CommitGuardProps {
    /** Reports whether a directory has project-level flight-rules config; defaults to the `ConfigStore` layers. */
    isConfigured?: (dir: string) => boolean;
    env?: Record<string, string | undefined>;
}
export declare const bypassVariable = "FLIGHT_RULES_RAW_GIT";
/**
 * Decides whether a Bash command an agent is about to run commits with a
 * hand-written message in a repo that uses flight-rules, and if so blocks it
 * with a reason pointing at `flight-rules git commit`. It never blocks
 * outside a flight-rules repo, never blocks a commit that writes no new
 * message (`--no-edit`), and honours `FLIGHT_RULES_RAW_GIT=1` as a deliberate
 * bypass. Command parsing is best-effort: anything it cannot read is allowed.
 */
export declare class CommitGuard {
    private readonly isConfigured;
    private readonly env;
    constructor(props?: CommitGuardProps);
    decide(payload: unknown): PreToolUseDecision | undefined;
    /** True when any segment of the command is a `git commit` that authors a message. */
    commitsWithMessage(command: string): boolean;
    private configured;
    private segments;
    private isAuthoringCommit;
}
