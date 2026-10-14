import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = join(root, "bin", "flight-rules.mjs");
const fixtures: string[] = [];

const fixture = (): string => {
  const path = mkdtempSync(join(tmpdir(), "flight-rules-mcp-"));
  fixtures.push(path);
  return path;
};

const isolatedEnvironment = (configPath: string): Record<string, string> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  for (const key of [
    "FLIGHT_RULES_HOST",
    "FLIGHT_RULES_HOME",
    "FLIGHT_RULES_CONFIG",
    "GITHUB_TOKEN",
    "JIRA_TOKEN",
    "JIRA_API_TOKEN",
    "JIRA_API_KEY",
  ]) {
    delete env[key];
  }
  env["FLIGHT_RULES_CONFIG"] = configPath;
  env["HOME"] = fixture();
  return env;
};

const connect = async (
  cwd: string,
  configPath: string,
  args: string[] = [],
  mode: "auto" | "legacy" = "auto",
  executable = binary,
  environmentOverrides: Record<string, string> = {},
): Promise<{ client: Client; transport: StdioClientTransport; stderr: string[] }> => {
  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable, "mcp", ...args],
    cwd,
    env: { ...isolatedEnvironment(configPath), ...environmentOverrides },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
  const client = new Client(
    { name: "flight-rules-mcp-test", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  await client.connect(transport);
  return { client, transport, stderr };
};

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("MCP stdio subprocess", () => {
  it("serves modern discovery, validated operations and canonical resources without tracker credentials", async () => {
    const cwd = fixture();
    const configPath = join(cwd, "flight-rules.yml");
    const { client, transport, stderr } = await connect(cwd, configPath);

    try {
      const { tools } = await client.listTools();
      const toolNames = tools.map((tool) => tool.name);
      expect(toolNames).toContain("branch-name");
      expect(toolNames).toEqual(
        expect.arrayContaining([
          "ticket-get",
          "ticket-transitions",
          "users-get",
          "tdd-get",
          "epic-get",
          "initiative-get",
          "epic-plan",
          "epic-review-plan",
          "initiative-plan",
          "initiative-review-plan",
        ]),
      );
      expect(toolNames).not.toContain("ticket-create");

      const invalidTrackerInput = await client.callTool({ name: "ticket-get", arguments: {} });
      expect(invalidTrackerInput.isError).toBe(true);

      const unconfiguredReview = await client.callTool({
        name: "review-context",
        arguments: { contextPath: "CODE-REVIEW.md" },
      });
      expect(unconfiguredReview.structuredContent).toMatchObject({
        status: "error",
        error: { name: "MissingTrustedReviewRefError" },
      });

      const safe = await client.callTool({
        name: "branch-name",
        arguments: { type: "feat", scope: "mcp", description: "server" },
      });
      expect(safe.isError).not.toBe(true);
      expect(safe.structuredContent).toMatchObject({
        status: "success",
        data: { branch: "feat/mcp-server" },
      });

      const cancellation = new AbortController();
      const pending = client.callTool(
        { name: "check", arguments: {} },
        { signal: cancellation.signal },
      );
      setTimeout(() => cancellation.abort(), 0);
      await pending.catch(() => undefined);
      expect(
        await client.callTool({ name: "branch-name", arguments: { type: "fix", scope: "mcp" } }),
      ).toMatchObject({ structuredContent: { status: "success" } });

      const invalid = await client.callTool({ name: "branch-name", arguments: { type: 7 } });
      expect(invalid.isError).toBe(true);
      await expect(client.callTool({ name: "not-registered", arguments: {} })).rejects.toThrow();

      const outside = fixture();
      const linkDirectory = join(cwd, "linked");
      mkdirSync(linkDirectory);
      symlinkSync(outside, join(linkDirectory, "outside"));
      for (const from of [outside, join(linkDirectory, "outside")]) {
        const result = await client.callTool({ name: "qa-instructions", arguments: { from } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("escapes the launch checkout") },
        });
      }

      const { resources } = await client.listResources();
      expect(
        resources.filter((resource) => resource.uri.startsWith("flight-rules://agents/")).length,
      ).toBe(7);
      expect(
        resources.some((resource) => resource.uri === "flight-rules://skills/execute-work"),
      ).toBe(true);
      const skillUri = "flight-rules://skills/execute-work";
      const skill = await client.readResource({ uri: skillUri });
      expect(skill.contents[0]).toMatchObject({
        text: readFileSync(join(root, "skills/execute-work/SKILL.md"), "utf8"),
      });
      expect(
        resources.some(
          (resource) => resource.uri === "flight-rules://agents/code-implementation-escalated",
        ),
      ).toBe(true);
      const agent = await client.readResource({
        uri: "flight-rules://agents/code-implementation-escalated",
      });
      expect(agent.contents[0]).toMatchObject({
        text: expect.stringContaining("single-shot builder"),
      });
      await expect(
        client.readResource({ uri: "flight-rules://skills/../package.json" }),
      ).rejects.toThrow();
      expect(stderr.join("")).toContain("running work may finish");
    } finally {
      await client.close();
      expect(transport.pid).toBeNull();
    }
  });

  it("rejects QA instructions symlinks that resolve outside the launch checkout", async () => {
    const cwd = fixture();
    const outside = fixture();
    const configPath = join(cwd, "flight-rules.yml");
    writeFileSync(join(outside, "QA.md"), "# QA\n\nOUTSIDE_FIXTURE_SENTINEL\n");
    symlinkSync(join(outside, "QA.md"), join(cwd, "QA.md"));
    const { client, transport } = await connect(cwd, configPath);

    try {
      for (const args of [{}, { from: cwd }]) {
        const result = await client.callTool({ name: "qa-instructions", arguments: args });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("escapes the launch checkout") },
        });
        expect(JSON.stringify(result)).not.toContain("OUTSIDE_FIXTURE_SENTINEL");
      }
    } finally {
      await client.close();
      expect(transport.pid).toBeNull();
    }
  });

  it("uses host-pinned review context and owner mapping without accepting request authority", async () => {
    const cwd = fixture();
    execFileSync("git", ["init", "-q"], { cwd });
    writeFileSync(join(cwd, "CODE-REVIEW.md"), "Pinned review guidance.\n");
    execFileSync("git", ["add", "CODE-REVIEW.md"], { cwd });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "trusted"],
      { cwd },
    );
    const trustedRef = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
    writeFileSync(join(cwd, "CODE-REVIEW.md"), "Untrusted working tree edit.\n");

    const ownersFile = join(cwd, "review-owners.json");
    writeFileSync(ownersFile, JSON.stringify({ "security owner": ["trusted-owner"] }));
    const bin = join(cwd, "fake-bin");
    mkdirSync(bin);
    const gh = join(bin, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env node
const endpoint = process.argv[3];
const responses = {
  "/repos/acme/project/pulls/7": { head: { sha: "${trustedRef}" }, user: { id: 10 } },
  "/repos/acme/project/issues/comments/33": {
    id: 33,
    user: { id: 20, login: "trusted-owner", type: "User" },
    issue_url: "https://api.github.com/repos/acme/project/issues/7",
    body: "Approved by the owner.",
  },
};
if (!(endpoint in responses)) process.exit(2);
process.stdout.write(JSON.stringify(responses[endpoint]));
`,
    );
    chmodSync(gh, 0o755);
    const { client, transport } = await connect(
      cwd,
      join(cwd, "flight-rules.yml"),
      ["--review-ref", trustedRef, "--review-owners-file", ownersFile, "--require-review-mapping"],
      "auto",
      binary,
      { PATH: `${bin}:${process.env.PATH ?? ""}` },
    );

    try {
      const context = await client.callTool({
        name: "review-context",
        arguments: { contextPath: "CODE-REVIEW.md" },
      });
      expect(context.structuredContent).toMatchObject({
        status: "success",
        data: {
          trustedRef,
          sources: [{ path: "CODE-REVIEW.md", contents: "Pinned review guidance.\n" }],
        },
      });

      const decisionRecord = {
        v: 1,
        schema_revision: 1,
        finding: {
          id: "f-0000000001",
          path: "src/example.ts",
          line: 1,
          label: "issue",
          type: "decide",
          blocking: true,
          severity: "major",
          subject: "Keep the policy explicit.",
          discussion: "A human owner must approve this choice.",
          details: "Use the configured owner mapping.",
          resolved_when: "The owner confirms the decision.",
          decision_owner: "security owner",
          decision_options: [
            { id: "allow", description: "Allow the change." },
            { id: "deny", description: "Keep the restriction." },
          ],
        },
        status: "open",
        evidence: [],
      };
      const review = {
        contract_version: 1,
        schema_revision: 1,
        head_sha: trustedRef,
        review_complete: true,
        summary: "The owner approved the decision.",
        outcome: "APPROVED",
        outcome_reason: "All blocking decisions are resolved.",
        remaining_risk: "No known remaining risk.",
        findings: [],
        prior_findings: [
          {
            id: "f-0000000001",
            status: "resolved",
            reason: "The configured owner approved.",
            evidence: [
              {
                kind: "github_comment",
                comment_id: 33,
                url: "https://github.com/acme/project/pull/7#issuecomment-33",
              },
            ],
            decision: { comment_id: 33, author_id: 20, option_id: "allow" },
          },
        ],
      };
      const planInput = { number: 7, repo: "acme/project", review, records: [decisionRecord] };
      const plan = await client.callTool({ name: "review-plan", arguments: planInput });
      expect(plan.structuredContent).toMatchObject({
        status: "success",
        data: {
          outcome: "APPROVED",
          records: [{ status: "resolved", finding: { decision_owner: "security owner" } }],
        },
      });

      const changedAuthority = await client.callTool({
        name: "review-plan",
        arguments: { ...planInput, owners: { "security owner": ["attacker"] } },
      });
      expect(changedAuthority.isError).toBe(true);

      const changedRef = await client.callTool({
        name: "review-context",
        arguments: { contextPath: "CODE-REVIEW.md", trustedRef: "b".repeat(40) },
      });
      expect(changedRef.isError).toBe(true);
    } finally {
      await client.close();
      expect(transport.pid).toBeNull();
    }
  });

  it("rejects malformed trusted review launch configuration before starting stdio", () => {
    const cwd = fixture();
    const configPath = join(cwd, "flight-rules.yml");
    const ownersFile = join(cwd, "review-owners.json");
    writeFileSync(ownersFile, JSON.stringify({ "security owner": "not-an-array" }));

    const invalidRef = spawnSync(
      process.execPath,
      [binary, "mcp", "--review-ref", "not-a-full-sha"],
      { cwd, env: isolatedEnvironment(configPath), encoding: "utf8" },
    );
    expect(invalidRef.status).not.toBe(0);
    expect(invalidRef.stdout).toBe("");

    const invalidOwners = spawnSync(
      process.execPath,
      [binary, "mcp", "--review-owners-file", ownersFile],
      { cwd, env: isolatedEnvironment(configPath), encoding: "utf8" },
    );
    expect(invalidOwners.status).not.toBe(0);
    expect(invalidOwners.stdout).toBe("");
  });

  it.each([
    ["auto", "symlink"],
    ["auto", "directory"],
    ["legacy", "symlink"],
    ["legacy", "directory"],
  ] as const)(
    "keeps the %s launch checkout fixed after %s replacement",
    async (mode, replacement) => {
      const scratch = fixture();
      const cwd = join(scratch, "checkout");
      const original = join(scratch, "original");
      const outside = join(scratch, "outside");
      mkdirSync(cwd);
      mkdirSync(outside);
      writeFileSync(join(cwd, "QA.md"), "# QA\n\nORIGINAL_FIXTURE_SENTINEL\n");
      writeFileSync(join(outside, "QA.md"), "# QA\n\nOUTSIDE_FIXTURE_SENTINEL\n");
      const configPath = join(cwd, "flight-rules.yml");
      const { client, transport } = await connect(
        cwd,
        configPath,
        ["--allow-operation", "config-set", "--allow-config-scope", "file"],
        mode,
      );

      try {
        await client.listTools();
        const before = await client.callTool({ name: "qa-instructions", arguments: {} });
        expect(before.isError).not.toBe(true);
        expect(JSON.stringify(before)).toContain("ORIGINAL_FIXTURE_SENTINEL");

        renameSync(cwd, original);
        if (replacement === "symlink") symlinkSync(outside, cwd);
        else cpSync(outside, cwd, { recursive: true });

        for (const args of [{}, { from: cwd }]) {
          const result = await client.callTool({ name: "qa-instructions", arguments: args });
          expect(result.isError).toBe(true);
          expect(result.structuredContent).toMatchObject({
            status: "error",
            error: { name: "LaunchCheckoutChangedError" },
          });
          expect(JSON.stringify(result)).not.toContain("OUTSIDE_FIXTURE_SENTINEL");
        }
        const write = await client.callTool({
          name: "config-set",
          arguments: { key: "repo", values: ["fixture/example"], scope: "file" },
        });
        expect(write.structuredContent).toMatchObject({
          status: "error",
          error: { name: "LaunchCheckoutChangedError" },
        });
        expect(existsSync(configPath)).toBe(false);

        rmSync(cwd, { recursive: true, force: true });
        renameSync(original, cwd);
        const restored = await client.callTool({ name: "qa-instructions", arguments: {} });
        expect(restored.isError).not.toBe(true);
        expect(JSON.stringify(restored)).toContain("ORIGINAL_FIXTURE_SENTINEL");
      } finally {
        await client.close();
        expect(transport.pid).toBeNull();
      }
    },
  );

  it("denies writes before invocation and permits an explicitly scoped fixture write", async () => {
    const cwd = fixture();
    const configPath = join(cwd, "flight-rules.yml");
    const denied = await connect(cwd, configPath);
    try {
      const result = await denied.client.callTool({
        name: "config-set",
        arguments: { key: "repo", values: ["fixture/example"], scope: "file" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: "error",
        error: { name: "OperationAccessDeniedError" },
      });
      expect(existsSync(configPath)).toBe(false);
    } finally {
      await denied.client.close();
    }

    const permitted = await connect(cwd, configPath, [
      "--allow-operation",
      "config-set",
      "--allow-config-scope",
      "file",
    ]);
    try {
      const result = await permitted.client.callTool({
        name: "config-set",
        arguments: { key: "repo", values: ["fixture/example"], scope: "file" },
      });
      expect(result.isError).not.toBe(true);
      expect(readFileSync(configPath, "utf8")).toContain("fixture/example");
    } finally {
      await permitted.client.close();
    }
  });

  it("serves the legacy initialize exchange and exits promptly on EOF", async () => {
    const cwd = fixture();
    const configPath = join(cwd, "flight-rules.yml");
    const { client, transport } = await connect(cwd, configPath, [], "legacy");

    const start = Date.now();
    await client.close();
    expect(Date.now() - start).toBeLessThan(3000);
    expect(transport.pid).toBeNull();
  });

  it.each(["claude", "codex"])(
    "runs the relocated %s CLI without repository dependencies",
    async (host) => {
      const installation = fixture();
      const relocated = join(installation, "installation");
      cpSync(join(root, "dist", host), relocated, { recursive: true });
      const cwd = fixture();
      const configPath = join(cwd, "flight-rules.yml");
      const { client, transport } = await connect(
        cwd,
        configPath,
        [],
        "auto",
        join(relocated, "bin", "flight-rules.mjs"),
      );

      try {
        const safe = await client.callTool({
          name: "branch-name",
          arguments: { type: "feat", scope: host },
        });
        expect(safe.structuredContent).toMatchObject({ status: "success" });
        const { resources } = await client.listResources();
        expect(
          resources.some((resource) => resource.uri === "flight-rules://skills/execute-work"),
        ).toBe(true);
      } finally {
        await client.close();
        expect(transport.pid).toBeNull();
      }
    },
  );
});
