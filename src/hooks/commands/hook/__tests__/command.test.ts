import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitGuard } from "../../../commit-guard/commit-guard.js";
import { createHookCommand } from "../command.js";

describe("hook guard-commit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = async (stdin: string, guard = new CommitGuard({ isConfigured: () => true, env: {} })): Promise<string> => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createHookCommand(
      () => guard,
      () => Promise.resolve(stdin),
    )
      .exitOverride()
      .parseAsync(["guard-commit"], { from: "user" });
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
});
