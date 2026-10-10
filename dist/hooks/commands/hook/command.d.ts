import { Command } from "commander";
import type { AriadneBoard } from "../../../shared/ariadne/ariadne-board.js";
import { BoardHeartbeatHook, DetachedHeartbeatSender } from "../../board-heartbeat/board-heartbeat.js";
import { PreBashHook } from "../../pre-bash/pre-bash.js";
export interface BoardHookServices {
    /** Decides, from the hook's stdin, whether a session is due a heartbeat. */
    heartbeatHook: () => BoardHeartbeatHook;
    /** Sends a due heartbeat without making the hook wait. */
    sender: () => {
        send(session: string): void;
    };
    /** Used by the detached sender to replay the session's last heartbeat. */
    board: () => AriadneBoard;
}
/** Builds each service from the default flight-rules core, on first use. */
export declare class DefaultBoardHookServices implements BoardHookServices {
    heartbeatHook(): BoardHeartbeatHook;
    sender(): DetachedHeartbeatSender;
    board(): AriadneBoard;
}
export declare function createHookCommand(getHandler?: () => PreBashHook, readStdin?: () => Promise<string>, boardServices?: BoardHookServices): Command;
