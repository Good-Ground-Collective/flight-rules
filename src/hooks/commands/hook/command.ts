import { text } from "node:stream/consumers";
import { Command } from "commander";
import { createFlightRules } from "../../../flight-rules/flight-rules.js";
import type { AriadneBoard } from "../../../shared/ariadne/ariadne-board.js";
import type { AgentDispatchHook } from "../../board-heartbeat/agent-dispatch-hook.js";
import { DetachedHeartbeatSender } from "../../board-heartbeat/board-heartbeat.js";
import type { BoardHeartbeatHook, FinishedReport } from "../../board-heartbeat/board-heartbeat.js";
import { BoardHookKit, GitBranchReader } from "../../board-heartbeat/board-hook-kit.js";
import { PreBashHook } from "../../pre-bash/pre-bash.js";

/** Hands work to a detached child process, so a hook never waits on the network. */
export interface BoardHookSender {
  send(session: string): void;
  sendBranch(claudeSession: string, cwd: string): void;
  sendFinished(report: FinishedReport): void;
}

export interface BoardHookServices {
  /** Decides, from the hook's stdin, whether a session is due a heartbeat, and what a stopped sub-agent reports. */
  heartbeatHook: () => BoardHeartbeatHook;
  /** Records which ticket an Agent call names. */
  dispatchHook: () => AgentDispatchHook;
  /** Sends a due heartbeat or activity line without making the hook wait. */
  sender: () => BoardHookSender;
  /** Used by the detached child to post. */
  board: () => AriadneBoard;
  /** Used by the detached child to read a main thread's branch. */
  branch: () => { read(cwd: string): string | undefined };
}

/** Builds each service from the default flight-rules core, on first use. */
export class DefaultBoardHookServices implements BoardHookServices {
  private kit: BoardHookKit | undefined;

  heartbeatHook(): BoardHeartbeatHook {
    return this.hooks().heartbeatHook();
  }

  dispatchHook(): AgentDispatchHook {
    return this.hooks().dispatchHook();
  }

  sender(): DetachedHeartbeatSender {
    return new DetachedHeartbeatSender();
  }

  board(): AriadneBoard {
    return createFlightRules().board();
  }

  branch(): GitBranchReader {
    return new GitBranchReader();
  }

  private hooks(): BoardHookKit {
    if (this.kit === undefined) {
      const core = createFlightRules();
      this.kit = new BoardHookKit({ sessions: core.boardSessions(), agents: core.boardAgents(), board: () => core.board() });
    }
    return this.kit;
  }
}

const defaultBoardServices: BoardHookServices = new DefaultBoardHookServices();

export function createHookCommand(
  getHandler: () => PreBashHook = () => new PreBashHook(),
  readStdin: () => Promise<string> = () => text(process.stdin),
  boardServices: BoardHookServices = defaultBoardServices,
): Command {
  const hook = new Command("hook").description("handlers for the plugin's Claude Code hooks");

  hook
    .command("pre-bash")
    .alias("guard-commit")
    .description(
      "PreToolUse(Bash): block a hand-written `git commit` in a flight-rules repo, and strip Claude's attribution trailers from commit and PR commands",
    )
    .exitOverride()
    .action(async () => {
      try {
        const output = getHandler().handle(JSON.parse(await readStdin()));
        if (output !== undefined) process.stdout.write(JSON.stringify(output) + "\n");
      } catch {
        // A hook must never break the agent's shell, so any failure allows the command.
        return;
      }
    });

  hook
    .command("board-heartbeat")
    .description(
      "PostToolUse: keep this run's Ariadne sessions alive, at most once a minute each: a skill's ticket, a sub-agent's ticket from its dispatch, or the main thread's ticket from its directory or branch; silent, never blocks",
    )
    .option("--send <session>", "internal: replay the session's last heartbeat (run detached by the hook)")
    .option("--branch <session>", "internal: heartbeat the ticket in the main thread's branch (run detached by the hook)")
    .option("--cwd <dir>", "internal: the main thread's working directory, with --branch")
    .exitOverride()
    .action(async (opts: { send?: string; branch?: string; cwd?: string }) => {
      try {
        if (opts.send !== undefined) {
          await boardServices.board().replay(opts.send);
          return;
        }
        if (opts.branch !== undefined) {
          const branch = opts.cwd !== undefined ? boardServices.branch().read(opts.cwd) : undefined;
          const session = branch !== undefined ? boardServices.heartbeatHook().dueForBranch(opts.branch, branch) : undefined;
          if (session !== undefined) await boardServices.board().replay(session);
          return;
        }
        const due = boardServices.heartbeatHook().due(JSON.parse(await readStdin()));
        if (due?.kind === "send") boardServices.sender().send(due.session);
        else if (due?.kind === "branch") boardServices.sender().sendBranch(due.claudeSession, due.cwd);
      } catch {
        // Reporting must never slow or break a tool call.
        return;
      }
    });

  hook
    .command("agent-dispatch")
    .description(
      "PreToolUse(Agent): remember which Jira ticket a sub-agent is dispatched for, so the heartbeat hook can report it; local only, no output, never blocks or changes the call",
    )
    .exitOverride()
    .action(async () => {
      try {
        boardServices.dispatchHook().record(JSON.parse(await readStdin()));
      } catch {
        // The Agent call goes ahead whatever happens here.
        return;
      }
    });

  hook
    .command("agent-stop")
    .description("SubagentStop: post `Finished: <description>` to the sub-agent's Ariadne session and forget the sub-agent; silent, never blocks")
    .option("--send <session>", "internal: post the activity line (run detached by the hook)")
    .option("--ticket <key>", "internal: with --send")
    .option("--text <line>", "internal: with --send")
    .option("--id <id>", "internal: with --send")
    .exitOverride()
    .action(async (opts: { send?: string; ticket?: string; text?: string; id?: string }) => {
      try {
        if (opts.send !== undefined) {
          if (opts.ticket === undefined || opts.text === undefined) return;
          await boardServices.board().activity({ session: opts.send, ticket: opts.ticket, text: opts.text, id: opts.id });
          return;
        }
        const report = boardServices.heartbeatHook().stopped(JSON.parse(await readStdin()));
        if (report !== undefined) boardServices.sender().sendFinished(report);
      } catch {
        // Reporting must never slow or break a sub-agent's stop.
        return;
      }
    });

  return hook;
}
