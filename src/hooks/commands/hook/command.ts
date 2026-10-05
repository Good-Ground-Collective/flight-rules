import { text } from "node:stream/consumers";
import { Command } from "commander";
import { CommitGuard } from "../../commit-guard/commit-guard.js";

export function createHookCommand(
  getGuard: () => CommitGuard = () => new CommitGuard(),
  readStdin: () => Promise<string> = () => text(process.stdin),
): Command {
  const hook = new Command("hook").description("handlers for the plugin's Claude Code hooks");

  hook
    .command("guard-commit")
    .description("PreToolUse(Bash): block a hand-written `git commit` in a flight-rules repo")
    .exitOverride()
    .action(async () => {
      try {
        const decision = getGuard().decide(JSON.parse(await readStdin()));
        if (decision !== undefined) process.stdout.write(JSON.stringify(decision) + "\n");
      } catch {
        // A hook must never break the agent's shell, so any failure allows the command.
        return;
      }
    });

  return hook;
}
