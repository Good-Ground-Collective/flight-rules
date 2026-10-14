import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFlightRules } from "../../flight-rules/flight-rules.js";
import { LaunchOperationAccessPolicy, MapOperationRegistry } from "../operation-registry.js";

let root: string;
let repo: string;
let bare: string;
let env: Record<string, string>;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fr-git-config-ops-"));
  repo = join(root, "repo");
  bare = join(root, "remote.git");
  mkdirSync(repo);
  env = { ...process.env, HOME: join(root, "home"), FLIGHT_RULES_HOST: "codex" };
  mkdirSync(join(root, "home"), { recursive: true });
  git(root, "init", "--bare", "-q", bare);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test User");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "remote", "add", "origin", bare);
  writeFileSync(join(repo, "tracked.txt"), "start\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-q", "-m", "initial");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("git and configuration operations", () => {
  it("runs all seven routes through validated shared handlers", async () => {
    const core = createFlightRules({ cwd: repo, env });
    const registry = new MapOperationRegistry({
      operations: core.gitConfigOperations().operations(),
      policy: new LaunchOperationAccessPolicy({
        allowedEffects: ["read", "write", "network", "process"],
      }),
    });

    await expect(
      registry.invoke("config-set", { key: "repo", values: ["acme/project"] }),
    ).resolves.toMatchObject({
      status: "success",
      data: {
        key: "repo",
        scope: "local",
        path: join(repo, ".agents", "flight-rules.settings.local.json"),
      },
    });
    await expect(
      registry.invoke("config-set", { key: "repo", values: ["acme/project"], scope: "project" }),
    ).resolves.toMatchObject({
      status: "success",
      data: { warning: expect.stringContaining("also set in local scope") },
    });
    await expect(
      registry.invoke("config-unset", { key: "repo", scope: "local" }),
    ).resolves.toMatchObject({
      status: "success",
      data: { key: "repo", scope: "local" },
    });
    await expect(
      registry.invoke("branch-name", { type: "feat", scope: "FRT-260", description: "context" }),
    ).resolves.toEqual({
      status: "success",
      data: { branch: "feat/FRT-260-context" },
    });
    await expect(
      registry.invoke("commit-message", { type: "fix", scope: "FRT-260", description: "bind git" }),
    ).resolves.toMatchObject({
      status: "success",
      data: { message: expect.stringContaining("fix(FRT-260): bind git") },
    });

    writeFileSync(join(repo, "tracked.txt"), "changed\n");
    await expect(
      registry.invoke("git-commit", {
        type: "fix",
        scope: "FRT-260",
        description: "bind git",
        files: ["tracked.txt"],
      }),
    ).resolves.toMatchObject({
      status: "success",
      data: { sha: expect.stringMatching(/^[a-f0-9]{40,}$/) },
    });
    await expect(
      registry.invoke("git-checkout", { type: "feat", scope: "FRT-260", description: "context" }),
    ).resolves.toMatchObject({
      status: "success",
      data: { branch: "feat/FRT-260-context", from: null },
    });
    await expect(registry.invoke("git-push", {})).resolves.toMatchObject({
      status: "success",
      data: { branch: "feat/FRT-260-context", remote: "origin", setUpstream: true },
    });
  });

  it("keeps config writes within launch-authorized scopes and roots", async () => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    const core = createFlightRules({
      cwd: repo,
      env,
      configWritePolicy: { scopes: ["local"], roots: [repo] },
    });
    const registry = new MapOperationRegistry({
      operations: core.gitConfigOperations().operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["write", "process"] }),
    });

    await expect(
      registry.invoke("config-set", { key: "repo", values: ["acme/project"], scope: "user" }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "LaunchConfigOperationDeniedError" },
    });
    await expect(
      registry.invoke("config-set", { key: "repo", values: ["acme/project"], scope: "file" }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "LaunchConfigOperationDeniedError" },
    });
    const escapingCore = createFlightRules({
      cwd: repo,
      env,
      configWritePolicy: { scopes: ["local"], roots: [outside] },
    });
    const escapingRegistry = new MapOperationRegistry({
      operations: escapingCore.gitConfigOperations().operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["write", "process"] }),
    });
    await expect(
      escapingRegistry.invoke("config-set", {
        key: "repo",
        values: ["acme/project"],
        scope: "local",
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "LaunchConfigOperationDeniedError" },
    });
  });

  it("rejects a dangling settings symlink before creating its outside target", async () => {
    const settingsDirectory = join(repo, ".agents");
    const outsideTarget = join(root, "outside", "settings.json");
    mkdirSync(settingsDirectory);
    symlinkSync(outsideTarget, join(settingsDirectory, "flight-rules.settings.local.json"));
    const core = createFlightRules({
      cwd: repo,
      env,
      configWritePolicy: { scopes: ["local"], roots: [repo] },
    });
    const registry = new MapOperationRegistry({
      operations: core.gitConfigOperations().operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["write", "process"] }),
    });

    await expect(
      registry.invoke("config-set", { key: "repo", values: ["acme/project"], scope: "local" }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "LaunchConfigOperationDeniedError" },
    });
    expect(existsSync(outsideTarget)).toBe(false);
  });

  it("keeps authorized roots fixed when the checkout path is replaced", async () => {
    const outsideSettingsDirectory = join(root, "outside", ".agents");
    const outsideSettingsPath = join(outsideSettingsDirectory, "flight-rules.settings.local.json");
    mkdirSync(outsideSettingsDirectory, { recursive: true });
    writeFileSync(outsideSettingsPath, '{"repo":"acme/original"}\n');

    const core = createFlightRules({
      cwd: repo,
      env,
      configWritePolicy: { scopes: ["local"], roots: [repo] },
    });
    const registry = new MapOperationRegistry({
      operations: core.gitConfigOperations().operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["write", "process"] }),
    });

    renameSync(repo, join(root, "original-repo"));
    symlinkSync(join(root, "outside"), repo, "dir");

    for (const operation of ["config-set", "config-unset"] as const) {
      await expect(
        registry.invoke(
          operation,
          operation === "config-set"
            ? { key: "repo", values: ["acme/changed"], scope: "local" }
            : { key: "repo", scope: "local" },
        ),
      ).resolves.toMatchObject({
        status: "error",
        error: { name: "LaunchConfigOperationDeniedError" },
      });
    }

    expect(readFileSync(outsideSettingsPath, "utf8")).toBe('{"repo":"acme/original"}\n');
  });

  it("runs concurrent git instances from their own launch checkout", async () => {
    const second = join(root, "second");
    mkdirSync(second);
    git(second, "init", "-q", "-b", "other");
    git(
      second,
      "-c",
      "user.name=Test User",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "initial",
    );
    const firstCore = createFlightRules({ cwd: repo, env });
    const secondCore = createFlightRules({ cwd: second, env });
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const branches = await Promise.all([
        firstCore.git().getCurrentBranch(),
        secondCore.git().getCurrentBranch(),
      ]);
      expect(branches).toEqual(["main", "other"]);
      expect(process.cwd()).toBe(realpathSync(root));
    } finally {
      process.chdir(originalCwd);
    }
  });
});
