import { execFileSync } from "node:child_process";
import type { AriadneBoard } from "../../shared/ariadne/ariadne-board.js";
import type { BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
import { AgentDispatchHook } from "./agent-dispatch-hook.js";
import { AgentTicketResolver } from "./agent-ticket-resolver.js";
import { BoardHeartbeatHook } from "./board-heartbeat.js";

export interface BoardHookKitProps {
  sessions: BoardSessionStore;
  agents: BoardAgentStore;
  /** Built only when a hook needs to know whether Ariadne is configured. */
  board: () => AriadneBoard;
}

/** Wires the board hooks to one pair of state stores. */
export class BoardHookKit {
  private readonly sessions: BoardSessionStore;
  private readonly agents: BoardAgentStore;
  private readonly board: () => AriadneBoard;
  private readonly resolver: AgentTicketResolver;

  constructor(props: BoardHookKitProps) {
    this.sessions = props.sessions;
    this.agents = props.agents;
    this.board = props.board;
    this.resolver = new AgentTicketResolver({ agents: this.agents });
  }

  heartbeatHook(): BoardHeartbeatHook {
    return new BoardHeartbeatHook({
      sessions: this.sessions,
      agents: this.agents,
      resolver: this.resolver,
      reportable: () => this.board().reportable(),
    });
  }

  dispatchHook(): AgentDispatchHook {
    return new AgentDispatchHook({ agents: this.agents, sessions: this.sessions, resolver: this.resolver });
  }
}

/** The current branch of a checkout, as git prints it; undefined outside a repo or on any failure. */
export class GitBranchReader {
  read(cwd: string): string | undefined {
    try {
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      }).trim();
      return branch === "" || branch === "HEAD" ? undefined : branch;
    } catch {
      return undefined;
    }
  }
}
