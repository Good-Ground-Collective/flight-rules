import { AttributionStripper } from "../../shared/attribution-stripper/attribution-stripper.js";
import { CommitGuard, PreToolUseInputSchema } from "../commit-guard/commit-guard.js";
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
export class PreBashHook {
  private readonly guard: CommitGuard;
  private readonly stripper: AttributionStripper;

  constructor(props: PreBashHookProps = {}) {
    this.guard = props.guard ?? new CommitGuard();
    this.stripper = props.stripper ?? new AttributionStripper();
  }

  handle(payload: unknown): PreToolUseDecision | PreToolUseRewrite | undefined {
    const denied = this.guard.decide(payload);
    if (denied !== undefined) return denied;

    const parsed = PreToolUseInputSchema.safeParse(payload);
    if (!parsed.success || parsed.data.tool_name !== "Bash") return undefined;
    const toolInput = parsed.data.tool_input;
    const command = toolInput?.command;
    if (toolInput === undefined || command === undefined) return undefined;

    const stripped = this.stripper.stripCommand(command);
    if (stripped === undefined) return undefined;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...toolInput, command: stripped },
      },
    };
  }
}
