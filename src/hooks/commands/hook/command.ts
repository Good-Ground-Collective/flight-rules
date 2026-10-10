import { text } from "node:stream/consumers";
import { Command } from "commander";
import { createFlightRules } from "../../../flight-rules/flight-rules.js";
import type { AriadneBoard } from "../../../shared/ariadne/ariadne-board.js";
import { BoardHeartbeatHook, DetachedHeartbeatSender } from "../../board-heartbeat/board-heartbeat.js";
import { PreBashHook } from "../../pre-bash/pre-bash.js";

export interface BoardHookServices {
  /** Decides, from the hook's stdin, whether a session is due a heartbeat. */
  heartbeatHook: () => BoardHeartbeatHook;
  /** Sends a due heartbeat without making the hook wait. */
  sender: () => { send(session: string): void };
  /** Used by the detached sender to replay the session's last heartbeat. */
  board: () => AriadneBoard;
}

/** Builds each service from the default flight-rules core, on first use. */
export class DefaultBoardHookServices implements BoardHookServices {
  heartbeatHook(): BoardHeartbeatHook {
    return new BoardHeartbeatHook({ sessions: createFlightRules().boardSessions() });
  }

  sender(): DetachedHeartbeatSender {
    return new DetachedHeartbeatSender();
  }

  board(): AriadneBoard {
    return createFlightRules().board();
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
      "PostToolUse: keep this session alive on Ariadne's Agents page, at most once a minute, while a skill has a ticket in progress; silent, never blocks",
    )
    .option("--send <session>", "internal: replay the session's last heartbeat (run detached by the hook)")
    .exitOverride()
    .action(async (opts: { send?: string }) => {
      try {
        if (opts.send !== undefined) {
          await boardServices.board().replay(opts.send);
          return;
        }
        const session = boardServices.heartbeatHook().due(JSON.parse(await readStdin()));
        if (session !== undefined) boardServices.sender().send(session);
      } catch {
        // Reporting must never slow or break a tool call.
        return;
      }
    });

  return hook;
}
