import { AttributionStripper } from "../../shared/attribution-stripper/attribution-stripper.js";
import { CommitGuard } from "../commit-guard/commit-guard.js";
import type { PreToolUseDecision } from "../commit-guard/commit-guard.js";
export interface PreToolUseRewrite {
    hookSpecificOutput: {
        hookEventName: "PreToolUse";
        updatedInput: Record<string, unknown>;
    };
}
export interface PreBashHookProps {
    guard?: CommitGuard;
    stripper?: AttributionStripper;
}
/**
 * The plugin's PreToolUse(Bash) handler. The commit guard runs first and a
 * deny wins; otherwise a commit or PR command has Claude's attribution
 * trailers removed. The rewrite carries no permission decision, so the
 * command still goes through the normal permission flow.
 */
export declare class PreBashHook {
    private readonly guard;
    private readonly stripper;
    constructor(props?: PreBashHookProps);
    handle(payload: unknown): PreToolUseDecision | PreToolUseRewrite | undefined;
}
