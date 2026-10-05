import { z } from "zod";
import { ConfigStore } from "../../shared/config-store.js";

/** The fields of a Claude Code PreToolUse hook payload this guard reads. */
export const PreToolUseInputSchema = z.looseObject({
  tool_name: z.string().optional(),
  tool_input: z.looseObject({ command: z.string().optional() }).optional(),
  cwd: z.string().optional(),
});

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

export const bypassVariable = "FLIGHT_RULES_RAW_GIT";

// Global git options that take a separate value, so the value is not
// mistaken for the subcommand (`git -C dir commit`).
const optionsWithValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Decides whether a Bash command an agent is about to run commits with a
 * hand-written message in a repo that uses flight-rules, and if so blocks it
 * with a reason pointing at `flight-rules git commit`. It never blocks
 * outside a flight-rules repo, never blocks a commit that writes no new
 * message (`--no-edit`), and honours `FLIGHT_RULES_RAW_GIT=1` as a deliberate
 * bypass. Command parsing is best-effort: anything it cannot read is allowed.
 */
export class CommitGuard {
  private readonly isConfigured: (dir: string) => boolean;
  private readonly env: Record<string, string | undefined>;

  constructor(props: CommitGuardProps = {}) {
    this.env = props.env ?? process.env;
    this.isConfigured =
      props.isConfigured ??
      ((dir) =>
        // User-scope config applies to every repo, so it alone doesn't count.
        new ConfigStore({ cwd: dir, env: this.env })
          .inspect()
          .layers.some((layer) => layer.present && layer.scope !== "user"));
  }

  decide(payload: unknown): PreToolUseDecision | undefined {
    const parsed = PreToolUseInputSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    const input = parsed.data;
    if (input.tool_name !== "Bash") return undefined;
    const command = input.tool_input?.command;
    if (command === undefined) return undefined;
    if (!this.commitsWithMessage(command)) return undefined;

    const dir = this.env["CLAUDE_PROJECT_DIR"] ?? input.cwd;
    if (dir === undefined || !this.configured(dir)) return undefined;

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: [
          "This repo uses flight-rules, so commits go through its CLI, which writes the conventional subject, the body, and the version trailers:",
          "  flight-rules git commit --type <type> --scope <scope> --description \"<subject>\" --body-file <path-to-body.md> --file <path>…",
          `If raw git is genuinely the right tool here (for example the CLI cannot express this commit), re-run the same command prefixed with ${bypassVariable}=1 and say why in your reply.`,
        ].join("\n"),
      },
    };
  }

  /** True when any segment of the command is a `git commit` that authors a message. */
  commitsWithMessage(command: string): boolean {
    if (new RegExp(`(^|[\\s;&|(])(export\\s+)?${bypassVariable}=1\\b`).test(command)) return false;
    return this.segments(command).some((tokens) => this.isAuthoringCommit(tokens));
  }

  private configured(dir: string): boolean {
    try {
      return this.isConfigured(dir);
    } catch {
      // Unreadable config never blocks a commit.
      return false;
    }
  }

  private segments(command: string): string[][] {
    return command
      .split(/&&|\|\||[;|\n`]|\$\(|\(|\)/)
      .map((segment) => segment.trim().split(/\s+/).filter((token) => token !== ""));
  }

  private isAuthoringCommit(tokens: string[]): boolean {
    let i = 0;
    while (i < tokens.length && assignment.test(tokens[i] ?? "")) i++;
    const program = tokens[i];
    if (program === undefined || !/(^|\/)git$/.test(program)) return false;
    i++;
    while (i < tokens.length && (tokens[i] ?? "").startsWith("-")) {
      i += optionsWithValue.has(tokens[i] ?? "") ? 2 : 1;
    }
    if (tokens[i] !== "commit") return false;
    return !tokens.slice(i + 1).includes("--no-edit");
  }
}
