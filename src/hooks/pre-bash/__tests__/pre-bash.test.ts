import { describe, expect, it } from "vitest";
import { CommitGuard } from "../../commit-guard/commit-guard.js";
import { PreBashHook } from "../pre-bash.js";

const bash = (command: string): unknown => ({ tool_name: "Bash", tool_input: { command, timeout: 1000 }, cwd: "/repo" });
const trailer = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";

describe("PreBashHook", () => {
  it("denies a raw commit in a flight-rules repo before stripping anything", () => {
    const hook = new PreBashHook({ guard: new CommitGuard({ isConfigured: () => true, env: {} }) });
    const out = hook.handle(bash(`git commit -m "fix: x\n\n${trailer}"`));
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("strips attribution from a commit outside a flight-rules repo and keeps other input fields", () => {
    const hook = new PreBashHook({ guard: new CommitGuard({ isConfigured: () => false, env: {} }) });
    expect(hook.handle(bash(`git commit -m "fix: x\n\n${trailer}"`))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: 'git commit -m "fix: x"', timeout: 1000 },
      },
    });
  });

  it("strips attribution from a bypassed commit in a flight-rules repo", () => {
    const hook = new PreBashHook({ guard: new CommitGuard({ isConfigured: () => true, env: {} }) });
    const out = hook.handle(bash(`FLIGHT_RULES_RAW_GIT=1 git commit -m "fix: x\n\n${trailer}"`));
    expect(out).toMatchObject({ hookSpecificOutput: { updatedInput: { command: 'FLIGHT_RULES_RAW_GIT=1 git commit -m "fix: x"' } } });
  });

  it("returns nothing for commands with nothing to change", () => {
    const hook = new PreBashHook({ guard: new CommitGuard({ isConfigured: () => false, env: {} }) });
    expect(hook.handle(bash("git status"))).toBeUndefined();
    expect(hook.handle(bash('git commit -m "fix: x"'))).toBeUndefined();
    expect(hook.handle({ tool_name: "Edit" })).toBeUndefined();
  });
});
