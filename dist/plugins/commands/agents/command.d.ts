import { Command } from "commander";
import { type NativeInstallation } from "../../native-installation/native-installation.js";
export declare function createAgentsCommand(getInstallation: () => NativeInstallation): Command;
