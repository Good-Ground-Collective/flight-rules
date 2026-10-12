import { Command } from "commander";
import type { AriadneBoard } from "../../../shared/ariadne/ariadne-board.js";
import type { AgentDispatchHook } from "../../board-heartbeat/agent-dispatch-hook.js";
import { DetachedHeartbeatSender } from "../../board-heartbeat/board-heartbeat.js";
import type { BoardHeartbeatHook, FinishedReport } from "../../board-heartbeat/board-heartbeat.js";
import { GitBranchReader } from "../../board-heartbeat/board-hook-kit.js";
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
    branch: () => {
        read(cwd: string): string | undefined;
    };
}
/** Builds each service from the default flight-rules core, on first use. */
export declare class DefaultBoardHookServices implements BoardHookServices {
    private kit;
    heartbeatHook(): BoardHeartbeatHook;
    dispatchHook(): AgentDispatchHook;
    sender(): DetachedHeartbeatSender;
    board(): AriadneBoard;
    branch(): GitBranchReader;
    private hooks;
}
export declare function createHookCommand(getHandler?: () => PreBashHook, readStdin?: () => Promise<string>, boardServices?: BoardHookServices): Command;
