import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlightRules } from "../../flight-rules/flight-rules.js";
import { buildProgram } from "../../cli/cli.js";
import { LaunchOperationAccessPolicy, MapOperationRegistry } from "../operation-registry.js";
import type { ReadinessReport } from "../../tasks/readiness/readiness.schema.js";

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
