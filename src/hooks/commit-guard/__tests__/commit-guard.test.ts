import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CommitGuard } from "../commit-guard.js";

const configured = new CommitGuard({ isConfigured: () => true, env: {} });
const bash = (command: string, cwd = "/repo"): unknown => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
  cwd,
});

describe("CommitGuard.commitsWithMessage", () => {
  it.each([
    'git commit -m "feat: x"',
    "git commit -F msg.txt",
    "git commit",
    "git -C sub commit -m x",
    "git -c user.name=bot commit -m x",
    "/usr/bin/git commit -m x",
    "GIT_AUTHOR_NAME=bot git commit -m x",
    "git add a.ts && git commit -m x",
    "npm test; git commit -am x",
    "(cd sub && git commit -m x)",
    'git commit --amend -m "new message"',
  ])("flags %s", (command) => {
    expect(configured.commitsWithMessage(command)).toBe(true);
  });

  it.each([
    "flight-rules git commit --type feat --scope x --description y",
    "git status",
    "git log --grep commit",
    'echo "git commit -m x is blocked"',
    "git commit --no-edit",
    "git commit --amend --no-edit",
    "git merge --no-edit origin/main",
    "FLIGHT_RULES_RAW_GIT=1 git commit -m x",
    "export FLIGHT_RULES_RAW_GIT=1; git commit -m x",
    "gh pr create --title 'git commit fix'",
  ])("allows %s", (command) => {
    expect(configured.commitsWithMessage(command)).toBe(false);
  });
});

describe("CommitGuard.decide", () => {
  it("denies with a reason naming the CLI and the bypass", () => {
    const decision = configured.decide(bash('git commit -m "fix: x"'));
    expect(decision?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(decision?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(decision?.hookSpecificOutput.permissionDecisionReason).toContain("flight-rules git commit");
    expect(decision?.hookSpecificOutput.permissionDecisionReason).toContain("FLIGHT_RULES_RAW_GIT=1");
  });

  it("allows commits in a repo without flight-rules config", () => {
    const guard = new CommitGuard({ isConfigured: () => false, env: {} });
    expect(guard.decide(bash("git commit -m x"))).toBeUndefined();
  });

  it("allows when reading config throws", () => {
    const guard = new CommitGuard({
      isConfigured: () => {
        throw new Error("bad json");
      },
      env: {},
    });
    expect(guard.decide(bash("git commit -m x"))).toBeUndefined();
  });

  it("checks CLAUDE_PROJECT_DIR in preference to the payload cwd", () => {
    const seen: string[] = [];
    const guard = new CommitGuard({
      isConfigured: (dir) => {
        seen.push(dir);
        return true;
      },
      env: { CLAUDE_PROJECT_DIR: "/project" },
    });
    guard.decide(bash("git commit -m x", "/project/sub"));
    expect(seen).toEqual(["/project"]);
  });

  it("ignores other tools and malformed payloads", () => {
    expect(configured.decide({ tool_name: "Edit", tool_input: { command: "git commit -m x" } })).toBeUndefined();
    expect(configured.decide({ tool_name: "Bash" })).toBeUndefined();
    expect(configured.decide("not an object")).toBeUndefined();
    expect(configured.decide({ tool_name: "Bash", tool_input: { command: 42 } })).toBeUndefined();
  });
});

describe("CommitGuard with the real config store", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  const setup = (withConfig: boolean): CommitGuard => {
    root = mkdtempSync(join(tmpdir(), "fr-commit-guard-"));
    const project = join(root, "project");
    mkdirSync(join(project, ".claude"), { recursive: true });
    mkdirSync(join(root, "user"));
    if (withConfig) {
      writeFileSync(
        join(project, ".claude", "settings.json"),
        JSON.stringify({ pluginConfigs: { "flight-rules@flight-rules": { options: { tracker: "github" } } } }),
      );
    }
    return new CommitGuard({ env: { CLAUDE_PROJECT_DIR: project, CLAUDE_CONFIG_DIR: join(root, "user") } });
  };

  it("denies when project settings hold flight-rules config", () => {
    expect(setup(true).decide(bash("git commit -m x"))).toBeDefined();
  });

  it("allows when no layer holds flight-rules config", () => {
    expect(setup(false).decide(bash("git commit -m x"))).toBeUndefined();
  });

  it("allows when only user settings hold flight-rules config", () => {
    const guard = setup(false);
    if (root === undefined) throw new Error("setup did not run");
    writeFileSync(
      join(root, "user", "settings.json"),
      JSON.stringify({ pluginConfigs: { "flight-rules@flight-rules": { options: { tracker: "jira" } } } }),
    );
    expect(guard.decide(bash("git commit -m x"))).toBeUndefined();
  });
});
