import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import { buildProgram } from "../../../cli/cli.js";
import { WorkflowSchema } from "../readiness.schema.js";
import { createFlightRules } from "../../../flight-rules/flight-rules.js";
import { QaInstructionsFinder } from "../../qa-instructions/qa-instructions.js";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { NodeToolProbe } from "../../tool-probe/tool-probe.js";
import { RedactedProbeDiagnostics } from "../probe-diagnostics.js";
import { NodeRepositoryReadiness } from "../repository-readiness.js";
import { NodeWorkflowPreflight } from "../workflow-preflight.js";
import { createCheckCommand } from "../../commands/check/command.js";
import type { WorkflowEvidence } from "../readiness.schema.js";

const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../../agents", import.meta.url)),
);
const config = {
  tracker: "github",
  repo: "acme/repo",
  defaultLabels: [],
  competencies: [],
  rfcStorage: "local",
} as const;
const directories: string[] = [];
const available = {
  state: "available",
  evidence: "Effective host policy and observed access for this scope",
} as const;
function directory(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "fr-preflight-")));
  directories.push(path);
  return path;
}
function evidence(cwd: string): WorkflowEvidence {
  const context = {
    runId: "run",
    taskId: "task",
    cwd,
    repositoryRoot: cwd,
    baseRef: "main",
    skill: "execute-work",
    attempt: 1,
  };
  return {
    context,
    callerCapabilities: Object.fromEntries(
      ["shell", "network", "tracker.write", "git.write", "git.push", "edit", "evidence.write"].map(
        (capability) => [capability, available],
      ),
    ),
    workers: agents.map((agent) => ({
      registration: agent.frontmatter,
      runtime: {
        context,
        agent: agent.frontmatter.name,
        host: { name: "fixture", version: "1" },
        observedAt: "2026-10-13T00:00:00Z",
        spawn: available,
        ask: { state: "denied", evidence: "Unattended", remedy: "Return questions to caller" },
        permissions: Object.fromEntries(
          agent.frontmatter.capabilities.map((capability) => [capability, available]),
        ),
        limits: {
          maxConcurrent: 1,
          activeWorkers: 0,
          currentDepth: 0,
          maxDepth: 1,
          source: "Explicit fixture policy",
        },
      },
    })),
  };
}
function inputs() {
  const tracker: TaskTracker = {
    createEpic: vi.fn<TaskTracker["createEpic"]>(),
    getEpic: vi.fn<TaskTracker["getEpic"]>(),
    createTicket: vi.fn<TaskTracker["createTicket"]>(),
    getTicket: vi.fn<TaskTracker["getTicket"]>(),
    linkTicketToEpic: vi.fn<TaskTracker["linkTicketToEpic"]>(),
    getTicketEpicId: vi.fn<TaskTracker["getTicketEpicId"]>(),
    blockTicket: vi.fn<TaskTracker["blockTicket"]>(),
    unblockTicket: vi.fn<TaskTracker["unblockTicket"]>(),
    transitionTicket: vi.fn<TaskTracker["transitionTicket"]>(),
    listTransitions: vi.fn<TaskTracker["listTransitions"]>(),
    addLabel: vi.fn<TaskTracker["addLabel"]>(),
    removeLabel: vi.fn<TaskTracker["removeLabel"]>(),
    updateEpicMetadata: vi.fn<TaskTracker["updateEpicMetadata"]>(),
    updateTicketMetadata: vi.fn<TaskTracker["updateTicketMetadata"]>(),
    updateTddMetadata: vi.fn<TaskTracker["updateTddMetadata"]>(),
    updateEpicDescription: vi.fn<TaskTracker["updateEpicDescription"]>(),
    updateTicketDescription: vi.fn<TaskTracker["updateTicketDescription"]>(),
    updateInitiativeDescription: vi.fn<TaskTracker["updateInitiativeDescription"]>(),
    createInitiative: vi.fn<TaskTracker["createInitiative"]>(),
    getInitiative: vi.fn<TaskTracker["getInitiative"]>(),
    linkEpicToInitiative: vi.fn<TaskTracker["linkEpicToInitiative"]>(),
    createTechnicalDesign: vi.fn<TaskTracker["createTechnicalDesign"]>(),
    getTechnicalDesign: vi.fn<TaskTracker["getTechnicalDesign"]>(),
    addComment: vi.fn<TaskTracker["addComment"]>(),
    addAttachment: vi.fn<TaskTracker["addAttachment"]>(),
    getUsers: vi.fn<TaskTracker["getUsers"]>(),
    ping: vi.fn<TaskTracker["ping"]>().mockResolvedValue(undefined),
  };
  return {
    config: () => ({ ...config, defaultLabels: [], competencies: [] }),
    configPath: () => "/nonexistent/config.md",
    tracker: () => tracker,
    probe: { probe: vi.fn().mockResolvedValue([]) },
    finder: new QaInstructionsFinder(),
  };
}
function checkout(): string {
  const cwd = directory();
  execFileSync("git", ["init", "-q", "-b", "main", cwd]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ],
    { cwd },
  );
  const remote = directory();
  execFileSync("git", ["init", "--bare", "-q", remote]);
  execFileSync("git", ["remote", "add", "origin", remote], { cwd });
  return cwd;
}
function checkCommand(
  kind: string,
  cwd: string,
  request = inputs(),
  env = { GITHUB_TOKEN: "token" },
) {
  const checker = new NodeRepositoryReadiness({ cwd, env: { ...process.env, ...env } });
  if (kind === "standalone")
    return createCheckCommand(
      request.config,
      request.tracker,
      request.configPath,
      () => request.probe,
      () => request.finder,
      () => checker,
    );
  const core = createFlightRules({ cwd, env });
  vi.spyOn(core, "readiness").mockReturnValue(checker);
  vi.spyOn(core, "probe").mockReturnValue(request.probe);
  const program = buildProgram(
    request.tracker,
    request.config,
    () => core.prHost(),
    request.configPath,
    core,
  );
  const command = program.commands.find((item) => item.name() === "check");
  if (command === undefined) throw new Error("Missing check command");
  return command;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) {
    chmodSync(path, 0o755);
    rmSync(path, { recursive: true, force: true });
  }
});

describe("probe diagnostics", () => {
  it.each([
    [{ code: "ENOENT" }, "MISSING_TOOL"],
    [{ status: 401, message: "Unauthorized" }, "AUTHENTICATION"],
    [{ status: 403, message: "Forbidden" }, "PERMISSION_DENIED"],
    [{ code: "EPERM", message: "Denied by policy" }, "PERMISSION_DENIED"],
    [{ code: "ECONNREFUSED", message: "Connection refused" }, "NETWORK"],
    [{ cause: { code: "ENOTFOUND" }, message: "fetch failed" }, "NETWORK"],
    [{ status: 503, message: "Unavailable" }, "NETWORK"],
    [{ killed: true, message: "Command failed" }, "TIMEOUT"],
    [new DOMException("Probe timed out", "TimeoutError"), "TIMEOUT"],
    [new Error("Unexpected failure"), "UNKNOWN"],
  ])("classifies %j as %s", (error, code) => {
    const result = new RedactedProbeDiagnostics({ env: {} }).failure("probe", error, true);
    expect(result).toMatchObject({ ok: false, required: true, code, remedy: expect.any(String) });
    if (code === "NETWORK") expect(result.remedy).toContain("does not establish sandbox denial");
  });
  it("redacts known secrets, URL credentials, authorization values and token query parameters", () => {
    const diagnostics = new RedactedProbeDiagnostics({
      env: { GITHUB_TOKEN: "my+secret", JIRA_API_KEY: "jira-secret" },
    });
    const result = diagnostics.failure(
      "probe",
      new Error(
        "my+secret my%2Bsecret jira-secret https://user:password@host/x?token=unknown Authorization: Basic dXNlcjpwYXNz Bearer unknown-token ghp_abcdef",
      ),
      true,
    );
    expect(result.detail).not.toMatch(
      /my\+secret|my%2Bsecret|jira-secret|password|unknown-token|dXNlcjpwYXNz|ghp_abcdef|token=unknown/,
    );
    expect(result.detail).toContain("[REDACTED]");
  });
});

describe("workflow readiness", () => {
  it("reports a denied QA instruction read without dropping the checks/ok report", async () => {
    const cwd = directory();
    const request = inputs();
    vi.spyOn(request.finder, "discover").mockImplementation(() => {
      throw Object.assign(new Error("QA read denied"), { code: "EACCES" });
    });
    const report = await new NodeRepositoryReadiness({
      cwd,
      env: { GITHUB_TOKEN: "token" },
    }).inspect({ ...request, options: { workflow: "verify-ticket" } });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "qa-instructions")).toMatchObject({
      code: "PERMISSION_DENIED",
      required: true,
    });
  });
  describe.each(["standalone", "operation-backed"])("%s CLI", (kind) => {
    it.each(WorkflowSchema.options)("checks %s without a runtime file", async (workflow) => {
      const cwd = checkout();
      writeFileSync(join(cwd, "QA.md"), "Exercise the fixture application.");
      const files = readdirSync(cwd, { recursive: true }).sort();
      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await checkCommand(kind, cwd).parseAsync(["--workflow", workflow], { from: "user" });
      const report = JSON.parse(String(output.mock.calls[0]?.[0]));
      expect(report).toMatchObject({ ok: true, scope: "workflow", workflow });
      expect(report.checks).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.stringMatching(/^(host:|dispatch:)/) }),
        ]),
      );
      expect(readdirSync(cwd, { recursive: true }).sort()).toEqual(files);
    });

    it("rejects the removed runtime-file option before probing", async () => {
      const request = inputs();
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await expect(
        checkCommand(kind, directory(), request).parseAsync(
          ["--workflow", "break-down-work", "--runtime-file", "runtime.json"],
          { from: "user" },
        ),
      ).rejects.toMatchObject({ code: "commander.unknownOption" });
      expect(request.probe.probe).not.toHaveBeenCalled();
    });

    it.each([
      { status: 401, code: "AUTHENTICATION" },
      { status: 403, code: "PERMISSION_DENIED" },
      { status: 503, code: "NETWORK" },
    ])("reports real $code failures without host evidence", async ({ status, code }) => {
      const request = inputs();
      vi.spyOn(request.tracker(), "ping").mockRejectedValue(
        Object.assign(new Error("secret-token rejected"), { status }),
      );
      const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await expect(
        checkCommand(kind, directory(), request, { GITHUB_TOKEN: "secret-token" }).parseAsync(
          ["--workflow", "break-down-work"],
          { from: "user" },
        ),
      ).rejects.toThrow("check failed");
      const serialized = String(output.mock.calls[0]?.[0]);
      expect(JSON.parse(serialized)).toMatchObject({
        ok: false,
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "reachable", ok: false, code }),
        ]),
      });
      expect(serialized).not.toContain("secret-token");
    });
  });

  it("keeps the environment checks/ok contract without claiming workflow readiness", async () => {
    const checker = new NodeRepositoryReadiness({
      cwd: directory(),
      env: { GITHUB_TOKEN: "token" },
    });
    const report = await checker.inspect(inputs());
    expect(report).toMatchObject({
      tracker: "github",
      repo: "acme/repo",
      ok: true,
      scope: "environment",
    });
    expect(report.checks.map((check) => check.name)).toEqual([
      "config",
      "credentials",
      "reachable",
      "qa-instructions",
    ]);
    expect(report.checks.find((check) => check.name === "qa-instructions")?.required).toBe(false);
  });
  it("runs workflow environment checks without claiming host capabilities", async () => {
    const checker = new NodeRepositoryReadiness({
      cwd: directory(),
      env: { GITHUB_TOKEN: "token" },
    });
    const report = await checker.inspect({ ...inputs(), options: { workflow: "break-down-work" } });
    expect(report).toMatchObject({ ok: true, scope: "workflow", workflow: "break-down-work" });
    expect(report.checks.map((check) => check.name)).toEqual([
      "config",
      "credentials",
      "reachable",
      "qa-instructions",
    ]);
  });
  it.each(["available", "unknown", "denied"] as const)(
    "preserves optional SDK evidence with %s tracker access",
    async (state) => {
      const cwd = directory();
      const observed = evidence(cwd);
      if (state !== "available")
        observed.callerCapabilities["tracker.write"] = {
          state,
          evidence: "Explicit adapter observation",
          remedy: "Resolve tracker access through the host",
        };
      const report = await new NodeRepositoryReadiness({
        cwd,
        env: { GITHUB_TOKEN: "token" },
      }).inspect({
        ...inputs(),
        options: { workflow: "break-down-work", evidence: observed },
      });
      expect(report.ok).toBe(state === "available");
      expect(report.checks).toContainEqual(
        expect.objectContaining({ name: "host:tracker.write", ok: state === "available" }),
      );
    },
  );
  it("uses injected cwd/environment and notices subsequent credential changes", async () => {
    const cwd = directory();
    writeFileSync(join(cwd, "QA.md"), "Local QA instructions");
    const env: Record<string, string | undefined> = { GITHUB_TOKEN: "scoped-token" };
    const checker = createFlightRules({ cwd, env }).readiness();
    const request = inputs();
    const first = await checker.inspect(request);
    expect(first.checks.find((check) => check.name === "qa-instructions")?.detail).toContain(cwd);
    env.GITHUB_TOKEN = undefined;
    const second = await checker.inspect(request);
    expect(second.checks.find((check) => check.name === "credentials")?.ok).toBe(false);
  });
  it("bounds tracker reachability and passes cancellation to the backend", async () => {
    let signal: AbortSignal | undefined;
    const checker = new NodeRepositoryReadiness({
      cwd: directory(),
      env: { GITHUB_TOKEN: "token" },
      timeoutMs: 10,
    });
    const request = inputs();
    vi.spyOn(request.tracker(), "ping").mockImplementation((options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    const report = await checker.inspect(request);
    expect(report.checks.find((check) => check.name === "reachable")).toMatchObject({
      ok: false,
      code: "TIMEOUT",
    });
    expect(signal?.aborted).toBe(true);
  });
  it("redacts tracker errors and distinguishes auth from connectivity", async () => {
    const checker = new NodeRepositoryReadiness({
      cwd: directory(),
      env: { GITHUB_TOKEN: "secret-token" },
    });
    const request = inputs();
    vi.spyOn(request.tracker(), "ping").mockRejectedValue(
      Object.assign(new Error("secret-token rejected"), { status: 401 }),
    );
    const report = await checker.inspect(request);
    expect(report.checks.find((check) => check.name === "reachable")).toMatchObject({
      code: "AUTHENTICATION",
    });
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });
  it("requires QA instructions only for the QA workflow and keeps non-code push entitlement optional", async () => {
    const cwd = directory();
    const checker = new NodeRepositoryReadiness({ cwd, env: { GITHUB_TOKEN: "token" } });
    const request = inputs();
    const report = await checker.inspect({
      ...request,
      options: { workflow: "verify-ticket" },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "qa-instructions")?.required).toBe(true);
    expect(request.probe.probe).toHaveBeenCalledWith({
      repo: "acme/repo",
      qaInstructionsFound: true,
      githubRequired: true,
      pushRequired: false,
    });
  });
  it("returns a redacted config failure as checks/ok", async () => {
    const checker = new NodeRepositoryReadiness({
      cwd: directory(),
      env: { GITHUB_TOKEN: "secret-token" },
    });
    const report = await checker.inspect({
      ...inputs(),
      config: () => {
        throw new Error("Invalid secret-token");
      },
    });
    expect(report).toMatchObject({
      tracker: null,
      repo: null,
      ok: false,
      checks: [{ name: "config", code: "CONFIGURATION" }],
    });
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });
});

describe("read-only workflow probes", () => {
  it("checks a linked worktree without supplied repository context", async () => {
    const main = checkout();
    const cwd = join(directory(), "linked");
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked", cwd], { cwd: main });
    const checks = await new NodeWorkflowPreflight({ cwd, env: process.env }).inspect(
      "execute-wave",
    );
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks).toContainEqual(expect.objectContaining({ name: "local:git-write", ok: true }));
  });
  it("still fails a missing Git remote without host evidence", async () => {
    const cwd = checkout();
    execFileSync("git", ["remote", "remove", "origin"], { cwd });
    const checks = await new NodeWorkflowPreflight({ cwd, env: process.env }).inspect(
      "execute-work",
    );
    expect(checks).toContainEqual(
      expect.objectContaining({ name: "git:remote-read", ok: false, required: true }),
    );
  });
  it.each(["permissions", "spawn", "limits"] as const)(
    "preserves opt-in SDK checks when worker %s are unverified",
    async (kind) => {
      const cwd = directory();
      const observed = evidence(cwd);
      const worker = observed.workers.find((item) => item.registration.name === "research-agent");
      if (!worker) throw new Error("missing worker");
      if (kind === "permissions") delete worker.runtime.permissions.read;
      if (kind === "spawn")
        worker.runtime.spawn = {
          state: "unknown",
          evidence: "Not exposed",
          remedy: "Use a supported parent context",
        };
      if (kind === "limits") worker.runtime.limits.maxConcurrent = null;
      const checks = await new NodeWorkflowPreflight({ cwd, env: {} }).inspect(
        "break-down-work",
        observed,
      );
      expect(checks.find((check) => check.name === "dispatch:research-agent")).toMatchObject({
        ok: false,
        code:
          kind === "permissions"
            ? "CAPABILITY_UNKNOWN"
            : kind === "spawn"
              ? "DISPATCH_UNAVAILABLE"
              : "LIMITS_UNKNOWN",
      });
    },
  );

  it("reports a denied local directory without host evidence", async () => {
    const cwd = directory();
    chmodSync(cwd, 0o555);
    const checks = await new NodeWorkflowPreflight({ cwd, env: process.env }).inspect(
      "execute-work",
    );
    expect(checks.find((check) => check.name === "local:workspace-write")).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
  });
  it("checks actual local remote and write observations without mutating either repository", async () => {
    const cwd = directory();
    const remote = directory();
    execFileSync("git", ["init", "-q", "-b", "main", cwd]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-qm",
        "fixture",
      ],
      { cwd },
    );
    execFileSync("git", ["init", "--bare", "-q", remote]);
    execFileSync("git", ["remote", "add", "origin", remote], { cwd });
    const before = readFileSync(join(cwd, ".git/config"), "utf8");
    const files = readdirSync(cwd, { recursive: true }).sort();
    const checks = await new NodeWorkflowPreflight({ cwd, env: process.env }).inspect(
      "execute-work",
    );
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.find((check) => check.name === "git:remote-read")?.detail).toContain(
      "does not test push",
    );
    expect(readdirSync(cwd, { recursive: true }).sort()).toEqual(files);
    expect(readFileSync(join(cwd, ".git/config"), "utf8")).toBe(before);
    expect(execFileSync("git", ["ls-remote", "origin"], { cwd, encoding: "utf8" })).toBe("");
  });
  it.each(["unknown", "denied"] as const)("stops for %s caller write capability", async (state) => {
    const cwd = directory();
    const observed = evidence(cwd);
    observed.callerCapabilities["tracker.write"] = {
      state,
      evidence: "No approved tracker write",
      remedy: "Establish scoped tracker access",
    };
    const checks = await new NodeWorkflowPreflight({ cwd, env: {} }).inspect(
      "break-down-work",
      observed,
    );
    expect(checks.find((check) => check.name === "host:tracker.write")).toMatchObject({
      ok: false,
      code: state === "unknown" ? "CAPABILITY_UNKNOWN" : "CAPABILITY_DENIED",
    });
  });
  it("rejects evidence for another directory and worker nesting exhaustion", async () => {
    const cwd = directory();
    const checker = new NodeWorkflowPreflight({ cwd, env: {} });
    expect(
      (await checker.inspect("break-down-work", evidence(directory()))).find(
        (check) => check.name === "host:context",
      )?.ok,
    ).toBe(false);
    const observed = evidence(cwd);
    for (const worker of observed.workers) worker.runtime.limits.currentDepth = 1;
    expect(
      (await checker.inspect("break-down-work", observed)).find(
        (check) => check.name === "dispatch:research-agent",
      ),
    ).toMatchObject({ ok: false, code: "DEPTH_EXCEEDED" });
  });
  it("bounds a real stalled tool and respects its injected working directory/environment", async () => {
    const cwd = directory();
    const bin = join(cwd, "bin");
    mkdirSync(bin);
    const gh = join(bin, "gh");
    writeFileSync(gh, `#!${process.execPath}\nsetInterval(() => {}, 1000)\n`, { mode: 0o755 });
    const checks = await new NodeToolProbe({ cwd, env: { PATH: bin }, timeoutMs: 30 }).probe({
      repo: "acme/repo",
      qaInstructionsFound: false,
    });
    expect(checks.filter((check) => check.name.startsWith("tools:gh"))).toMatchObject([
      { code: "TIMEOUT" },
      { code: "TIMEOUT" },
      { code: "TIMEOUT" },
    ]);
    writeFileSync(
      gh,
      `#!${process.execPath}\nif (process.cwd() !== ${JSON.stringify(cwd)} || process.env.SCOPED !== 'yes') process.exit(1);\nconsole.log(process.argv[2] === '--version' ? 'gh version 2.99.0' : process.argv[2] === 'api' ? 'true' : 'authenticated')\n`,
    );
    const scoped = await new NodeToolProbe({
      cwd,
      env: { PATH: bin, SCOPED: "yes" },
      timeoutMs: 1000,
    }).probe({ repo: "acme/repo", qaInstructionsFound: false });
    expect(
      scoped.filter((check) => check.name.startsWith("tools:gh")).every((check) => check.ok),
    ).toBe(true);
  });
});
