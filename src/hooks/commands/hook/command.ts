import { text } from "node:stream/consumers";
import { Command } from "commander";
import { PreBashHook } from "../../pre-bash/pre-bash.js";

export function createHookCommand(
  getHandler: () => PreBashHook = () => new PreBashHook(),
  readStdin: () => Promise<string> = () => text(process.stdin),
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

  return hook;
}
