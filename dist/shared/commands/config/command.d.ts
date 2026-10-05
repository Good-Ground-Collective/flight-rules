import { Command } from "commander";
import type { ConfigStore } from "../../config-store.js";
export declare function createConfigCommand(getStore: () => ConfigStore): Command;
