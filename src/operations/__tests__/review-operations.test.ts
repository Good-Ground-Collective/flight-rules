import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createReviewCommand } from "../../code-review/commands/command.js";
import { JsonReviewCodec } from "../../code-review/review-codec.js";
import { FileReviewPolicy } from "../../code-review/review-policy.js";
import { FindingRecordSchema, ReviewSchema } from "../../code-review/review.schema.js";
import type { ReviewGitHubApi } from "../../code-review/github-review-verifier.js";
import { createFlightRules } from "../../flight-rules/flight-rules.js";
import { DefaultReviewOperations, type ReviewOperationsLaunchProps } from "../review-operations.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
  type OperationRegistry,
} from "../operation-registry.js";

const head = "a".repeat(40);
const dirs: string[] = [];
afterEach(() => {
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const makeReview = (overrides: Record<string, unknown> = {}) =>
  ReviewSchema.parse({
    contract_version: 1,
    schema_revision: 1,
    head_sha: head,
    review_complete: true,
    summary: "Review the change.",
    outcome: "APPROVED",
    outcome_reason: "No blockers remain.",
    remaining_risk: "No new risk.",
    findings: [],
    prior_findings: [],
    ...overrides,
  });

const makeRecord = (overrides: Record<string, unknown> = {}) =>
  FindingRecordSchema.parse({
    v: 1,
    schema_revision: 1,
    finding: {
      id: "f-0000000001",
      path: "src/example.ts",
      line: 4,
      label: "issue",
      type: "fix",
      blocking: true,
      severity: "major",
      subject: "Keep the tenant boundary.",
      discussion: "The query can return another tenant's record.",
      details: "Add a tenant filter.",
      resolved_when: "The query is tenant scoped.",
    },
    status: "open",
    evidence: [],
    ...overrides,
  });

const TestReviewGitHubApiPropsSchema = z.strictObject({
  headSha: z.string().optional(),
  commentType: z.string().optional(),
  commentId: z.number().optional(),
  commentLogin: z.string().optional(),
});

class TestReviewGitHubApi implements ReviewGitHubApi {
  readonly get = vi.fn(async (path: string) => {
    if (path.endsWith("/pulls/1")) return { head: { sha: this.headSha }, user: { id: 10 } };
    if (path.endsWith("/check-runs/991"))
      return { head_sha: this.headSha, status: "completed", conclusion: "success" };
    if (path.endsWith("/issues/comments/123"))
      return {
        id: 123,
        user: { id: this.commentId, login: this.commentLogin, type: this.commentType },
        issue_url: "https://api.github.com/repos/owner/repo/issues/1",
        body: "Decline this permission change.",
      };
    return {};
  });
  readonly graphql = vi.fn(async () => ({}));
  private readonly headSha: string;
  private readonly commentType: string;
  private readonly commentId: number;
  private readonly commentLogin: string;

  constructor(props: z.input<typeof TestReviewGitHubApiPropsSchema> = {}) {
    const parsed = TestReviewGitHubApiPropsSchema.parse(props);
    this.headSha = parsed.headSha ?? head;
    this.commentType = parsed.commentType ?? "User";
    this.commentId = parsed.commentId ?? 20;
    this.commentLogin = parsed.commentLogin ?? "reviewer";
  }
}

const createGitHubApi = (
  options: {
    headSha?: string;
    commentType?: string;
    commentId?: number;
    commentLogin?: string;
  } = {},
) => new TestReviewGitHubApi(options);

const registryFor = (
  api: ReviewGitHubApi = createGitHubApi(),
  allowedEffects: Array<"read" | "write" | "network" | "process"> = ["read", "network", "process"],
  launch: ReviewOperationsLaunchProps = {},
) =>
  new MapOperationRegistry({
    operations: new DefaultReviewOperations({
      ...launch,
      cwd: launch.cwd ?? process.cwd(),
      api,
    }).operations(),
    policy: new LaunchOperationAccessPolicy({ allowedEffects }),
  });

const jsonFile = (value: unknown): string => {
  const directory = mkdtempSync(join(tmpdir(), "review-cli-parity-"));
  dirs.push(directory);
  const path = join(directory, "input.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
};

const writeExecutable = (path: string, contents: string): void => {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
};

interface ReviewCliFixture {
  api?: ReviewGitHubApi;
  allowedEffects?: Array<"read" | "write" | "network" | "process">;
}

const runReviewCli = async (
  registry: OperationRegistry,
  args: string[],
  fixture: ReviewCliFixture = {},
) => {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const api = fixture.api ?? createGitHubApi();
  const allowedEffects = fixture.allowedEffects ?? ["read", "network", "process"];
  const program = new Command().exitOverride().addCommand(
    createReviewCommand({
      registry,
      defaultCwd: process.cwd(),
      createTrustedRegistry: (launch) => registryFor(api, allowedEffects, launch),
    }),
  );
  let error: unknown;
  let stdout: string;
  try {
    await program.parseAsync(["review", ...args], { from: "user" });
  } catch (caught) {
    error = caught;
  } finally {
    stdout = output.mock.calls.map(([chunk]) => String(chunk)).join("");
    output.mockRestore();
  }
  return { stdout, error };
};

const expectJsonParity = async (
  registry: OperationRegistry,
  id: string,
  input: unknown,
  args: string[],
  fixture: ReviewCliFixture = {},
) => {
  const result = await registry.invoke(id, input);
  expect(result.status).toBe("success");
  if (result.status === "success") {
    expect(await runReviewCli(registry, args, fixture)).toEqual({
      stdout: `${JSON.stringify(result.data)}\n`,
      error: undefined,
    });
    return result.data;
  }
  return undefined;
};

const expectFailureParity = async (
  registry: OperationRegistry,
  id: string,
  input: unknown,
  args: string[],
  fixture: ReviewCliFixture = {},
) => {
  const failure = await registry.invoke(id, input).then(
    (result) => (result.status === "error" ? result.error : undefined),
    (error: Error) => ({ name: error.name, message: error.message }),
  );
  expect(failure).toBeDefined();
  const result = await runReviewCli(registry, args, fixture);
  expect(result.stdout).toBe("");
  expect(result.error).toMatchObject(
    failure?.name === "OperationInputError"
      ? failure
      : {
          name: "OperationCliError",
          operationId: id,
          operationErrorName: failure?.name,
          message: failure?.message,
        },
  );
};

describe("shared review operations", () => {
  it("exposes all six executable review routes with their established CLI mappings", () => {
    const operations = new DefaultReviewOperations({ cwd: process.cwd() }).operations();
    expect(operations.map(({ id, cli }) => [id, cli.path.join(" ")])).toEqual([
      ["review-schema", "review schema"],
      ["review-validate", "review validate"],
      ["review-render", "review render"],
      ["review-state", "review state"],
      ["review-context", "review context"],
      ["review-plan", "review plan"],
    ]);
  });

  it("returns canonical schemas and normalizes valid review data in process", async () => {
    const registry = registryFor();
    await expect(registry.invoke("review-schema", { transport: false })).resolves.toMatchObject({
      status: "success",
      data: { properties: expect.objectContaining({ findings: expect.any(Object) }) },
    });
    await expect(registry.invoke("review-schema", { transport: true })).resolves.toMatchObject({
      status: "success",
      data: { properties: expect.objectContaining({ findings: expect.any(Object) }) },
    });
    await expect(registry.invoke("review-validate", { review: makeReview() })).resolves.toEqual({
      status: "success",
      data: makeReview(),
    });
  });

  it("rejects malformed reviews, persisted markers, and state indexes", async () => {
    const registry = registryFor();
    await expect(
      registry.invoke("review-validate", { review: { ...makeReview(), extra: true } }),
    ).resolves.toMatchObject({ status: "error", error: { name: "ZodError" } });

    const record = makeRecord();
    await expect(
      registry.invoke("review-render", {
        review: makeReview(),
        records: [{ ...record, evidence: [{ kind: "unknown" }] }],
        outcome: "INCOMPLETE",
        problems: [],
      }),
    ).rejects.toMatchObject({ name: "OperationInputError" });
    await expect(
      registry.invoke("review-state", {
        state: {
          v: 1,
          schema_revision: 1,
          sha: head,
          outcome: "APPROVED",
          records: [
            { id: "f-0000000001", status: "open", location: { kind: "review_body", review_id: 1 } },
            { id: "f-0000000001", status: "open", location: { kind: "review_body", review_id: 2 } },
          ],
        },
      }),
    ).resolves.toMatchObject({ status: "error", error: { name: "InvalidReviewError" } });
  });

  it("renders with the public codec and formats validated state markers", async () => {
    const registry = registryFor();
    const record = makeRecord();
    const rendered = await registry.invoke("review-render", {
      review: makeReview(),
      records: [record],
      outcome: "INCOMPLETE",
      problems: ["retained blocker"],
    });
    expect(rendered).toMatchObject({
      status: "success",
      data: {
        headSha: head,
        outcome: "INCOMPLETE",
        problems: ["retained blocker"],
        findings: [
          { id: record.finding.id, status: "open", body: new JsonReviewCodec().render(record) },
        ],
      },
    });
    await expect(
      registry.invoke("review-state", {
        state: {
          v: 1,
          schema_revision: 1,
          sha: head,
          outcome: "APPROVED",
          records: [],
        },
      }),
    ).resolves.toEqual({
      status: "success",
      data: new JsonReviewCodec().state({
        v: 1,
        schema_revision: 1,
        sha: head,
        outcome: "APPROVED",
        records: [],
      }),
    });
  });

  it("reads context from the launch checkout at the requested trusted commit", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-operation-context-"));
    dirs.push(cwd);
    execFileSync("git", ["init", "-q"], { cwd });
    writeFileSync(join(cwd, "CODE-REVIEW.md"), "Trusted review instructions.\n");
    execFileSync("git", ["add", "CODE-REVIEW.md"], { cwd });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "trusted"],
      { cwd },
    );
    const trustedRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    writeFileSync(join(cwd, "CODE-REVIEW.md"), "Untrusted working tree edit.\n");
    const registry = new MapOperationRegistry({
      operations: new DefaultReviewOperations({ cwd, trustedRef }).operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "process"] }),
    });

    await expect(
      registry.invoke("review-context", { contextPath: "CODE-REVIEW.md" }),
    ).resolves.toMatchObject({
      status: "success",
      data: {
        trustedRef,
        sources: [{ path: "CODE-REVIEW.md", contents: "Trusted review instructions.\n" }],
      },
    });
    await expect(
      registry.invoke("review-context", { contextPath: "../outside.md" }),
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      registry.invoke("review-context", {
        trustedRef: "b".repeat(40),
        contextPath: "CODE-REVIEW.md",
      }),
    ).rejects.toMatchObject({ name: "OperationInputError" });
    await expect(
      registry.invoke("review-context", {
        cwd: process.cwd(),
        contextPath: "CODE-REVIEW.md",
      }),
    ).rejects.toMatchObject({ name: "OperationInputError" });

    await expectJsonParity(registry, "review-context", { contextPath: "CODE-REVIEW.md" }, [
      "context",
      "--ref",
      trustedRef,
      "--cwd",
      cwd,
    ]);
    await expectFailureParity(registry, "review-context", { contextPath: "../outside.md" }, [
      "context",
      "--ref",
      trustedRef,
      "--cwd",
      cwd,
      "--path",
      "../outside.md",
    ]);
  });

  it("binds concurrent git and gh subprocesses to each core's launch cwd and environment", async () => {
    const launches = ["alpha", "beta"].map((marker) => {
      const cwd = mkdtempSync(join(tmpdir(), `review-subprocess-${marker}-`));
      dirs.push(cwd);
      const bin = join(cwd, "bin");
      mkdirSync(bin);
      const log = join(cwd, "calls.log");
      writeExecutable(
        join(bin, "git"),
        `#!/bin/sh\nprintf '%s|%s|%s\\n' "$REVIEW_MARKER" "$PWD" "$*" >> "$REVIEW_LOG"\nif [ "$1" = "ls-tree" ] && [ "$5" = "CODE-REVIEW.md" ]; then printf '100644 blob %s\\tCODE-REVIEW.md\\000' "$REVIEW_BLOB"; fi\nif [ "$1" = "show" ]; then printf '%s' "$REVIEW_CONTENT"; fi\n`,
      );
      writeExecutable(
        join(bin, "gh"),
        `#!/bin/sh\nprintf '%s|%s|%s\\n' "$REVIEW_MARKER" "$PWD" "$*" >> "$REVIEW_LOG"\nprintf '{"head":{"sha":"${head}"},"user":{"id":10}}'\n`,
      );
      const env = {
        PATH: bin,
        REVIEW_MARKER: marker,
        REVIEW_LOG: log,
        REVIEW_BLOB: "c".repeat(40),
        REVIEW_CONTENT: `trusted ${marker} context`,
      };
      const core = createFlightRules({ cwd, env });
      const registry = new MapOperationRegistry({
        operations: core.reviewOperations({ trustedRef: head }).operations(),
        policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network", "process"] }),
      });
      return { cwd, env, log, registry, marker };
    });

    await Promise.all(
      launches.flatMap(({ registry }) => [
        registry.invoke("review-context", { contextPath: "CODE-REVIEW.md" }),
        registry.invoke("review-plan", {
          number: 1,
          repo: "owner/repo",
          review: makeReview(),
          records: [],
        }),
      ]),
    );

    for (const { cwd, env, log, marker } of launches) {
      const calls = readFileSync(log, "utf8");
      const actualCwd = realpathSync(cwd);
      expect(calls).toContain(`${marker}|${actualCwd}|ls-tree`);
      expect(calls).toContain(`${marker}|${actualCwd}|show`);
      expect(calls).toContain(`${marker}|${actualCwd}|api /repos/owner/repo/pulls/1`);
      expect(env.REVIEW_MARKER).toBe(marker);
    }
  });

  it("uses current GitHub head, preserves blockers, rejects stale evidence, and gates network effects", async () => {
    const api = createGitHubApi();
    const registry = registryFor(api);
    await expect(
      registry.invoke("review-plan", {
        number: 1,
        repo: "owner/repo",
        review: makeReview(),
        records: [],
      }),
    ).resolves.toMatchObject({ status: "success", data: { outcome: "APPROVED" } });
    await expect(
      registry.invoke("review-plan", {
        number: 1,
        repo: "owner/repo",
        review: makeReview({ head_sha: "b".repeat(40) }),
        records: [],
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("stale") },
    });
    await expect(
      registry.invoke("review-plan", {
        number: 1,
        repo: "owner/repo",
        review: makeReview(),
        records: [makeRecord()],
      }),
    ).resolves.toMatchObject({
      status: "success",
      data: {
        outcome: "INCOMPLETE",
        records: [{ status: "open" }],
        problems: [expect.stringContaining("omitted open finding")],
      },
    });
    await expect(
      registry.invoke("review-plan", {
        number: 1,
        repo: "owner/repo",
        review: makeReview({
          prior_findings: [
            {
              id: "f-0000000001",
              status: "resolved",
              reason: "A commit is claimed to fix this blocker.",
              evidence: [{ kind: "commit", sha: "b".repeat(40) }],
            },
          ],
        }),
        records: [makeRecord()],
      }),
    ).resolves.toMatchObject({
      status: "success",
      data: {
        outcome: "INCOMPLETE",
        records: [{ status: "open" }],
        problems: [expect.stringContaining("evidence could not be validated")],
      },
    });

    const deniedApi = createGitHubApi();
    const denied = registryFor(deniedApi, ["read", "process"]);
    await expect(
      denied.invoke("review-plan", {
        number: 1,
        repo: "owner/repo",
        review: makeReview(),
        records: [],
      }),
    ).resolves.toMatchObject({ status: "error", error: { name: "OperationAccessDeniedError" } });
    expect(deniedApi.get).not.toHaveBeenCalled();
    const deniedInput = {
      number: 1,
      repo: "owner/repo",
      review: makeReview(),
      records: [],
    };
    await expectFailureParity(
      denied,
      "review-plan",
      deniedInput,
      [
        "plan",
        "1",
        "--repo",
        deniedInput.repo,
        "--file",
        jsonFile(deniedInput.review),
        "--records-file",
        jsonFile(deniedInput.records),
      ],
      { api: deniedApi, allowedEffects: [] },
    );
    expect(deniedApi.get).not.toHaveBeenCalled();
  });

  it("retains a decision without human authority even when its comment is authentic", async () => {
    const api = createGitHubApi({ commentType: "Bot" });
    const registry = registryFor(api, undefined, {
      owners: { "security owner": ["trusted-human"] },
      requireMapping: true,
    });
    const decisionRecord = makeRecord({
      finding: {
        ...makeRecord().finding,
        type: "decide",
        decision_owner: "security owner",
        decision_options: [
          { id: "allow", description: "Allow the capability." },
          { id: "deny", description: "Keep it unavailable." },
        ],
      },
    });
    const comment = {
      kind: "github_comment",
      comment_id: 123,
      url: "https://github.com/owner/repo/pull/1#issuecomment-123",
    };
    const result = await registry.invoke("review-plan", {
      number: 1,
      repo: "owner/repo",
      review: makeReview({
        outcome: "CHANGES_NEEDED",
        prior_findings: [
          {
            id: decisionRecord.finding.id,
            status: "still_open",
            reason: "The authorized owner declined.",
            evidence: [comment],
            decision: { comment_id: 123, author_id: 20, option_id: "deny" },
          },
        ],
      }),
      records: [decisionRecord],
    });

    expect(result).toMatchObject({
      status: "success",
      data: {
        outcome: "INCOMPLETE",
        records: [{ status: "open", finding: { type: "decide" } }],
        problems: [expect.stringContaining("decision authorization was not verified")],
      },
    });
  });

  it("rejects caller-supplied authority policy that names the PR author", async () => {
    const api = createGitHubApi({ commentId: 10, commentLogin: "pr-author" });
    const registry = registryFor(api, undefined, { owners: {}, requireMapping: true });
    const record = makeRecord({
      finding: {
        ...makeRecord().finding,
        type: "decide",
        decision_owner: "security",
        decision_options: [
          { id: "allow", description: "Allow the capability." },
          { id: "deny", description: "Keep it unavailable." },
        ],
      },
    });
    const input = {
      number: 1,
      repo: "owner/repo",
      review: makeReview({
        prior_findings: [
          {
            id: record.finding.id,
            status: "resolved",
            reason: "The owner approved.",
            evidence: [
              {
                kind: "github_comment",
                comment_id: 123,
                url: "https://github.com/owner/repo/pull/1#issuecomment-123",
              },
            ],
            decision: { comment_id: 123, author_id: 10, option_id: "allow" },
          },
        ],
      }),
      records: [record],
    };

    await expect(registry.invoke("review-plan", input)).resolves.toMatchObject({
      status: "success",
      data: {
        outcome: "INCOMPLETE",
        records: [{ status: "open" }],
        problems: [expect.stringContaining("decision authorization was not verified")],
      },
    });
    await expect(
      registry.invoke("review-plan", {
        ...input,
        owners: { security: ["pr-author"] },
        requireMapping: false,
      }),
    ).rejects.toMatchObject({ name: "OperationInputError" });
  });
});

describe("review Commander and operation parity", () => {
  it.each([false, true])("prints the same schema with transport=%s", async (transport) => {
    const registry = registryFor();
    const result = await registry.invoke("review-schema", { transport });
    expect(result.status).toBe("success");
    if (result.status === "success")
      expect(
        await runReviewCli(registry, ["schema", ...(transport ? ["--transport"] : [])]),
      ).toEqual({
        stdout: `${JSON.stringify(result.data, null, 2)}\n`,
        error: undefined,
      });
  });

  it("loads a review JSON file and prints the operation's normalized result", async () => {
    const { id, ...finding } = makeRecord().finding;
    const review = makeReview({
      findings: [{ ...finding, label: "nitpick", blocking: false }],
    });
    const result = await expectJsonParity(registryFor(), "review-validate", { review }, [
      "validate",
      jsonFile(review),
    ]);
    expect(result).toMatchObject({ findings: [{ label: "issue", blocking: true }] });
    expect(result).not.toMatchObject({ findings: [{ id }] });
  });

  it("renders retained blockers and serializes state with the same durable markers", async () => {
    const registry = registryFor();
    const record = makeRecord({
      finding: { ...makeRecord().finding, details: "Keep --> inside the complete stored brief." },
    });
    const plan = {
      review: makeReview(),
      records: [record],
      outcome: "INCOMPLETE",
      problems: ["Retained blocker."],
    };
    const rendered = await expectJsonParity(registry, "review-render", plan, [
      "render",
      jsonFile({ ...plan, informational: [] }),
    ]);
    expect(rendered).toMatchObject({
      outcome: "INCOMPLETE",
      problems: plan.problems,
      findings: [
        { id: record.finding.id, status: "open", body: new JsonReviewCodec().render(record) },
      ],
    });

    const state = {
      v: 1,
      schema_revision: 1,
      sha: head,
      outcome: "INCOMPLETE",
      records: [
        {
          id: record.finding.id,
          status: "open",
          location: { kind: "review_comment", comment_id: 123 },
        },
      ],
    };
    const result = await registry.invoke("review-state", { state });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(await runReviewCli(registry, ["state", jsonFile(state)])).toEqual({
        stdout: `${String(result.data)}\n`,
        error: undefined,
      });
      expect(
        new JsonReviewCodec().readState({
          body: String(result.data),
          authorId: 20,
          trustedAuthorIds: [20],
        }),
      ).toEqual(state);
    }
  });

  it("preserves malformed review, finding-marker, and state-index failures without output", async () => {
    const registry = registryFor();
    const malformedReview = { ...makeReview(), extra: true };
    await expectFailureParity(registry, "review-validate", { review: malformedReview }, [
      "validate",
      jsonFile(malformedReview),
    ]);
    const malformedPlan = {
      review: makeReview(),
      records: [{ ...makeRecord(), v: 99 }],
      outcome: "APPROVED",
      problems: [],
    };
    await expectFailureParity(registry, "review-render", malformedPlan, [
      "render",
      jsonFile(malformedPlan),
    ]);
    const malformedState = {
      v: 1,
      schema_revision: 1,
      sha: head,
      outcome: "APPROVED",
      records: [
        { id: "f-0000000001", status: "open", location: { kind: "review_body", review_id: 1 } },
        { id: "f-0000000001", status: "open", location: { kind: "review_body", review_id: 2 } },
      ],
    };
    await expectFailureParity(registry, "review-state", { state: malformedState }, [
      "state",
      jsonFile(malformedState),
    ]);
  });

  it.each([
    { name: "first review", records: [], transitions: [], outcome: "APPROVED", status: undefined },
    {
      name: "omitted blocker",
      records: [makeRecord()],
      transitions: [],
      outcome: "INCOMPLETE",
      status: "open",
    },
    {
      name: "verified current-head check",
      records: [makeRecord()],
      transitions: [
        {
          id: "f-0000000001",
          status: "resolved",
          reason: "Current CI verifies the fix.",
          evidence: [{ kind: "check_run", check_run_id: 991, commit_sha: head }],
        },
      ],
      outcome: "APPROVED",
      status: "resolved",
    },
    {
      name: "stale check evidence",
      records: [makeRecord()],
      transitions: [
        {
          id: "f-0000000001",
          status: "resolved",
          reason: "Earlier CI is claimed as proof.",
          evidence: [{ kind: "check_run", check_run_id: 991, commit_sha: "b".repeat(40) }],
        },
      ],
      outcome: "INCOMPLETE",
      status: "open",
    },
    {
      name: "missing GitHub check",
      records: [makeRecord()],
      transitions: [
        {
          id: "f-0000000001",
          status: "resolved",
          reason: "The claimed check is unavailable.",
          evidence: [{ kind: "check_run", check_run_id: 992, commit_sha: head }],
        },
      ],
      outcome: "INCOMPLETE",
      status: "open",
    },
  ])(
    "plans $name identically through JSON files and object inputs",
    async ({ records, transitions, outcome, status }) => {
      const api = createGitHubApi();
      const input = {
        number: 1,
        repo: "owner/repo",
        review: makeReview({ prior_findings: transitions }),
        records,
      };
      const result = await expectJsonParity(registryFor(api), "review-plan", input, [
        "plan",
        "1",
        "--repo",
        input.repo,
        "--file",
        jsonFile(input.review),
        "--records-file",
        jsonFile(records),
      ]);
      expect(result).toMatchObject({ outcome, records: status === undefined ? [] : [{ status }] });
      expect(api.get).toHaveBeenCalledWith("/repos/owner/repo/pulls/1");
      if (outcome === "INCOMPLETE")
        expect(result).toMatchObject({ problems: [expect.any(String)], records: [makeRecord()] });
    },
  );

  it.each([
    { name: "stale head", review: makeReview({ head_sha: "b".repeat(40) }) },
    { name: "invalid contract", review: { ...makeReview(), extra: true } },
    {
      name: "resolution without evidence",
      review: {
        ...makeReview(),
        prior_findings: [
          { id: "f-0000000001", status: "resolved", reason: "Trust the claim.", evidence: [] },
        ],
      },
    },
  ])("fails a plan with $name identically", async ({ review }) => {
    const input = { number: 1, repo: "owner/repo", review, records: [makeRecord()] };
    await expectFailureParity(registryFor(), "review-plan", input, [
      "plan",
      "1",
      "--repo",
      input.repo,
      "--file",
      jsonFile(review),
      "--records-file",
      jsonFile(input.records),
    ]);
  });

  it.each([
    {
      commentType: "User",
      owners: { "security owner": ["reviewer"] },
      outcome: "APPROVED",
      status: "resolved",
    },
    {
      commentType: "User",
      owners: { "security owner": ["another-human"] },
      outcome: "INCOMPLETE",
      status: "open",
    },
    { commentType: "User", owners: {}, outcome: "INCOMPLETE", status: "open" },
    {
      commentType: "Bot",
      owners: { "security owner": ["reviewer"] },
      outcome: "INCOMPLETE",
      status: "open",
    },
  ])(
    "retains authority checks with $commentType, owners=$owners",
    async ({ commentType, owners, outcome, status }) => {
      const record = makeRecord({
        finding: {
          ...makeRecord().finding,
          type: "decide",
          decision_owner: "security owner",
          decision_options: [
            { id: "allow", description: "Allow the capability." },
            { id: "deny", description: "Keep it unavailable." },
          ],
        },
      });
      const review = makeReview({
        prior_findings: [
          {
            id: record.finding.id,
            status: "resolved",
            reason: "The owner declined and no implementation remains.",
            evidence: [
              {
                kind: "github_comment",
                comment_id: 123,
                url: "https://github.com/owner/repo/pull/1#issuecomment-123",
              },
            ],
            decision: { comment_id: 123, author_id: 20, option_id: "deny" },
          },
        ],
      });
      const input = {
        number: 1,
        repo: "owner/repo",
        review,
        records: [record],
      };
      const api = createGitHubApi({ commentType });
      const launch = { owners, requireMapping: true };
      const result = await expectJsonParity(
        registryFor(api, undefined, launch),
        "review-plan",
        input,
        [
          "plan",
          "1",
          "--repo",
          input.repo,
          "--file",
          jsonFile(review),
          "--records-file",
          jsonFile(input.records),
          "--owners-file",
          jsonFile(owners),
          "--require-mapping",
        ],
        { api },
      );
      expect(result).toMatchObject({ outcome, records: [{ status, finding: record.finding }] });
      if (status === "open")
        expect(result).toMatchObject({
          problems: [expect.stringContaining("decision authorization was not verified")],
        });
    },
  );

  it("denies every review route before repository reads or GitHub evidence calls", async () => {
    const api = createGitHubApi();
    const policy = new FileReviewPolicy();
    const repository = vi.spyOn(policy, "repository");
    const registry = new MapOperationRegistry({
      operations: new DefaultReviewOperations({ cwd: process.cwd(), api, policy }).operations(),
      policy: new LaunchOperationAccessPolicy(),
    });
    const review = makeReview();
    const plan = { review, records: [], outcome: "APPROVED", problems: [] };
    const state = { v: 1, schema_revision: 1, sha: head, outcome: "APPROVED", records: [] };
    const routes = [
      { id: "review-schema", input: {}, args: ["schema"] },
      { id: "review-validate", input: { review }, args: ["validate", jsonFile(review)] },
      { id: "review-render", input: plan, args: ["render", jsonFile(plan)] },
      { id: "review-state", input: { state }, args: ["state", jsonFile(state)] },
      {
        id: "review-context",
        input: { contextPath: "CODE-REVIEW.md" },
        args: ["context", "--ref", head],
      },
      {
        id: "review-plan",
        input: { number: 1, repo: "owner/repo", review, records: [] },
        args: [
          "plan",
          "1",
          "--repo",
          "owner/repo",
          "--file",
          jsonFile(review),
          "--records-file",
          jsonFile([]),
        ],
      },
    ];
    try {
      for (const { id, input, args } of routes) {
        await expect(registry.invoke(id, input)).resolves.toMatchObject({
          status: "error",
          error: { name: "OperationAccessDeniedError" },
        });
        await expectFailureParity(registry, id, input, args, {
          api,
          allowedEffects: [],
        });
      }
      expect(repository).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
      expect(api.graphql).not.toHaveBeenCalled();
    } finally {
      repository.mockRestore();
    }
  });
});
