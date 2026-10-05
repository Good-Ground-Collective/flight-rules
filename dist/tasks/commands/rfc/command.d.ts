import { Command } from "commander";
import type { Config } from "../../../shared/config.js";
export declare function createRfcCommand(getConfig: () => Config, getCwd?: () => string): Command;
