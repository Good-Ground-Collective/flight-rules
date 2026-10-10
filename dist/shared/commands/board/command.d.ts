import { Command } from "commander";
import type { AriadneBoard } from "../../ariadne/ariadne-board.js";
import { AriadneTokenStore } from "../../ariadne/ariadne-token-store.js";
/** Reads a secret from piped stdin, or prompts on a terminal without echoing what is typed. */
export declare class HiddenPrompt {
    read(label: string): Promise<string>;
}
/**
 * `flight-rules board`: reports this run to Ariadne's Agents page. Not
 * configured or disabled, every subcommand prints nothing and exits 0. A
 * failure is one stderr line and exit 0, or exit 1 under `--strict`.
 */
export declare function createBoardCommand(getBoard: () => AriadneBoard, getTokens?: () => AriadneTokenStore, readSecret?: () => Promise<string>): Command;
