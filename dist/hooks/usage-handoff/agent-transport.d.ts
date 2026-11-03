import type { UsageHarness } from "./usage-snapshot.js";
export interface StartedAgent {
    harness: UsageHarness;
    space: string;
    cwd: string;
    prompt: string;
}
/** How a handoff reaches other agents and keeps a waiter alive: the terminals of one shared workspace. */
export interface AgentTransport {
    /** The Herdr space a terminal belongs to, if it belongs to one. */
    spaceOf(terminal: string): Promise<string | undefined>;
    /** An agent of `harness` in `space` that is waiting for input, other than `except`. */
    findIdleAgent(space: string, harness: UsageHarness, except: string): Promise<string | undefined>;
    send(terminal: string, text: string): Promise<void>;
    /** Starts an agent of `harness` in `space` with `prompt` and returns its terminal. */
    startAgent(agent: StartedAgent): Promise<string>;
    /** Starts a long-lived flight-rules process in its own terminal and returns it. */
    startWaiter(space: string | undefined, cwd: string, args: readonly string[]): Promise<string>;
    /** Blocks until the terminal stops working, or `timeoutSeconds` pass. */
    waitUntilIdle(terminal: string, timeoutSeconds: number): Promise<void>;
}
export interface HcAgentTransportProps {
    /** Command that runs this flight-rules CLI, which the waiter terminal executes. */
    flightRulesCommand?: string[];
    hcBinary?: string;
}
/** Talks to agents through `hc`, the terminal host that keeps agents and waiters alive without a multiplexer window. */
export declare class HcAgentTransport implements AgentTransport {
    private readonly flightRulesCommand;
    private readonly hcBinary;
    constructor(props?: HcAgentTransportProps);
    spaceOf(terminal: string): Promise<string | undefined>;
    findIdleAgent(space: string, harness: UsageHarness, except: string): Promise<string | undefined>;
    send(terminal: string, text: string): Promise<void>;
    startAgent(agent: StartedAgent): Promise<string>;
    startWaiter(space: string | undefined, cwd: string, args: readonly string[]): Promise<string>;
    waitUntilIdle(terminal: string, timeoutSeconds: number): Promise<void>;
    private run;
    private hc;
}
