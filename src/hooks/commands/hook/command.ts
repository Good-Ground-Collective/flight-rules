import { text } from "node:stream/consumers";
import { Command } from "commander";
import { PreBashHook } from "../../pre-bash/pre-bash.js";
import { SubagentHarnessSchema, SubagentStatusRecorder } from "../../subagent-status/subagent-status.js";
import { UsageHandoffHook } from "../../usage-handoff/usage-handoff.js";
import { UsageHarnessSchema } from "../../usage-handoff/usage-snapshot.js";

export function createHookCommand(
  getHandler: () => PreBashHook = () => new PreBashHook(),
  readStdin: () => Promise<string> = () => text(process.stdin),
  getStatusRecorder: () => SubagentStatusRecorder = () => new SubagentStatusRecorder(),
  getUsageHandoff: () => UsageHandoffHook = () => new UsageHandoffHook(),
): Command {
  const hook = new Command("hook").description("handlers for the plugin's Claude Code hooks");

  hook
    .command("pre-bash")
    .alias("guard-commit")
    .description(
      "PreToolUse(Bash): block a hand-written `git commit` in a flight-rules repo, and strip Claude's attribution trailers from commit and PR commands",
    )
    .exitOverride()
    .action(async () => {
      try {
        const output = getHandler().handle(JSON.parse(await readStdin()));
        if (output !== undefined) process.stdout.write(JSON.stringify(output) + "\n");
      } catch {
        // A hook must never break the agent's shell, so any failure allows the command.
        return;
      }
    });

  hook
    .command("subagent-status")
    .description(
      "SubagentStart, SubagentStop, StopFailure, PostToolUse and SessionEnd: keep a status file per sub-agent under $XDG_STATE_HOME/flight-rules/agents for terminal multiplexers; Claude Code and Codex; local only, no output, never blocks",
    )
    .option("--harness <harness>", "the host running the hook: claude-code or codex", "claude-code")
    .exitOverride()
    .action(async (opts: { harness: string }) => {
      try {
        const harness = SubagentHarnessSchema.safeParse(opts.harness);
        if (!harness.success) return;
        getStatusRecorder().handle(harness.data, JSON.parse(await readStdin()));
      } catch {
        // A status file is never worth slowing or breaking the agent.
        return;
      }
    });

  hook
    .command("usage-handoff")
    .description(
      "Stop: when this harness's session or weekly usage nears its limit, hand the unfinished work to the other harness over hc and take it back at the reset; Claude Code and Codex; never fails the session",
    )
    .option("--harness <harness>", "the host running the hook: claude-code or codex", "claude-code")
    .exitOverride()
    .action(async (opts: { harness: string }) => {
      try {
        const harness = UsageHarnessSchema.safeParse(opts.harness);
        if (!harness.success) return;
        const output = await getUsageHandoff().handle(harness.data, JSON.parse(await readStdin()));
        if (output !== undefined) process.stdout.write(JSON.stringify(output) + "\n");
      } catch {
        // A usage handoff is never worth failing the session over, so any error lets Stop proceed.
        return;
      }
    });

  return hook;
}
