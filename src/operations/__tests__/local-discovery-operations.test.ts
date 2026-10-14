import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlightRules } from "../../flight-rules/flight-rules.js";
import { buildProgram } from "../../cli/cli.js";
import { LaunchOperationAccessPolicy, MapOperationRegistry } from "../operation-registry.js";
import type { ReadinessReport } from "../../tasks/readiness/readiness.schema.js";
import { DocCharterCatalog } from "../../bundled-docs/charter-catalog/charter-catalog.js";
import { GitRepositoryPaths } from "../../bundled-docs/charter-catalog/repository-paths.js";
import { DefaultLocalDiscoveryOperations } from "../local-discovery-operations.js";

let root: string;
let configPath: string;
let core: ReturnType<typeof createFlightRules>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flight-rules-local-operations-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "home"));
  configPath = join(root, ".agents", "flight-rules.local.md");
  mkdirSync(join(root, ".agents"));
  writeFileSync(
    configPath,
    "---\ntracker: github\nrepo: acme/project\ncompetencies:\n  - fixture-skill\n---\n",
  );
  core = createFlightRules({
    cwd: root,
    configPath,
    host: "codex",
    env: {
      FLIGHT_RULES_HOST: "codex",
      HOME: join(root, "home"),
      FLIGHT_RULES_CONFIG: configPath,
      FLIGHT_RULES_HOME: process.cwd(),
    },
  });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const registryFor = (operations = core.localOperations().operations()) =>
  new MapOperationRegistry({
    operations,
    policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "process", "network"] }),
  });

describe("local discovery operations", () => {
  it("serves all ten migrated routes with structured results and no tracker credentials", async () => {
    const registry = registryFor();
    const charter = await registry.invoke("charter", { paths: ["src/sample.ts"] });
    expect(charter).toMatchObject({
      status: "success",
      data: {
        charters: expect.arrayContaining([
          expect.objectContaining({ language: null }),
          expect.objectContaining({ language: "typescript" }),
        ]),
      },
    });

    await expect(registry.invoke("competencies", {})).resolves.toMatchObject({
      status: "success",
      data: ["fixture-skill"],
    });
    await expect(registry.invoke("rfc-dir", {})).resolves.toMatchObject({
      status: "success",
      data: { path: join(root, "rfcs") },
    });
    await expect(registry.invoke("rfc-next-id", {})).resolves.toMatchObject({
      status: "success",
      data: { id: "RFC-001" },
    });
    await expect(registry.invoke("qa-instructions", {})).resolves.toMatchObject({
      status: "success",
      data: { found: false, sources: [] },
    });

    writeFileSync(join(root, "QA.md"), "Exercise the fixture application.");
    await expect(registry.invoke("qa-instructions", {})).resolves.toMatchObject({
      status: "success",
      data: { found: true },
    });
    await expect(registry.invoke("qa-recipe", {})).resolves.toMatchObject({
      status: "success",
      data: { path: join(root, "QA.md") },
    });
    await expect(registry.invoke("qa-evidence-dir", { ticket: "FRT-8" })).resolves.toMatchObject({
      status: "success",
      data: { path: join(root, ".agents", "evidence", "FRT-8") },
    });
    await expect(registry.invoke("config-path", {})).resolves.toMatchObject({
      status: "success",
      data: { path: configPath },
    });
    await expect(registry.invoke("config-show", {})).resolves.toMatchObject({
      status: "success",
      data: { valid: true, sources: { tracker: { path: configPath } } },
    });

    const nextRfcDirectory = join(root, "rfcs");
    mkdirSync(nextRfcDirectory);
    writeFileSync(join(nextRfcDirectory, "RFC-009.md"), "# Design");
    await expect(registry.invoke("rfc-next-id", {})).resolves.toMatchObject({
      status: "success",
      data: { id: "RFC-010" },
    });
  });

  it("resolves relative QA starts from its launch checkout", async () => {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "QA.md"), "Launch checkout QA notes.");

    const registry = registryFor();
    await expect(registry.invoke("qa-instructions", { from: "sub" })).resolves.toMatchObject({
      status: "success",
      data: {
        found: true,
        sources: [{ path: join(root, "sub", "QA.md"), content: "Launch checkout QA notes." }],
      },
    });
  });

  it("rejects incomplete effect grants before resolving local services", async () => {
    const getConfig = vi.fn(() => core.config());
    const getConfigStore = vi.fn(() => core.configStore());
    const getCharters = vi.fn(() => new DocCharterCatalog({ docs: core.docs() }));
    const getRepositoryPaths = vi.fn(() => new GitRepositoryPaths({ cwd: root }));
    const getEvidence = vi.fn(() => core.evidence());
    const getReadiness = vi.fn(() => core.readiness());
    const getProbe = vi.fn(() => core.probe());
    const getTracker = vi.fn(() => core.tracker());
    const getConfigPath = vi.fn(() => core.configPath());
    const operations = new DefaultLocalDiscoveryOperations({
      cwd: root,
      getConfig,
      getConfigStore,
      getCharters,
      getRepositoryPaths,
      getEvidence,
      getReadiness,
      getProbe,
      getTracker,
      getConfigPath,
    });
    const readOnlyRegistry = new MapOperationRegistry({
      operations: operations.operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });
    const routes = [
      ["charter", { paths: ["sample.ts"] }],
      ["competencies", {}],
      ["rfc-dir", {}],
      ["rfc-next-id", {}],
      ["qa-instructions", {}],
      ["qa-evidence-dir", { ticket: "FRT-256" }],
      ["qa-recipe", {}],
      ["config-path", {}],
      ["config-show", {}],
      ["check", {}],
    ] as const;

    for (const [id, input] of routes) {
      await expect(readOnlyRegistry.invoke(id, input)).resolves.toMatchObject({
        status: "error",
        error: { name: "OperationAccessDeniedError" },
      });
    }
    const processOnlyRegistry = new MapOperationRegistry({
      operations: operations.operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["process"] }),
    });
    await expect(
      processOnlyRegistry.invoke("charter", { paths: ["sample.ts"] }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationAccessDeniedError" },
    });

    for (const service of [
      getConfig,
      getConfigStore,
      getCharters,
      getRepositoryPaths,
      getEvidence,
      getReadiness,
      getProbe,
      getTracker,
      getConfigPath,
    ])
      expect(service).not.toHaveBeenCalled();
  });

  it("preserves blank QA recipe errors in operations and migrated CLI routes", async () => {
    const legacyPath = join(root, "home", "legacy-qa.md");
    writeFileSync(legacyPath, "Legacy capture steps.");
    writeFileSync(
      configPath,
      `---\ntracker: github\nrepo: acme/project\nqaRecipe: ${JSON.stringify(legacyPath)}\n---\n`,
    );
    const registry = registryFor();
    await expect(registry.invoke("qa-instructions", {})).resolves.toMatchObject({
      status: "success",
      data: {
        found: true,
        sources: [{ path: legacyPath, kind: "legacy-recipe", legacy: true }],
      },
    });

    const expectedDiagnostic =
      "qaRecipe is set to a blank value — remove the key and move the recipe into a QA.md (see docs/qa-instructions.md)";

    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    const services = {
      git: () => core.git(),
      gitConfigOperations: () => core.gitConfigOperations(),
      probe: () => ({ probe: vi.fn(async () => []) }),
      readiness: () => core.readiness(),
      docs: () => core.docs(),
      configStore: () => core.configStore(),
      installation: () => core.installation(),
      evidence: () => core.evidence(),
      board: () => core.board(),
      packets: () => core.packets(),
      ariadneTokens: () => core.ariadneTokens(),
      boardSessions: () => core.boardSessions(),
      boardAgents: () => core.boardAgents(),
      reviewOperations: () => core.reviewOperations(),
    };
    const program = buildProgram(
      (override) => core.tracker(override),
      (override) => core.config(override),
      (override) => core.prHost(override),
      () => core.configPath(),
      services,
    );
    try {
      for (const recipe of ["", "   "]) {
        writeFileSync(
          configPath,
          `---\ntracker: github\nrepo: acme/project\nqaRecipe: ${JSON.stringify(recipe)}\n---\n`,
        );
        for (const id of ["qa-instructions", "qa-recipe"] as const) {
          await expect(registry.invoke(id, {})).resolves.toMatchObject({
            status: "error",
            error: { name: "BlankQaRecipeError", message: expectedDiagnostic },
          });
        }
        for (const route of [
          ["qa", "instructions"],
          ["qa", "recipe"],
        ]) {
          await expect(program.parseAsync(route, { from: "user" })).rejects.toMatchObject({
            message: expectedDiagnostic,
          });
        }
      }
    } finally {
      cwd.mockRestore();
    }
  });

  it("returns failed readiness checks as validated data and rejects malformed evidence before probing", async () => {
    const failedReport: ReadinessReport = {
      tracker: "github",
      repo: "acme/project",
      checks: [{ name: "credentials", ok: false, detail: "missing token" }],
      ok: false,
      scope: "workflow",
      workflow: "execute-work",
    };
    const operations = new (
      await import("../local-discovery-operations.js")
    ).DefaultLocalDiscoveryOperations({
      cwd: root,
      getConfig: () => core.config(),
      getConfigStore: () => core.configStore(),
      getCharters: () => {
        throw new Error("not used");
      },
      getRepositoryPaths: () => {
        throw new Error("not used");
      },
      getEvidence: () => core.evidence(),
      getReadiness: () => ({ inspect: async () => failedReport }),
      getProbe: () => ({ probe: vi.fn(async () => []) }),
      getTracker: () => {
        throw new Error("not authorized by evidence");
      },
      getConfigPath: () => core.configPath(),
    });
    const registry = registryFor(operations.operations());
    await expect(registry.invoke("check", { workflow: "execute-work" })).resolves.toMatchObject({
      status: "success",
      data: { ok: false, checks: [{ name: "credentials", ok: false }] },
    });
    await expect(
      registry.invoke("check", {
        workflow: "execute-work",
        evidence: { context: {}, callerCapabilities: {}, workers: [] },
      }),
    ).rejects.toThrow(/Invalid input/);
  });

  it("keeps the migrated Commander routes aligned with their operation results", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    const failedReadiness: ReadinessReport = {
      tracker: "github",
      repo: "acme/project",
      checks: [{ name: "credentials", ok: false, detail: "missing token" }],
      ok: false,
      scope: "workflow",
    };
    const services = {
      git: () => core.git(),
      gitConfigOperations: () => core.gitConfigOperations(),
      probe: () => ({ probe: vi.fn(async () => []) }),
      readiness: () => ({ inspect: async () => failedReadiness }),
      docs: () => core.docs(),
      configStore: () => core.configStore(),
      installation: () => core.installation(),
      evidence: () => core.evidence(),
      board: () => core.board(),
      packets: () => core.packets(),
      ariadneTokens: () => core.ariadneTokens(),
      boardSessions: () => core.boardSessions(),
      boardAgents: () => core.boardAgents(),
      reviewOperations: () => core.reviewOperations(),
    };
    const program = buildProgram(
      (override) => core.tracker(override),
      (override) => core.config(override),
      (override) => core.prHost(override),
      () => core.configPath(),
      services,
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const expected = registryFor();
    try {
      await program.parseAsync(["qa", "instructions"], { from: "user" });
      expect(output).toHaveBeenLastCalledWith('{"found":false,"sources":[]}\n');
      await expect(expected.invoke("qa-instructions", {})).resolves.toMatchObject({
        status: "success",
        data: { found: false, sources: [] },
      });
      writeFileSync(join(root, "QA.md"), "Fixture QA notes.");

      const charter = await expected.invoke("charter", { paths: ["sample.ts"] });
      await program.parseAsync(["charter", "sample.ts", "--path"], { from: "user" });
      expect(charter.status).toBe("success");
      expect(output).toHaveBeenLastCalledWith(
        expect.stringContaining("coding-charter-typescript.md"),
      );

      const routes = [
        [["competencies"], "competencies", {}],
        [["rfc", "dir"], "rfc-dir", {}],
        [["rfc", "next-id"], "rfc-next-id", {}],
        [["qa", "instructions"], "qa-instructions", {}],
        [["qa", "evidence-dir", "FRT-8"], "qa-evidence-dir", { ticket: "FRT-8" }],
        [["qa", "recipe"], "qa-recipe", {}],
        [["config", "path"], "config-path", {}],
        [["config", "show"], "config-show", {}],
      ] as const;
      for (const [route, operationId, input] of routes) {
        const previousCalls = output.mock.calls.length;
        await program.parseAsync([...route], { from: "user" });
        expect(output.mock.calls.length).toBe(previousCalls + 1);
        await expect(expected.invoke(operationId, input)).resolves.toMatchObject({
          status: "success",
        });
      }
      await program.parseAsync(["config", "set", "repo", "acme/cli", "--scope", "local"], {
        from: "user",
      });
      expect(output).toHaveBeenLastCalledWith(
        expect.stringMatching(/^\{"key":"repo","scope":"local","path":.+\}\n$/),
      );
      await program.parseAsync(["config", "unset", "repo", "--scope", "local"], {
        from: "user",
      });
      expect(output).toHaveBeenLastCalledWith(
        expect.stringMatching(/^\{"key":"repo","scope":"local","path":.+\}\n$/),
      );
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
      await expect(program.parseAsync(["check"], { from: "user" })).rejects.toMatchObject({
        name: "ReadinessFailedError",
      });
      expect(output).toHaveBeenLastCalledWith(expect.stringContaining('"ok":false'));
    } finally {
      output.mockRestore();
      errors.mockRestore();
      cwd.mockRestore();
    }
  });

  it("matches all seven config and git CLI routes to their authorized shared results", async () => {
    const repo = join(root, "cli-parity-repo");
    const home = join(root, "cli-parity-home");
    const remote = join(root, "cli-parity-remote.git");
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(repo);
    const invoke = vi.spyOn(MapOperationRegistry.prototype, "invoke");

    mkdirSync(repo);
    mkdirSync(home);
    execFileSync("git", ["init", "--bare", "--quiet", remote], { cwd: root });
    execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "CLI Parity"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "cli-parity@example.invalid"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: repo });
    writeFileSync(join(repo, "tracked.txt"), "initial\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repo });
    writeFileSync(join(repo, "tracked.txt"), "changed by parity test\n");

    const parityConfigPath = join(repo, ".agents", "flight-rules.local.md");
    mkdirSync(join(repo, ".agents"));
    writeFileSync(parityConfigPath, "---\ntracker: github\nrepo: acme/project\n---\n");
    const parityCore = createFlightRules({
      cwd: repo,
      configPath: parityConfigPath,
      host: "codex",
      env: {
        FLIGHT_RULES_HOST: "codex",
        HOME: home,
        FLIGHT_RULES_HOME: process.cwd(),
      },
    });
    const services = {
      git: () => parityCore.git(),
      gitConfigOperations: (policy: Parameters<typeof parityCore.gitConfigOperations>[0]) =>
        parityCore.gitConfigOperations(policy),
      probe: () => parityCore.probe(),
      readiness: () => parityCore.readiness(),
      docs: () => parityCore.docs(),
      configStore: () => parityCore.configStore(),
      reviewOperations: (props: Parameters<typeof parityCore.reviewOperations>[0]) =>
        parityCore.reviewOperations(props),
      installation: () => parityCore.installation(),
      evidence: () => parityCore.evidence(),
      board: () => parityCore.board(),
      packets: () => parityCore.packets(),
      ariadneTokens: () => parityCore.ariadneTokens(),
      boardSessions: () => parityCore.boardSessions(),
      boardAgents: () => parityCore.boardAgents(),
    };
    const program = buildProgram(
      (override) => parityCore.tracker(override),
      (override) => parityCore.config(override),
      (override) => parityCore.prHost(override),
      () => parityCore.configPath(),
      services,
    );

    const runAndCompare = async (args: string[], operationId: string) => {
      const invocationIndex = invoke.mock.calls.length;
      await program.parseAsync(args, { from: "user" });
      expect(invoke.mock.calls).toHaveLength(invocationIndex + 1);
      expect(invoke.mock.calls[invocationIndex]?.[0]).toBe(operationId);
      const invocation = invoke.mock.results[invocationIndex];
      if (invocation?.type !== "return") throw new Error(`No shared result for ${operationId}`);
      const result = await invocation.value;
      expect(result.status).toBe("success");
      if (result.status !== "success") throw new Error(`Operation ${operationId} was denied`);
      const rendered = JSON.parse(String(output.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
      return { data: result.data, rendered };
    };

    try {
      const configSet = await runAndCompare(
        ["config", "set", "repo", "acme/cli", "--scope", "local"],
        "config-set",
      );
      expect(configSet.rendered).toEqual(configSet.data);

      const configUnset = await runAndCompare(
        ["config", "unset", "repo", "--scope", "local"],
        "config-unset",
      );
      expect(configUnset.rendered).toEqual(configUnset.data);

      const commit = await runAndCompare(
        [
          "git",
          "commit",
          "--file",
          "tracked.txt",
          "--type",
          "fix",
          "--scope",
          "FRT-260",
          "--description",
          "registry parity",
        ],
        "git-commit",
      );
      expect(commit.rendered).toEqual(commit.data);

      const checkout = await runAndCompare(
        [
          "git",
          "checkout",
          "--type",
          "feat",
          "--scope",
          "FRT-260",
          "--description",
          "registry-parity",
        ],
        "git-checkout",
      );
      expect(checkout.rendered).toEqual(checkout.data);

      const push = await runAndCompare(["git", "push"], "git-push");
      expect(push.rendered).toEqual(push.data);

      const messagePath = join(root, "cli-parity-message.txt");
      const message = await runAndCompare(
        [
          "commit-message",
          "--type",
          "fix",
          "--scope",
          "FRT-260",
          "--description",
          "registry parity",
          "--out",
          messagePath,
        ],
        "commit-message",
      );
      expect(message.rendered["message"]).toBe((message.data as { message: string }).message);
      expect(readFileSync(messagePath, "utf8")).toBe(`${message.rendered["message"]}\n`);

      const branchName = await runAndCompare(
        ["branch-name", "--type", "feat", "--scope", "FRT-260", "--description", "registry-parity"],
        "branch-name",
      );
      expect(branchName.rendered).toEqual(branchName.data);
    } finally {
      invoke.mockRestore();
      output.mockRestore();
      cwd.mockRestore();
    }
  });

  it("compares evidence-directory CLI and operation results from a linked worktree", async () => {
    const mainCheckout = join(root, "main-checkout");
    const linkedCheckout = join(root, "linked-checkout");
    mkdirSync(join(mainCheckout, ".agents"), { recursive: true });
    writeFileSync(
      join(mainCheckout, ".agents", "flight-rules.local.md"),
      "---\ntracker: github\nrepo: acme/project\n---\n",
    );
    writeFileSync(join(mainCheckout, ".gitignore"), ".agents/evidence/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: mainCheckout });
    execFileSync("git", ["config", "user.name", "Fixture User"], { cwd: mainCheckout });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: mainCheckout });
    execFileSync("git", ["add", ".gitignore", ".agents/flight-rules.local.md"], {
      cwd: mainCheckout,
    });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: mainCheckout });
    execFileSync("git", ["worktree", "add", "--quiet", "-b", "linked", linkedCheckout], {
      cwd: mainCheckout,
    });

    const linkedCore = createFlightRules({
      cwd: linkedCheckout,
      host: "codex",
      env: {
        FLIGHT_RULES_HOST: "codex",
        HOME: join(root, "home"),
        FLIGHT_RULES_HOME: process.cwd(),
      },
    });
    const originalCwd = vi.spyOn(process, "cwd").mockReturnValue(linkedCheckout);
    const resolvedMainCheckout = realpathSync(mainCheckout);
    const services = {
      git: () => linkedCore.git(),
      gitConfigOperations: () => linkedCore.gitConfigOperations(),
      probe: () => ({ probe: vi.fn(async () => []) }),
      readiness: () => ({
        inspect: async () => ({
          tracker: null,
          repo: null,
          checks: [],
          ok: true,
          scope: "environment" as const,
        }),
      }),
      docs: () => linkedCore.docs(),
      configStore: () => linkedCore.configStore(),
      installation: () => linkedCore.installation(),
      evidence: () => linkedCore.evidence(),
      board: () => linkedCore.board(),
      packets: () => linkedCore.packets(),
      ariadneTokens: () => linkedCore.ariadneTokens(),
      boardSessions: () => linkedCore.boardSessions(),
      boardAgents: () => linkedCore.boardAgents(),
      reviewOperations: () => linkedCore.reviewOperations(),
    };
    const program = buildProgram(
      (override) => linkedCore.tracker(override),
      (override) => linkedCore.config(override),
      (override) => linkedCore.prHost(override),
      () => linkedCore.configPath(),
      services,
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const operations = new MapOperationRegistry({
        operations: linkedCore.localOperations().operations(),
        policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "process", "network"] }),
      });
      const result = await operations.invoke("qa-evidence-dir", { ticket: "FRT-256" });
      expect(result).toMatchObject({
        status: "success",
        data: {
          path: join(resolvedMainCheckout, ".agents", "evidence", "FRT-256"),
          gitignored: true,
        },
      });

      await program.parseAsync(["qa", "evidence-dir", "FRT-256"], { from: "user" });
      expect(output).toHaveBeenLastCalledWith(
        `${JSON.stringify(result.status === "success" ? result.data : null)}\n`,
      );
      const configResult = await operations.invoke("config-path", {});
      await program.parseAsync(["config", "path"], { from: "user" });
      expect(configResult).toMatchObject({
        status: "success",
        data: { path: join(linkedCheckout, ".agents", "flight-rules.local.md") },
      });
      const configData = z
        .object({ path: z.string() })
        .parse(configResult.status === "success" ? configResult.data : {});
      expect(output).toHaveBeenLastCalledWith(`${configData.path}\n`);
    } finally {
      output.mockRestore();
      originalCwd.mockRestore();
    }
  });
});
