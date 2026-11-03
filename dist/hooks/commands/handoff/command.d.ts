import { Command } from "commander";
import { type AgentTransport } from "../../usage-handoff/agent-transport.js";
export declare function createHandoffCommand(getTransport?: () => AgentTransport): Command;
