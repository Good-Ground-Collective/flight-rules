import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import type { RuntimeSnapshot } from "../../../orchestration/orchestration.schema.js";
import type { CapabilityToolDeniedError } from "../../worker-runtime-core.js";
import {
  CapabilityScopedClaudeToolPolicy,
  HostToolExecutionTracker,
  type WorkerHostTool,
} from "../tool-policy.js";

const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../../agents", import.meta.url)),
);
const definition = (name: string) => {
  const found = agents.find((agent) => agent.frontmatter.name === name);
  if (found === undefined) throw new Error(`missing ${name}`);
  return found;
};
const available = { state: "available", evidence: "Observed." } as const;
const denied = { state: "denied", evidence: "Blocked.", remedy: "Grant it." } as const;
const snapshot = (overrides: Partial<RuntimeSnapshot["permissions"]> = {}): RuntimeSnapshot => ({
  context: {
    runId: "r",
    taskId: "t",
    cwd: "/repo",
    repositoryRoot: "/repo",
    baseRef: "main",
    skill: "execute-work",
    attempt: 1,
  },
  host: { name: "h", version: "1" },
  observedAt: new Date().toISOString(),
  agent: "a",
  spawn: available,
  ask: available,
  permissions: {
    read: available,
    edit: available,
    shell: available,
    web: available,
    spawn: available,
    ask: available,
    ...overrides,
  },
  limits: { maxConcurrent: 1, activeWorkers: 0, currentDepth: 0, maxDepth: 1, source: "test" },
});
const tool = (name: string): WorkerHostTool => ({
  name,
  description: name,
  inputSchema: {},
  handler: async () => "ok",
});

describe("CapabilityScopedClaudeToolPolicy", () => {
  const policy = new CapabilityScopedClaudeToolPolicy();

  it("maps only capabilities both registered and observed available to built-in tools", () => {
    expect(policy.builtInToolsFor(definition("tech-writer"), snapshot())).toEqual([
      "Glob",
      "Grep",
      "Read",
    ]);
    expect(policy.builtInToolsFor(definition("code-implementation"), snapshot())).toEqual([
      "Glob",
      "Grep",
      "Read",
      "Write",
      "Edit",
      "Bash",
    ]);
    expect(
      policy.builtInToolsFor(definition("code-implementation"), snapshot({ shell: denied })),
    ).toEqual(["Glob", "Grep", "Read", "Write", "Edit"]);
  });

  it("selects host tools by effective capability and allowlists them under the host server", () => {
    const grants = { read: [tool("lookup")], edit: [tool("publish")], web: [tool("search")] };

    const hostTools = policy.hostToolsFor(
      definition("research-agent"),
      grants,
      snapshot({ web: denied }),
    );

    expect(hostTools.map((hostTool) => hostTool.name)).toEqual(["lookup"]);
    expect(policy.allowlistFor(["Read"], hostTools)).toEqual([
      "Read",
      "mcp__flight-rules-host__lookup",
    ]);
  });

  it("denies unlisted tools through both the hook and the permission backstop", async () => {
    const denials: CapabilityToolDeniedError[] = [];
    const guard = policy.guardFor({
      allowedTools: ["Read"],
      cwd: "/repo",
      repositoryRoot: "/repo",
      onDenied: (error) => denials.push(error),
    });
    const hookInput = (name: string, input: unknown) =>
      ({
        hook_event_name: "PreToolUse",
        tool_name: name,
        tool_input: input,
        tool_use_id: "id",
        session_id: "s",
        transcript_path: "/dev/null",
        cwd: "/repo",
      }) as const;

    expect(await guard.preToolUse(hookInput("Read", { file_path: "/repo/a.ts" }))).toEqual({});
    expect(await guard.preToolUse(hookInput("Write", { file_path: "/repo/a.ts" }))).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
    expect(await guard.canUseTool("Read", { file_path: "/repo/a.ts" })).toMatchObject({
      behavior: "allow",
    });
    expect(await guard.canUseTool("Bash", { command: "ls" })).toMatchObject({
      behavior: "deny",
    });
    expect(
      await guard.preToolUse({ ...hookInput("Write", {}), hook_event_name: "Stop" } as never),
    ).toEqual({});
    expect(denials.map((error) => error.capability)).toEqual(["edit", "shell"]);
  });

  it("confines built-in paths, globs and symlinks to the repository root", async () => {
    const base = mkdtempSync(join(tmpdir(), "claude-guard-"));
    const repository = join(base, "repo");
    const outside = join(base, "outside");
    mkdirSync(repository);
    mkdirSync(outside);
    symlinkSync(outside, join(repository, "link"));
    const denials: CapabilityToolDeniedError[] = [];
    const guard = policy.guardFor({
      allowedTools: ["Read", "Glob", "Grep", "Write"],
      cwd: repository,
      repositoryRoot: repository,
      onDenied: (error) => denials.push(error),
    });
    const check = async (name: string, input: Record<string, unknown>) =>
      (await guard.canUseTool(name, input)).behavior;

    expect(await check("Read", { file_path: join(repository, "src", "new.ts") })).toBe("allow");
    expect(await check("Write", { file_path: "docs/new.md" })).toBe("allow");
    expect(await check("Grep", { pattern: "x", path: "src", glob: "**/*.ts" })).toBe("allow");
    expect(await check("Read", { file_path: join(outside, "secret.txt") })).toBe("deny");
    expect(await check("Read", { file_path: "../outside/secret.txt" })).toBe("deny");
    expect(await check("Read", { file_path: "link/secret.txt" })).toBe("deny");
    expect(await check("Write", { file_path: "~/.ssh/config" })).toBe("deny");
    expect(await check("Glob", { pattern: "../**/*.ts" })).toBe("deny");
    expect(await check("Glob", { pattern: "/etc/**" })).toBe("deny");
    expect(await check("Grep", { pattern: "x", glob: "/etc/*.conf" })).toBe("deny");
    expect(denials).toHaveLength(7);
    expect(denials[0]?.message).toContain("outside the repository root");
  });

  it("keeps every host tool promise tracked until it settles", async () => {
    const tracker = new HostToolExecutionTracker();
    let release: (() => void) | undefined;
    const pending = tracker.track(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let idle = false;
    const waiting = tracker.waitForIdle().then(() => {
      idle = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(idle).toBe(false);
    release?.();
    await pending;
    await waiting;

    expect(idle).toBe(true);
    tracker.recordFailure(new Error("first"));
    tracker.recordFailure(new Error("second"));
    expect(tracker.failure()?.cause).toEqual(new Error("first"));
  });
});
