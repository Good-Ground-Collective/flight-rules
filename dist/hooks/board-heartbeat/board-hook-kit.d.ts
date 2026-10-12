import type { AriadneBoard } from "../../shared/ariadne/ariadne-board.js";
import type { BoardAgentStore } from "../../shared/ariadne/board-agent-store.js";
import type { BoardSessionStore } from "../../shared/ariadne/board-session-store.js";
import { AgentDispatchHook } from "./agent-dispatch-hook.js";
import { BoardHeartbeatHook } from "./board-heartbeat.js";
export interface BoardHookKitProps {
    sessions: BoardSessionStore;
    agents: BoardAgentStore;
    /** Built only when a hook needs to know whether Ariadne is configured. */
    board: () => AriadneBoard;
}
/** Wires the board hooks to one pair of state stores. */
export declare class BoardHookKit {
    private readonly sessions;
    private readonly agents;
    private readonly board;
    private readonly resolver;
    constructor(props: BoardHookKitProps);
    heartbeatHook(): BoardHeartbeatHook;
    dispatchHook(): AgentDispatchHook;
}
/** The current branch of a checkout, as git prints it; undefined outside a repo or on any failure. */
export declare class GitBranchReader {
    read(cwd: string): string | undefined;
}
