import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { UsageHarness } from "./usage-snapshot.js";

const execFileAsync = promisify(execFile);

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

const HcTerminalSchema = z.looseObject({ address: z.string().min(1) });
const HcLabelsSchema = z.looseObject({ labels: z.record(z.string(), z.string()).optional() });
const HcListSchema = z.looseObject({
  terminals: z.array(
    z.looseObject({
      address: z.string().min(1),
      agent: z.string().optional(),
      state: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
});

const agentCommands: Record<UsageHarness, string> = { "claude-code": "claude", codex: "codex" };
const idleStatuses: ReadonlySet<string> = new Set(["idle", "done"]);

export interface HcAgentTransportProps {
  /** Command that runs this flight-rules CLI, which the waiter terminal executes. */
  flightRulesCommand?: string[];
  hcBinary?: string;
}

/** Talks to agents through `hc`, the terminal host that keeps agents and waiters alive without a multiplexer window. */
export class HcAgentTransport implements AgentTransport {
  private readonly flightRulesCommand: string[];
  private readonly hcBinary: string;

  constructor(props: HcAgentTransportProps = {}) {
    this.flightRulesCommand = props.flightRulesCommand ?? [process.execPath, process.argv[1] ?? "flight-rules"];
    this.hcBinary = props.hcBinary ?? "hc";
  }

  async spaceOf(terminal: string): Promise<string | undefined> {
    const parsed = HcLabelsSchema.parse(JSON.parse(await this.hc(["get", terminal, "--json"])));
    return parsed.labels?.["herdr.space"];
  }

  async findIdleAgent(space: string, harness: UsageHarness, except: string): Promise<string | undefined> {
    const output = await this.hc(["ls", "--json", "--label", `herdr.space=${space}`]);
    return HcListSchema.parse(JSON.parse(output)).terminals.find(
      (terminal) =>
        terminal.address !== except &&
        terminal.agent === harness &&
        terminal.state === "live" &&
        terminal.status !== undefined &&
        idleStatuses.has(terminal.status),
    )?.address;
  }

  async send(terminal: string, text: string): Promise<void> {
    await this.hc(["send", terminal, text]);
  }

  async startAgent(agent: StartedAgent): Promise<string> {
    return this.run(agent.space, agent.cwd, [agentCommands[agent.harness], agent.prompt]);
  }

  async startWaiter(space: string | undefined, cwd: string, args: readonly string[]): Promise<string> {
    return this.run(space, cwd, [...this.flightRulesCommand, ...args]);
  }

  async waitUntilIdle(terminal: string, timeoutSeconds: number): Promise<void> {
    await this.hc(["wait", terminal, "--timeout", String(timeoutSeconds)], (timeoutSeconds + 15) * 1000);
  }

  private async run(space: string | undefined, cwd: string, command: readonly string[]): Promise<string> {
    const labels = space === undefined ? [] : ["--label", `herdr.space=${space}`];
    const output = await this.hc([
      "run",
      "--bg",
      "--json",
      "--no-notify",
      "--outlive-parent",
      "--cwd",
      cwd,
      ...labels,
      "--",
      ...command,
    ]);
    return HcTerminalSchema.parse(JSON.parse(output)).address;
  }

  private async hc(args: readonly string[], timeoutMs = 20_000): Promise<string> {
    const { stdout } = await execFileAsync(this.hcBinary, [...args], { timeout: timeoutMs, encoding: "utf-8" });
    return stdout;
  }
}
