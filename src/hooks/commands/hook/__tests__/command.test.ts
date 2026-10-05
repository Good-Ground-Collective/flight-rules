import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitGuard } from "../../../commit-guard/commit-guard.js";
import { PreBashHook } from "../../../pre-bash/pre-bash.js";
import { createHookCommand } from "../command.js";

describe("hook guard-commit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = async (
    stdin: string,
    guard = new CommitGuard({ isConfigured: () => true, env: {} }),
    subcommand = "guard-commit",
  ): Promise<string> => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createHookCommand(
      () => new PreBashHook({ guard }),
      () => Promise.resolve(stdin),
    )
      .exitOverride()
      .parseAsync([subcommand], { from: "user" });
    return output.mock.calls.map(([chunk]) => String(chunk)).join("");
  };

  it("prints a PreToolUse deny decision for a raw git commit", async () => {
    const out = await run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" }, cwd: "/repo" }));
    expect(JSON.parse(out)).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });

  it("prints nothing for an allowed command", async () => {
    expect(await run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }))).toBe("");
  });

  it("prints nothing and does not throw on invalid JSON", async () => {
    expect(await run("{not json")).toBe("");
  });

  it("pre-bash prints an updatedInput that strips Claude trailers and keeps other fields", async () => {
    const command = 'gh pr create --title t --body "$(cat <<\'EOF\'\nWhy.\n\nhttps://claude.ai/code/session_abc123\nEOF\n)"';
    const out = await run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command, description: "Open PR" } }),
      new CommitGuard({ isConfigured: () => false, env: {} }),
      "pre-bash",
    );
    const parsed = JSON.parse(out) as { hookSpecificOutput: { updatedInput: { command: string; description: string } } };
    expect(parsed.hookSpecificOutput.updatedInput.description).toBe("Open PR");
    expect(parsed.hookSpecificOutput.updatedInput.command).not.toContain("claude.ai/code/session");
    expect(parsed.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });
});
