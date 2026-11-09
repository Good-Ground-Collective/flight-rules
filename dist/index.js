// src/bundled-docs/doc-resolver/doc-resolver.ts
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
var DocIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var FileDocResolverPropsSchema = z.object({ docsDir: z.string().min(1) });
var InstallDocsPropsSchema = z.object({
  moduleUrl: z.url().refine((value) => value.startsWith("file:")),
  env: z.record(z.string(), z.string().optional())
});
var DocNotFoundPropsSchema = z.object({ id: z.string(), available: z.array(z.string()) });
var InvalidDocIdError = class extends Error {
  name = "InvalidDocIdError";
};
var DocsUnavailableError = class extends Error {
  name = "DocsUnavailableError";
};
var DocNotFoundError = class extends Error {
  name = "DocNotFoundError";
  available;
  constructor(props) {
    const parsed = DocNotFoundPropsSchema.parse(props);
    super(`Unknown doc "${parsed.id}" \u2014 available: ${parsed.available.join(", ")}`);
    this.available = parsed.available;
  }
};
var FileDocResolver = class _FileDocResolver {
  docsDir;
  constructor(props) {
    this.docsDir = resolve(FileDocResolverPropsSchema.parse(props).docsDir);
  }
  list() {
    return readdirSync(this.docsDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name.slice(0, -3)).sort();
  }
  resolve(id) {
    if (!DocIdSchema.safeParse(id).success) {
      throw new InvalidDocIdError("Invalid doc id \u2014 use lowercase letters, digits, and single hyphens");
    }
    const path = join(this.docsDir, `${id}.md`);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new DocNotFoundError({ id, available: this.list() });
    }
    const realPath = realpathSync(path);
    if (!realPath.startsWith(`${realpathSync(this.docsDir)}${sep}`)) {
      throw new DocNotFoundError({ id, available: this.list() });
    }
    return { id, path: realPath, contents: readFileSync(realPath, "utf8") };
  }
  static fromInstall(props) {
    const { moduleUrl, env } = InstallDocsPropsSchema.parse({ ...props, env: { ...props.env } });
    const override = env["FLIGHT_RULES_HOME"]?.trim();
    const home = override || join(dirname(fileURLToPath(moduleUrl)), "..");
    const docsDir = resolve(home, "docs");
    if (!existsSync(docsDir) || !statSync(docsDir).isDirectory()) {
      const source = override ? `FLIGHT_RULES_HOME is set to ${override} but` : "Bundled docs directory";
      throw new DocsUnavailableError(`${source} ${docsDir} does not exist or is not a directory \u2014 point FLIGHT_RULES_HOME at the flight-rules install root`);
    }
    return new _FileDocResolver({ docsDir });
  }
};

// src/flight-rules/flight-rules.ts
import { resolve as resolve10 } from "node:path";

// src/git/git-executor/git-executor.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z as z3 } from "zod";

// src/git/semantic-types.ts
import { z as z2 } from "zod";
var semanticTypes = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "style",
  "revert"
];
var SemanticTypeSchema = z2.enum(semanticTypes);

// src/git/branch-namer/branch-namer.ts
var BranchNamer = class {
  name(spec) {
    const semanticTypeValidation = SemanticTypeSchema.safeParse(spec.type);
    if (!semanticTypeValidation.success) {
      throw new Error(
        `invalid branch type "${spec.type}" \u2014 must be one of: ${semanticTypes.join(", ")}`
      );
    }
    if (spec.scope.trim() === "") {
      throw new Error("branch scope is required");
    }
    const slug = spec.description !== void 0 && spec.description !== "" ? `-${spec.description}` : "";
    return `${spec.type}/${spec.scope}${slug}`;
  }
};
var branchNamer = new BranchNamer();

// src/git/git-executor/git-executor.ts
var NodeGitExecutorPropsSchema = z3.object({
  cwd: z3.string().min(1).optional(),
  env: z3.record(z3.string(), z3.string().optional()).default(() => ({ ...process.env })),
  execFile: z3.custom((value) => typeof value === "function").optional()
});
var PushSpecSchema = z3.object({
  // A detached HEAD makes `rev-parse --abbrev-ref` yield the literal "HEAD", which would push a ref rather than a branch.
  branch: z3.string().min(1, "branch is required").refine((branch) => branch !== "HEAD", {
    message: "cannot push from a detached HEAD \u2014 check out a branch first"
  }),
  remote: z3.string().min(1).default("origin"),
  // Defaults true to match the CLI's `--no-set-upstream`, so a programmatic push tracks the branch too.
  setUpstream: z3.boolean().default(true)
});
var NodeGitExecutor = class {
  execFile;
  cwd;
  env;
  constructor(props = {}) {
    const parsed = NodeGitExecutorPropsSchema.parse(props);
    const promisified = promisify(execFile);
    this.cwd = parsed.cwd ?? process.cwd();
    this.env = { ...parsed.env };
    this.execFile = parsed.execFile ?? (async (file, args, options) => {
      const result = await promisified(file, [...args], { ...options, encoding: "utf8" });
      return { stdout: result.stdout, stderr: result.stderr };
    });
  }
  async stage(files) {
    if (files.length === 0) return;
    await this.run(["add", "--", ...files]);
  }
  async commit(message, files) {
    if (files !== void 0 && files.length > 0) {
      await this.run(["commit", "--cleanup=whitespace", "--only", "-m", message, "--", ...files]);
      return;
    }
    await this.run(["commit", "--cleanup=whitespace", "-m", message]);
  }
  async getCommitSha() {
    const { stdout } = await this.run(["rev-parse", "HEAD"]);
    return stdout.trim();
  }
  async checkout(spec, from) {
    const branch = branchNamer.name(spec);
    const args = ["checkout", "-b", branch];
    if (from !== void 0) args.push(from);
    await this.run(args);
    return branch;
  }
  async startBranch(spec, from) {
    const branch = branchNamer.name(spec);
    const current = await this.getCurrentBranch();
    if (await this.isDisposableWorktreeBranch(current, from)) {
      await this.run(["branch", "-m", branch]);
      return { branch, renamedFrom: current };
    }
    return { branch: await this.checkout(spec, from), renamedFrom: null };
  }
  async getCurrentBranch() {
    const { stdout } = await this.run(["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  }
  async push(spec) {
    const parsed = PushSpecSchema.parse(spec);
    const args = ["push"];
    if (parsed.setUpstream) args.push("--set-upstream");
    args.push(parsed.remote, parsed.branch);
    await this.run(args);
  }
  async isDisposableWorktreeBranch(current, from) {
    if (current === "HEAD") return false;
    const { stdout: dirs } = await this.run([
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir"
    ]);
    const [gitDir, commonDir] = dirs.trim().split("\n");
    if (gitDir === void 0 || gitDir === commonDir) return false;
    if (await this.succeeds(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]))
      return false;
    if (current === await this.defaultBranch()) return false;
    const { stdout: unique } = await this.run([
      "rev-list",
      "--count",
      "HEAD",
      "--not",
      `--exclude=${current}`,
      "--branches",
      "--remotes"
    ]);
    if (unique.trim() !== "0") return false;
    if (from === void 0) return true;
    const [{ stdout: head }, { stdout: base }] = await Promise.all([
      this.run(["rev-parse", "HEAD"]),
      this.run(["rev-parse", `${from}^{commit}`])
    ]);
    return head.trim() === base.trim();
  }
  async defaultBranch() {
    try {
      const { stdout } = await this.run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      return stdout.trim().replace(/^origin\//, "");
    } catch {
      return void 0;
    }
  }
  async succeeds(args) {
    try {
      await this.run(args);
      return true;
    } catch {
      return false;
    }
  }
  run(args) {
    return this.execFile("git", args, { cwd: this.cwd, env: this.env });
  }
};

// src/pr/pull-request-host/gh-pull-request-host.ts
import { execFile as execFile2 } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { promisify as promisify2 } from "node:util";
import { z as z8 } from "zod";

// src/code-review/review-codec.ts
import { createHash } from "node:crypto";
import { z as z6 } from "zod";

// src/code-review/review-contract.ts
import { z as z5 } from "zod";

// src/code-review/review.schema.ts
import { z as z4 } from "zod";
var reviewContractVersion = 1;
var reviewSchemaRevision = 1;
var ReviewOutcomeSchema = z4.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]);
var FindingIdSchema = z4.string().regex(/^f-[a-f0-9]{10}$/);
var HeadShaSchema = z4.string().regex(/^[a-f0-9]{40}$/);
var ReviewPathSchema = z4.string().max(400).regex(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\p{Cc}]*$/u);
var TextSchema = z4.string().min(1).max(16e3);
var LineTextSchema = z4.string().min(1).max(400).regex(/^[^\r\n]+$/);
var PositiveIdSchema = z4.number().int().positive().max(Number.MAX_SAFE_INTEGER);
var HttpsUrlSchema = z4.url().regex(/^https:\/\//);
var CategorySchema = z4.enum([
  "security",
  "correctness",
  "data",
  "deployment",
  "design",
  "testing",
  "performance",
  "readability",
  "docs"
]);
var ActionLabelSchema = z4.enum([
  "issue",
  "todo",
  "suggestion",
  "question",
  "chore",
  "nitpick",
  "typo",
  "polish"
]);
var InformationLabelSchema = z4.enum(["praise", "note", "thought"]);
var SeveritySchema = z4.enum(["critical", "major", "minor", "trivial"]);
var DecisionOptionsSchema = z4.array(
  z4.strictObject({ id: z4.string().regex(/^[a-z][a-z0-9-]{0,79}$/), description: TextSchema })
).min(2);
var findingFields = {
  path: ReviewPathSchema,
  line: z4.number().int().nonnegative(),
  start_line: z4.number().int().positive().optional(),
  category: CategorySchema.optional(),
  subject: LineTextSchema,
  discussion: TextSchema,
  related_finding_id: FindingIdSchema.optional()
};
var actionFields = {
  ...findingFields,
  label: ActionLabelSchema,
  type: z4.enum(["fix", "clarify"]),
  blocking: z4.boolean(),
  severity: SeveritySchema,
  details: TextSchema,
  resolved_when: TextSchema
};
var decisionFields = {
  ...actionFields,
  type: z4.literal("decide"),
  decision_owner: LineTextSchema,
  decision_options: DecisionOptionsSchema
};
var informationFields = {
  ...findingFields,
  label: InformationLabelSchema,
  blocking: z4.literal(false),
  details: TextSchema.optional()
};
var NewFindingSchema = z4.union([
  z4.strictObject(actionFields),
  z4.strictObject(decisionFields),
  z4.strictObject(informationFields)
]);
var ActionableFindingSchema = z4.union([
  z4.strictObject({ ...actionFields, id: FindingIdSchema }),
  z4.strictObject({ ...decisionFields, id: FindingIdSchema })
]);
var StoredFindingSchema = z4.union([
  ...ActionableFindingSchema.options,
  z4.strictObject({ ...informationFields, id: FindingIdSchema })
]);
var ReviewEvidenceSchema = z4.discriminatedUnion("kind", [
  z4.strictObject({
    kind: z4.literal("github_comment"),
    comment_id: PositiveIdSchema,
    url: HttpsUrlSchema
  }),
  z4.strictObject({
    kind: z4.literal("code"),
    commit_sha: HeadShaSchema,
    path: ReviewPathSchema.min(1),
    line: z4.number().int().positive()
  }),
  z4.strictObject({ kind: z4.literal("commit"), sha: HeadShaSchema }),
  z4.strictObject({
    kind: z4.literal("check_run"),
    check_run_id: PositiveIdSchema,
    commit_sha: HeadShaSchema
  }),
  z4.strictObject({ kind: z4.literal("document"), url: HttpsUrlSchema }),
  z4.strictObject({
    kind: z4.literal("verification"),
    commit_sha: HeadShaSchema,
    command: TextSchema,
    result: z4.literal("passed"),
    report_url: HttpsUrlSchema
  }),
  z4.strictObject({
    kind: z4.literal("thread_resolution"),
    thread_id: z4.string().min(1),
    author_id: PositiveIdSchema
  })
]);
var DecisionAnswerSchema = z4.strictObject({
  comment_id: PositiveIdSchema,
  author_id: PositiveIdSchema,
  option_id: z4.string().min(1)
});
var transitionFields = {
  id: FindingIdSchema,
  reason: TextSchema,
  reply: TextSchema.optional(),
  decision: DecisionAnswerSchema.optional()
};
var PriorFindingSchema = z4.union([
  z4.strictObject({
    ...transitionFields,
    status: z4.literal("resolved"),
    evidence: z4.array(ReviewEvidenceSchema).min(1)
  }),
  z4.strictObject({
    ...transitionFields,
    status: z4.literal("withdrawn"),
    evidence: z4.array(ReviewEvidenceSchema).min(1),
    withdrawal_basis: z4.enum(["incorrect", "no_longer_applicable", "dismissed"])
  }),
  z4.strictObject({
    ...transitionFields,
    status: z4.literal("still_open"),
    evidence: z4.array(ReviewEvidenceSchema).optional(),
    updated_finding: ActionableFindingSchema.optional()
  })
]);
var reviewFields = {
  contract_version: z4.literal(reviewContractVersion),
  schema_revision: z4.literal(reviewSchemaRevision),
  head_sha: HeadShaSchema,
  review_complete: z4.boolean(),
  incomplete_reason: z4.string().max(16e3).optional(),
  summary: TextSchema,
  outcome: ReviewOutcomeSchema,
  outcome_reason: TextSchema,
  remaining_risk: TextSchema,
  extensions: z4.record(z4.string(), z4.json()).optional()
};
var ReviewSchema = z4.strictObject({
  ...reviewFields,
  findings: z4.array(NewFindingSchema),
  prior_findings: z4.array(PriorFindingSchema)
});
var FindingRecordSchema = z4.strictObject({
  v: z4.literal(reviewContractVersion),
  schema_revision: z4.literal(reviewSchemaRevision),
  finding: ActionableFindingSchema,
  status: z4.enum(["open", "resolved", "withdrawn"]),
  evidence: z4.array(ReviewEvidenceSchema),
  decision: DecisionAnswerSchema.optional()
});
var ReviewStateSchema = z4.strictObject({
  v: z4.literal(reviewContractVersion),
  schema_revision: z4.literal(reviewSchemaRevision),
  sha: HeadShaSchema,
  outcome: ReviewOutcomeSchema,
  records: z4.array(
    z4.union([
      z4.strictObject({
        id: FindingIdSchema,
        status: z4.enum(["open", "resolved", "withdrawn"]),
        location: z4.union([
          z4.strictObject({ kind: z4.literal("review_comment"), comment_id: PositiveIdSchema }),
          z4.strictObject({ kind: z4.literal("review_body"), review_id: PositiveIdSchema })
        ])
      }),
      z4.strictObject({
        id: FindingIdSchema,
        status: z4.literal("informational"),
        fingerprint: z4.string().min(1),
        finding: z4.strictObject({ ...informationFields, id: FindingIdSchema }).optional()
      })
    ])
  )
});
var TransportReviewSchema = z4.strictObject({
  ...reviewFields,
  findings: z4.array(
    z4.strictObject({
      ...actionFields,
      type: z4.enum(["fix", "clarify", "decide"]).optional(),
      label: z4.enum([...ActionLabelSchema.options, ...InformationLabelSchema.options]),
      severity: SeveritySchema.optional(),
      details: TextSchema.optional(),
      resolved_when: TextSchema.optional(),
      decision_owner: LineTextSchema.optional(),
      decision_options: DecisionOptionsSchema.optional()
    })
  ),
  prior_findings: z4.array(
    z4.strictObject({
      ...transitionFields,
      status: z4.enum(["resolved", "still_open", "withdrawn"]),
      evidence: z4.array(ReviewEvidenceSchema).optional(),
      withdrawal_basis: z4.enum(["incorrect", "no_longer_applicable", "dismissed"]).optional(),
      updated_finding: StoredFindingSchema.optional()
    })
  )
});

// src/code-review/review-contract.ts
var InvalidReviewError = class extends Error {
  name = "InvalidReviewError";
};
var ZodReviewContract = class {
  parse(value) {
    const result = ReviewSchema.parse(value);
    const ids = result.prior_findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length)
      throw new InvalidReviewError("duplicate prior finding IDs");
    if (!result.review_complete && !result.incomplete_reason?.trim()) {
      throw new InvalidReviewError("an incomplete review must explain what could not be reviewed");
    }
    const findings = result.findings.map((finding) => this.normalize(finding));
    const priorFindings = result.prior_findings.map((transition) => {
      if (transition.status !== "still_open") return transition;
      if ((transition.decision !== void 0 || transition.updated_finding !== void 0) && !transition.evidence?.length) {
        throw new InvalidReviewError(`transition ${transition.id} requires evidence`);
      }
      if (transition.updated_finding === void 0) return transition;
      if (transition.id !== transition.updated_finding.id)
        throw new InvalidReviewError("a replacement must preserve the finding ID");
      return {
        ...transition,
        updated_finding: this.normalizeActionable(transition.updated_finding)
      };
    });
    for (const transition of priorFindings) {
      if (transition.decision !== void 0 && !transition.evidence?.some(
        (evidence) => evidence.kind === "github_comment" && evidence.comment_id === transition.decision?.comment_id
      )) {
        throw new InvalidReviewError(
          `decision ${transition.id} must reference its human comment in evidence`
        );
      }
    }
    return { ...result, findings, prior_findings: priorFindings };
  }
  record(value) {
    const result = FindingRecordSchema.parse(value);
    if (result.status !== "open" && result.evidence.length === 0)
      throw new InvalidReviewError("closed records require evidence");
    return { ...result, finding: this.normalizeActionable(result.finding) };
  }
  state(value) {
    const result = ReviewStateSchema.parse(value);
    const ids = result.records.map((record) => record.id);
    if (new Set(ids).size !== ids.length)
      throw new InvalidReviewError("duplicate finding IDs in state");
    for (const record of result.records) {
      if (record.status === "informational" && record.finding !== void 0 && record.id !== record.finding.id) {
        throw new InvalidReviewError("informational index ID does not match its finding");
      }
    }
    return result;
  }
  schemas() {
    return {
      full: z5.toJSONSchema(ReviewSchema, { target: "draft-07" }),
      transport: z5.toJSONSchema(TransportReviewSchema, { target: "draft-07" })
    };
  }
  normalize(finding) {
    this.checkRange(finding);
    if (!("type" in finding)) return finding;
    if (finding.type === "decide") this.checkOptions(finding);
    const blocking = finding.blocking || finding.severity === "critical" || finding.severity === "major";
    const label = blocking && ["nitpick", "typo", "polish"].includes(finding.label) ? "issue" : finding.label;
    return { ...finding, blocking, label };
  }
  normalizeActionable(finding) {
    return ActionableFindingSchema.parse({ ...this.normalize(finding), id: finding.id });
  }
  checkRange(finding) {
    if (finding.start_line !== void 0 && (finding.line === 0 || finding.start_line > finding.line)) {
      throw new InvalidReviewError("start_line must not exceed a positive line anchor");
    }
  }
  checkOptions(finding) {
    const ids = finding.decision_options.map((option) => option.id);
    if (new Set(ids).size !== ids.length)
      throw new InvalidReviewError("decision option IDs must be unique");
  }
};
var reviewContract = new ZodReviewContract();

// src/code-review/review-codec.ts
var MarkerInputSchema = z6.strictObject({
  body: z6.string(),
  authorId: z6.number().int().positive(),
  trustedAuthorIds: z6.array(z6.number().int().positive())
});
var JsonReviewCodec = class {
  finding(record) {
    return this.marker("finding", reviewContract.record(record));
  }
  state(state) {
    return this.marker("state", reviewContract.state(state));
  }
  readFindings(input) {
    const parsed = MarkerInputSchema.parse(input);
    if (!parsed.trustedAuthorIds.includes(parsed.authorId)) return [];
    return this.readMarkers(parsed.body, "finding").map((value) => reviewContract.record(value));
  }
  readState(input) {
    const parsed = MarkerInputSchema.parse(input);
    if (!parsed.trustedAuthorIds.includes(parsed.authorId)) return void 0;
    const states = this.readMarkers(parsed.body, "state");
    if (states.length > 1)
      throw new InvalidReviewError("multiple review state markers in one summary");
    return states.length === 0 ? void 0 : reviewContract.state(states[0]);
  }
  parseFinding(body) {
    const markers = this.readMarkers(body, "finding");
    if (markers.length > 1) throw new InvalidReviewError("multiple finding markers in one comment");
    return markers.length === 0 ? null : reviewContract.record(markers[0]);
  }
  render(record) {
    const validated = reviewContract.record(record);
    const finding = validated.finding;
    const decorations = [
      ...["nitpick", "typo", "polish"].includes(finding.label) ? [] : [finding.blocking ? "blocking" : "non-blocking"],
      finding.type
    ];
    if (finding.category !== void 0) decorations.push(finding.category);
    const owner = finding.type === "decide" ? `

**Decision owner:** ${finding.decision_owner}
**Decision options:** ${finding.decision_options.map((option) => `\`${option.id}\`: ${option.description}`).join("; ")}` : "";
    return `**${finding.label} (${decorations.join(", ")}):** ${finding.subject}

${finding.discussion}

<details>
<summary>Details For LLM</summary>

${finding.details}${owner}

**Resolved when:** ${finding.resolved_when}
</details>

${this.finding(validated)}`;
  }
  fingerprint(finding) {
    return createHash("sha256").update(`${finding.path}|${finding.label}|${finding.subject.trim().toLowerCase()}`).digest("hex");
  }
  marker(kind, value) {
    return `<!-- code-review:${kind} ${JSON.stringify(value).replaceAll(">", "\\u003e")} -->`;
  }
  readMarkers(body, kind) {
    const prefix = `<!-- code-review:${kind} `;
    const matches = [...body.matchAll(new RegExp(`${prefix}([\\s\\S]*?) -->`, "g"))];
    if (body.split(prefix).length - 1 !== matches.length)
      throw new InvalidReviewError("unterminated review marker");
    return matches.map((match) => {
      try {
        return JSON.parse(match[1] ?? "");
      } catch {
        throw new InvalidReviewError(
          "review marker contains invalid JSON; recover state before approving"
        );
      }
    });
  }
};

// src/git/pr-template/pr-template.ts
import { z as z7 } from "zod";
var maxChangeLineLength = 256;
var maxChangeLines = 5;
var PullRequestTemplateSchema = z7.object({
  type: z7.enum(semanticTypes),
  scope: z7.string().min(1),
  description: z7.string().min(1),
  whatWasChanged: z7.array(z7.string().min(1).max(maxChangeLineLength)).min(1).max(maxChangeLines),
  whyWasItChanged: z7.string().min(1),
  otsMaterials: z7.string().min(1).optional(),
  ticketId: z7.string().min(1).optional(),
  ticketUrl: z7.url().optional(),
  baseBranch: z7.string().min(1),
  headBranch: z7.string().min(1),
  reviewers: z7.array(z7.string()).default([]),
  labels: z7.array(z7.string()).default([])
});
var DefaultPullRequestBuilder = class {
  build(input) {
    const parsed = PullRequestTemplateSchema.parse(input);
    const title = `${parsed.type}(${parsed.scope}): ${parsed.description}`;
    const sections = [
      "## What Was Changed",
      "",
      ...parsed.whatWasChanged.map((change) => `- ${change}`),
      "",
      "## Why Was It Changed",
      "",
      parsed.whyWasItChanged
    ];
    if (parsed.otsMaterials !== void 0) {
      sections.push(
        "",
        "## OTS Materials",
        "",
        "<details><summary>Click to expand</summary>",
        "",
        parsed.otsMaterials,
        "",
        "</details>"
      );
    }
    const ticketLink = this.renderTicketLink(parsed.ticketId, parsed.ticketUrl);
    if (ticketLink !== void 0) {
      sections.push("", "## Ticket Link", "", `- ${ticketLink}`);
    }
    return { title, body: sections.join("\n") };
  }
  /**
   * A markdown link when a URL is present, the bare id when only an id is, the
   * bare URL when only a URL is, and nothing when neither is — so the section
   * is omitted rather than rendered empty.
   */
  renderTicketLink(ticketId, ticketUrl) {
    if (ticketId !== void 0 && ticketUrl !== void 0) return `[${ticketId}](${ticketUrl})`;
    if (ticketId !== void 0) return ticketId;
    if (ticketUrl !== void 0) return ticketUrl;
    return void 0;
  }
};
var pullRequestBuilder = new DefaultPullRequestBuilder();

// src/pr/pull-request-host/gh-pull-request-host.ts
var GhPullRequestHostPropsSchema = z8.object({
  repo: z8.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected "owner/repo"'),
  cwd: z8.string().min(1).optional(),
  env: z8.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional()
});
var GhPullRequestListSchema = z8.array(
  z8.object({
    number: z8.number(),
    url: z8.string(),
    headRefName: z8.string(),
    baseRefName: z8.string(),
    title: z8.string()
  })
);
var reviewThreadsQuery = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number url title body headRefName headRefOid baseRefName
      author { login }
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 100) {
            totalCount
            nodes { id url body createdAt author { type: __typename login } }
          }
        }
      }
    }
  }
}`;
var replyToReviewThreadMutation = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) {
    comment { id url }
  }
}`;
var GhReplyToReviewThreadSchema = z8.object({
  data: z8.object({
    addPullRequestReviewThreadReply: z8.object({
      comment: z8.object({ id: z8.string(), url: z8.string() })
    })
  })
});
var GhReviewThreadsPageSchema = z8.object({
  data: z8.object({
    repository: z8.object({
      pullRequest: z8.object({
        number: z8.number(),
        url: z8.string(),
        title: z8.string(),
        body: z8.string(),
        headRefName: z8.string(),
        headRefOid: z8.string(),
        baseRefName: z8.string(),
        author: z8.object({ login: z8.string() }).nullable(),
        reviewThreads: z8.object({
          pageInfo: z8.object({ hasNextPage: z8.boolean(), endCursor: z8.string().nullable() }),
          nodes: z8.array(
            z8.object({
              id: z8.string(),
              isResolved: z8.boolean(),
              isOutdated: z8.boolean(),
              path: z8.string(),
              line: z8.number().nullable(),
              originalLine: z8.number().nullable(),
              comments: z8.object({
                totalCount: z8.number(),
                nodes: z8.array(
                  z8.object({
                    id: z8.string(),
                    url: z8.string(),
                    body: z8.string(),
                    createdAt: z8.string(),
                    author: z8.object({ type: z8.string(), login: z8.string() }).nullable()
                  })
                )
              })
            })
          )
        })
      })
    })
  })
});
var pullUrl = /\/pull\/(\d+)\b/;
var GhOutputParseError = class extends Error {
  name = "GhOutputParseError";
  constructor(stdout) {
    super(`gh did not print a pull request URL on stdout: ${JSON.stringify(stdout)}`);
  }
};
var GhPullRequestHost = class {
  repo;
  builder;
  codec;
  execFile;
  constructor(props) {
    const parsed = GhPullRequestHostPropsSchema.parse(props);
    this.repo = parsed.repo;
    this.builder = props.builder ?? new DefaultPullRequestBuilder();
    this.codec = new JsonReviewCodec();
    const promisified = promisify2(execFile2);
    const cwd = parsed.cwd ?? process.cwd();
    const env = { ...props.env ?? process.env };
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args], { cwd, env }));
  }
  async createPullRequest(input, options) {
    const template = PullRequestTemplateSchema.parse(input);
    const { title, body } = this.builder.build(template);
    const attach = options?.attach ?? [];
    const created = await this.withBodyFile(
      body,
      (bodyFile) => this.runCreate(template, title, bodyFile, attach)
    );
    for (const reviewer of template.reviewers) {
      try {
        await this.execFile("gh", ["pr", "edit", created.url, "--add-reviewer", reviewer]);
      } catch {
      }
    }
    return created;
  }
  async commentOnPullRequest(number, body, options) {
    const attach = options?.attach ?? [];
    const { stdout } = await this.withBodyFile(
      body,
      (bodyFile) => this.execFile("gh", [
        "pr",
        "comment",
        String(number),
        "--repo",
        this.repo,
        "--body-file",
        bodyFile,
        ...attach.flatMap((spec) => ["--attach", spec])
      ])
    );
    return { url: stdout.trim() };
  }
  async listOpenPullRequestsForTickets(ticketIds) {
    const { stdout } = await this.execFile("gh", [
      "pr",
      "list",
      "--repo",
      this.repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,url,headRefName,baseRefName,title"
    ]);
    const open = GhPullRequestListSchema.parse(JSON.parse(stdout));
    return ticketIds.flatMap((ticket) => {
      const id = this.escapeRegExp(ticket);
      const branch = new RegExp(`^[a-z]+/${id}(-|$)`);
      const titleScope = new RegExp(`^[a-z]+\\(${id}\\)!?:`);
      return open.filter((candidate) => branch.test(candidate.headRefName) || titleScope.test(candidate.title)).map((candidate) => ({ ticket, ...candidate }));
    });
  }
  async defaultBranch() {
    const { stdout } = await this.execFile("gh", [
      "repo",
      "view",
      this.repo,
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name"
    ]);
    return stdout.trim();
  }
  async requestReviewers(number, logins) {
    const result = { number, requested: [], failed: [] };
    for (const login of logins) {
      try {
        await this.execFile("gh", ["pr", "edit", String(number), "--repo", this.repo, "--add-reviewer", login]);
        result.requested.push(login);
      } catch (err) {
        result.failed.push({ login, error: this.describeFailure(err) });
      }
    }
    return result;
  }
  async listReviewThreads(number, options) {
    const [owner = "", name = ""] = this.repo.split("/");
    let first;
    const nodes = [];
    let cursor;
    for (; ; ) {
      const { stdout } = await this.execFile("gh", [
        "api",
        "graphql",
        "-f",
        `query=${reviewThreadsQuery}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-F",
        `number=${number}`,
        ...cursor === void 0 ? [] : ["-f", `endCursor=${cursor}`]
      ]);
      const { reviewThreads, ...header } = GhReviewThreadsPageSchema.parse(JSON.parse(stdout)).data.repository.pullRequest;
      first ??= { ...header, reviewThreads };
      nodes.push(...reviewThreads.nodes);
      if (!reviewThreads.pageInfo.hasNextPage || reviewThreads.pageInfo.endCursor === null) break;
      cursor = reviewThreads.pageInfo.endCursor;
    }
    const trusted = new Set(options.trustedAuthors);
    return {
      pullRequest: {
        number: first.number,
        url: first.url,
        title: first.title,
        body: first.body,
        headRefName: first.headRefName,
        headRefOid: first.headRefOid,
        baseRefName: first.baseRefName,
        authorLogin: first.author?.login ?? "ghost"
      },
      threads: nodes.map((node) => this.toReviewThread(node, trusted))
    };
  }
  async replyToReviewThread(threadId, body) {
    const { stdout } = await this.withBodyFile(
      body,
      (bodyFile) => this.execFile("gh", [
        "api",
        "graphql",
        "-f",
        `query=${replyToReviewThreadMutation}`,
        "-f",
        `id=${threadId}`,
        "-F",
        `body=@${bodyFile}`
      ])
    );
    return GhReplyToReviewThreadSchema.parse(JSON.parse(stdout)).data.addPullRequestReviewThreadReply.comment;
  }
  toReviewThread(node, trusted) {
    const comments = node.comments.nodes.map((comment) => ({
      id: comment.id,
      url: comment.url,
      authorLogin: (comment.author?.login ?? "ghost").replace(/\[bot\]$/, ""),
      authorType: comment.author?.type === "Bot" ? "Bot" : "User",
      body: comment.body,
      createdAt: comment.createdAt
    }));
    const root = comments[0];
    let finding = null;
    let markerError = null;
    if (root !== void 0 && trusted.has(root.authorType === "Bot" ? `${root.authorLogin}[bot]` : root.authorLogin)) {
      try {
        finding = this.codec.parseFinding(root.body);
      } catch (err) {
        markerError = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      id: node.id,
      path: node.path,
      line: node.line,
      originalLine: node.originalLine,
      isResolved: node.isResolved,
      isOutdated: node.isOutdated,
      commentsTruncated: node.comments.totalCount > node.comments.nodes.length,
      comments,
      finding,
      markerError
    };
  }
  describeFailure(err) {
    const stderr = this.readStringProperty(err, "stderr")?.trim();
    const text = stderr !== void 0 && stderr.length > 0 ? stderr : err instanceof Error ? err.message : String(err);
    return text.split("\n")[0]?.trim() ?? text;
  }
  escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  async runCreate(template, title, bodyFile, attach) {
    const args = [
      "pr",
      "create",
      "--repo",
      this.repo,
      "--base",
      template.baseBranch,
      "--head",
      template.headBranch,
      "--title",
      title,
      "--body-file",
      bodyFile,
      ...template.labels.flatMap((label) => ["--label", label]),
      ...attach.flatMap((spec) => ["--attach", spec])
    ];
    try {
      const { stdout } = await this.execFile("gh", args);
      return this.parseCreated(stdout);
    } catch (err) {
      const partialStdout = this.readStringProperty(err, "stdout");
      if (partialStdout !== void 0 && pullUrl.test(partialStdout)) {
        const partialStderr = this.readStringProperty(err, "stderr");
        if (partialStderr !== void 0 && partialStderr.length > 0) {
          process.stderr.write(partialStderr);
        }
        return this.parseCreated(partialStdout);
      }
      throw err;
    }
  }
  parseCreated(stdout) {
    const url = stdout.trim();
    const match = pullUrl.exec(url);
    if (match?.[1] === void 0) throw new GhOutputParseError(url);
    return { number: Number(match[1]), url };
  }
  async withBodyFile(body, run2) {
    const dir = await mkdtemp(join2(tmpdir(), "flight-rules-"));
    const bodyFile = join2(dir, "body.md");
    try {
      await writeFile(bodyFile, body, "utf8");
      return await run2(bodyFile);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  readStringProperty(err, key) {
    if (typeof err !== "object" || err === null) return void 0;
    if (key === "stdout" && "stdout" in err) return typeof err.stdout === "string" ? err.stdout : void 0;
    if (key === "stderr" && "stderr" in err) return typeof err.stderr === "string" ? err.stderr : void 0;
    return void 0;
  }
};

// src/shared/config-store.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync6, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname6 } from "node:path";

// src/shared/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join3, resolve as resolve2 } from "node:path";
import { z as z10 } from "zod";

// src/tasks/jira-task-tracker/jira-host.ts
import { z as z9 } from "zod";
var JiraHostSchema = z9.string().transform((host) => host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, ""));

// src/shared/config.ts
var seedCompetencies = [
  "define-a-schema",
  "wire-an-endpoint",
  "write-a-migration",
  "pure-transform",
  "write-a-query",
  "mapper-adapter",
  "harden-edge-cases",
  "business-rule",
  "external-api-client",
  "reducer-state",
  "async-coordination",
  "auth-check"
];
var usageHandoffThresholdSchema = z10.coerce.number().min(1).max(100).describe("Percent of a session or weekly usage window at which the usage-handoff hook hands the work to the other harness; defaults to 95");
var usageHandoffMinResetMinutesSchema = z10.coerce.number().min(0).describe("Minutes left in a usage window below which the usage-handoff hook skips the handoff and just waits for the reset; defaults to 10");
var ConfigSchema = z10.object({
  tracker: z10.enum(["github", "jira"]),
  repo: z10.string().optional().describe("GitHub owner/repo; required when tracker is github"),
  jiraHost: JiraHostSchema.optional().describe(
    "Atlassian Cloud host, e.g. acme.atlassian.net"
  ),
  jiraEmail: z10.string().optional().describe("Atlassian account email for Basic auth"),
  jiraProject: z10.string().optional().describe("Jira project key holding epics and tickets"),
  jpdProject: z10.string().optional().describe("Jira Product Discovery project key holding initiatives"),
  confluenceSpaceKey: z10.string().optional().describe("Confluence space key holding technical design docs"),
  inProgressStatus: z10.string().optional().describe(
    "Tracker status meaning work has started; discovered and stored on first run"
  ),
  inReviewStatus: z10.string().optional().describe(
    "Tracker status meaning a PR is open; discovered and stored on first run"
  ),
  defaultLabels: z10.array(z10.string()).default([]),
  rfcStorage: z10.enum(["local", "global"]).default("local"),
  rfcStoragePath: z10.string().optional(),
  qaRecipe: z10.string().optional().describe(
    "Deprecated: path to a legacy QA recipe, read only when no QA.md or AGENTS.md QA section exists; relative paths resolve against the directory holding this config file; defaults to flight-rules.qa.md beside it"
  ),
  competencies: z10.array(z10.string()).default([...seedCompetencies]),
  usageHandoffThreshold: usageHandoffThresholdSchema.optional(),
  usageHandoffMinResetMinutes: usageHandoffMinResetMinutesSchema.optional()
}).superRefine((cfg, ctx) => {
  if (cfg.tracker === "github" && cfg.repo === void 0) {
    ctx.addIssue({
      code: "custom",
      path: ["repo"],
      message: "repo is required when tracker is github"
    });
  }
  if (cfg.tracker === "jira") {
    ["jiraHost", "jiraEmail", "jiraProject"].forEach((field) => {
      if (cfg[field] === void 0) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required when tracker is jira`
        });
      }
    });
  }
});
function parseFrontmatter(contents) {
  const match = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  if (!yaml) return {};
  const data = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === void 0 || !line.trim()) {
      i++;
      continue;
    }
    if (line.match(/^\s+-\s/)) {
      i++;
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    if (!key) {
      i++;
      continue;
    }
    const rawValue = line.slice(colonIdx + 1).trim();
    const blockItems = [];
    let j = i + 1;
    while (j < lines.length) {
      const nextLine = lines[j];
      if (nextLine === void 0) break;
      const blockMatch = nextLine.match(/^\s+-\s+(.*)$/);
      if (blockMatch) {
        const item = blockMatch[1];
        blockItems.push(
          item !== void 0 ? item.trim().replace(/^["']|["']$/g, "") : ""
        );
        j++;
      } else {
        break;
      }
    }
    if (blockItems.length > 0) {
      data[key] = blockItems;
      i = j;
      continue;
    }
    if (rawValue === "true") data[key] = true;
    else if (rawValue === "false") data[key] = false;
    else if (rawValue === "null") data[key] = null;
    else if (rawValue !== "" && !isNaN(Number(rawValue)))
      data[key] = Number(rawValue);
    else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      data[key] = rawValue.slice(1, -1).split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    } else {
      data[key] = rawValue.replace(/^["']|["']$/g, "");
    }
    i++;
  }
  return data;
}
function readConfig(configPath) {
  const contents = readFileSync2(configPath, "utf-8");
  const data = parseFrontmatter(contents);
  return ConfigSchema.parse(data);
}
function getRfcDir(config, cwd) {
  if (config.rfcStorage === "global") {
    if (config.rfcStoragePath === void 0) {
      throw new Error("rfcStoragePath is required when rfcStorage is global");
    }
    return config.rfcStoragePath;
  }
  return join3(cwd, "rfcs");
}
var NodePathProbe = class {
  isFile(path) {
    return existsSync2(path) && statSync2(path, { throwIfNoEntry: false })?.isFile() === true;
  }
  isDirectory(path) {
    return existsSync2(path) && statSync2(path, { throwIfNoEntry: false })?.isDirectory() === true;
  }
};
var nodePathProbe = new NodePathProbe();
function resolveConfigPath(cwd, override, probe = nodePathProbe, host = "claude") {
  if (override !== void 0) {
    return isAbsolute(override) ? override : resolve2(cwd, override);
  }
  const claudePath = resolve2(cwd, ".claude", "flight-rules.local.md");
  const agentsPath = resolve2(cwd, ".agents", "flight-rules.local.md");
  const candidates = [claudePath, agentsPath];
  const existing = candidates.find((path) => probe.isFile(path));
  if (existing !== void 0) return existing;
  if (host === "codex") return agentsPath;
  return candidates.find((path) => probe.isDirectory(dirname2(path))) ?? claudePath;
}
function getQaRecipePath(config, configPath) {
  const recipe = config.qaRecipe ?? "flight-rules.qa.md";
  if (isAbsolute(recipe)) return recipe;
  return resolve2(dirname2(configPath), recipe);
}

// src/shared/host-settings/claude-settings-source.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname3, join as join4 } from "node:path";
import { z as z11 } from "zod";
var pluginId = "flight-rules@flight-rules";
var pluginKeyPattern = /^flight-rules(@.+)?$/;
var SettingsSchema = z11.looseObject({
  pluginConfigs: z11.record(z11.string(), z11.looseObject({ options: z11.record(z11.string(), z11.unknown()).optional() })).optional()
});
var ClaudeSettingsSource = class {
  host = "claude";
  cwd;
  env;
  home;
  untrackedCwd;
  constructor(props) {
    this.cwd = props.cwd;
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
    this.untrackedCwd = props.untrackedCwd;
  }
  pathFor(scope) {
    switch (scope) {
      case "user":
        return join4(this.env["CLAUDE_CONFIG_DIR"] ?? join4(this.home, ".claude"), "settings.json");
      case "project":
        return join4(this.cwd, ".claude", "settings.json");
      case "local":
        return this.localPath();
    }
  }
  read(scope) {
    const path = this.pathFor(scope);
    if (!existsSync3(path)) return void 0;
    const settings = this.parse(path, readFileSync3(path, "utf-8"));
    const key = this.pluginKey(settings);
    return key === void 0 ? void 0 : settings.pluginConfigs?.[key]?.options;
  }
  write(scope, update) {
    const path = this.pathFor(scope);
    const settings = existsSync3(path) ? this.parse(path, readFileSync3(path, "utf-8")) : {};
    const key = this.pluginKey(settings) ?? pluginId;
    const pluginConfigs = { ...settings.pluginConfigs };
    const entry = pluginConfigs[key] ?? {};
    pluginConfigs[key] = { ...entry, options: update(entry.options ?? {}) };
    mkdirSync(dirname3(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...settings, pluginConfigs }, null, 2)}
`);
  }
  hint() {
    return `set pluginConfigs["${pluginId}"].options in ${this.pathFor("user")}, ${this.pathFor("project")}, or ${this.pathFor("local")}`;
  }
  /** settings.local.json is untracked, so a linked worktree starts without one. */
  localPath() {
    const here = join4(this.cwd, ".claude", "settings.local.json");
    if (this.untrackedCwd === void 0 || existsSync3(here)) return here;
    return join4(this.untrackedCwd, ".claude", "settings.local.json");
  }
  parse(path, contents) {
    let json;
    try {
      json = JSON.parse(contents);
    } catch (err) {
      throw new Error(`${path} is not valid JSON`, { cause: err });
    }
    return SettingsSchema.parse(json);
  }
  pluginKey(settings) {
    const keys = Object.keys(settings.pluginConfigs ?? {}).filter((k) => pluginKeyPattern.test(k));
    return keys.includes(pluginId) ? pluginId : keys.sort()[0];
  }
};

// src/shared/host-settings/neutral-settings-source.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname4, join as join5 } from "node:path";
import { z as z12 } from "zod";
var PropsSchema = z12.object({
  cwd: z12.string().min(1),
  home: z12.string().min(1).default(homedir2),
  untrackedCwd: z12.string().min(1).optional()
});
var SettingsSchema2 = z12.record(z12.string(), z12.unknown());
var InvalidSettingsError = class extends Error {
  name = "InvalidSettingsError";
};
var NeutralSettingsSource = class {
  host = "codex";
  props;
  constructor(props) {
    this.props = PropsSchema.parse(props);
  }
  pathFor(scope) {
    if (scope === "user") return join5(this.props.home, ".agents", "flight-rules.settings.json");
    if (scope === "project") return join5(this.props.cwd, ".agents", "flight-rules.settings.json");
    const path = join5(this.props.cwd, ".agents", "flight-rules.settings.local.json");
    return this.props.untrackedCwd === void 0 || existsSync4(path) ? path : join5(this.props.untrackedCwd, ".agents", "flight-rules.settings.local.json");
  }
  read(scope) {
    const path = this.pathFor(scope);
    if (!existsSync4(path)) return void 0;
    try {
      return SettingsSchema2.parse(JSON.parse(readFileSync4(path, "utf8")));
    } catch (cause) {
      throw new InvalidSettingsError(`Invalid flight-rules settings object at ${path}`, { cause });
    }
  }
  write(scope, update) {
    const values = SettingsSchema2.parse(update(this.read(scope) ?? {}));
    const path = this.pathFor(scope);
    mkdirSync2(dirname4(path), { recursive: true });
    writeFileSync2(path, `${JSON.stringify(values, null, 2)}
`);
  }
  hint() {
    return `use FLIGHT_RULES_HOST=codex flight-rules config set with --scope user, project or local; inspect paths with config show`;
  }
};

// src/plugins/native-installation/native-installation.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync5, lstatSync, mkdirSync as mkdirSync3, readFileSync as readFileSync5, realpathSync as realpathSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname5, join as join6, resolve as resolve3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { z as z14 } from "zod";

// src/agents/agent-frontmatter/agent-frontmatter.schema.ts
import { z as z13 } from "zod";
var agentCapabilities = ["read", "edit", "shell", "web", "spawn", "ask"];
var modelTiers = ["standard", "escalated", "expert"];
var reasoningLevels = ["low", "medium", "high"];
var claudeAgentColors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
var AgentCapabilitySchema = z13.enum(agentCapabilities);
var ModelTierSchema = z13.enum(modelTiers);
var AgentFrontmatterSchema = z13.strictObject({
  name: z13.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z13.string().min(1),
  capabilities: z13.array(AgentCapabilitySchema).min(1).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    { message: "duplicate capability" }
  ),
  model: ModelTierSchema,
  modelReason: z13.string().trim().min(1).optional(),
  reasoning: z13.enum(reasoningLevels).optional(),
  sandbox: z13.strictObject({
    fs: z13.enum(["read-only", "workspace-write"]),
    network: z13.enum(["none", "enabled"])
  }).optional(),
  dispatch: z13.strictObject({
    maxConcurrent: z13.int().positive(),
    maxDepth: z13.int().positive()
  }).optional(),
  "x-claude": z13.strictObject({ color: z13.enum(claudeAgentColors).optional() }).optional()
});
var AgentRegistrationSchema = AgentFrontmatterSchema.refine(
  (agent) => agent.model !== "expert" || agent.modelReason !== void 0,
  { message: "expert tier requires modelReason", path: ["modelReason"] }
);

// src/plugins/native-installation/native-installation.ts
var NativeHostSchema = z14.enum(["claude", "codex"]);
var AgentInstallScopeSchema = z14.enum(["project", "user"]);
var InstallationManifestSchema = z14.strictObject({
  host: NativeHostSchema,
  agents: z14.array(z14.strictObject({
    name: z14.string().regex(/^[a-z][a-z0-9-]*$/),
    sha256: z14.string().regex(/^[a-f0-9]{64}$/),
    registration: AgentRegistrationSchema
  })).min(1)
}).refine((value) => new Set(value.agents.map((agent) => agent.name)).size === value.agents.length, "Duplicate agent names").refine((value) => value.agents.every((agent) => agent.name === agent.registration.name), "Registration name mismatch");
var PropsSchema2 = z14.object({
  root: z14.string().min(1),
  cwd: z14.string().min(1),
  home: z14.string().min(1).default(homedir3),
  env: z14.record(z14.string(), z14.string().optional()).default({})
});
var NativeInstallationError = class extends Error {
  name = "NativeInstallationError";
};
var FileNativeInstallation = class _FileNativeInstallation {
  props;
  constructor(props) {
    this.props = PropsSchema2.parse({ ...props, env: props.env === void 0 ? void 0 : { ...props.env } });
  }
  host() {
    const path = join6(this.props.root, "flight-rules-install.json");
    return existsSync5(path) ? this.manifest(this.props.root).host : void 0;
  }
  status(scope) {
    const selected = AgentInstallScopeSchema.parse(scope);
    const root = this.codexRoot();
    const manifest = this.manifest(root);
    const directory = selected === "project" ? resolve3(this.props.cwd, ".codex", "agents") : resolve3(this.props.env["CODEX_HOME"] || join6(this.props.home, ".codex"), "agents");
    this.assertRegularPath(directory);
    const agents = manifest.agents.map((agent) => {
      const source = join6(root, ".codex", "agents", `${agent.name}.toml`);
      this.assertRegularPath(source);
      if (!existsSync5(source) || !lstatSync(source).isFile() || this.hash(readFileSync5(source)) !== agent.sha256) {
        throw new NativeInstallationError(`Bundled registration is missing or changed: ${source}. Rebuild or reinstall the Codex plugin.`);
      }
      const path = join6(directory, `${agent.name}.toml`);
      this.assertRegularPath(path);
      const status = !existsSync5(path) ? "missing" : lstatSync(path).isFile() && this.hash(readFileSync5(path)) === agent.sha256 ? "present" : "conflict";
      return { name: agent.name, path, status };
    });
    return {
      host: "codex",
      scope: selected,
      directory,
      agents,
      ok: agents.every((agent) => agent.status === "present"),
      evidence: "files-only",
      remedy: "Install missing registrations with agents install. For conflicts, compare and back up the existing file before explicitly removing it and reinstalling. Start a new trusted Codex session and confirm native discovery; file presence does not prove dispatch access."
    };
  }
  install(scope) {
    const report = this.status(scope);
    const conflicts = report.agents.filter((agent) => agent.status === "conflict");
    if (conflicts.length > 0) {
      throw new NativeInstallationError(`Existing agent definitions differ: ${conflicts.map((agent) => agent.path).join(", ")}. ${report.remedy}`);
    }
    const root = this.codexRoot();
    for (const agent of report.agents.filter((agent2) => agent2.status === "missing")) {
      this.assertRegularPath(report.directory);
      mkdirSync3(report.directory, { recursive: true });
      writeFileSync3(agent.path, readFileSync5(join6(root, ".codex", "agents", `${agent.name}.toml`)), { flag: "wx" });
    }
    return this.status(scope);
  }
  codexRoot() {
    const root = resolve3(this.props.root);
    if (this.host() === "codex") return root;
    const target = join6(root, "dist", "codex");
    if (existsSync5(join6(target, "flight-rules-install.json")) && this.manifest(target).host === "codex") return target;
    throw new NativeInstallationError("Codex registrations are unavailable in this installation. Run agents install from the Codex plugin or the complete npm package. Claude discovers agents through its native plugin installation.");
  }
  manifest(root) {
    try {
      return InstallationManifestSchema.parse(JSON.parse(readFileSync5(join6(root, "flight-rules-install.json"), "utf8")));
    } catch (cause) {
      throw new NativeInstallationError(`Invalid installation manifest at ${root}; rebuild or reinstall flight-rules`, { cause });
    }
  }
  hash(contents) {
    return createHash2("sha256").update(contents).digest("hex");
  }
  assertRegularPath(path) {
    let current = resolve3(path);
    const anchors = [this.props.cwd, this.props.home, this.props.env["CODEX_HOME"], this.props.root].filter((anchor) => anchor !== void 0).map((anchor) => resolve3(anchor));
    while (!anchors.includes(current) && dirname5(current) !== current) {
      try {
        if (lstatSync(current).isSymbolicLink()) throw new NativeInstallationError(`Refusing symlinked installation path: ${current}`);
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
      }
      current = dirname5(current);
    }
    if (existsSync5(current)) realpathSync2(current);
  }
  static fromInstall(props) {
    return new _FileNativeInstallation({
      root: props.env["FLIGHT_RULES_HOME"]?.trim() || join6(dirname5(fileURLToPath2(props.moduleUrl)), ".."),
      cwd: props.cwd,
      env: props.env
    });
  }
};

// src/shared/config-store.ts
var configScopes = ["user", "project", "local", "file"];
var ConfigStore = class {
  cwd;
  env;
  hostSettings;
  pathProbe;
  untrackedRoot;
  constructor(props) {
    this.cwd = props.cwd;
    this.env = props.env ?? process.env;
    this.pathProbe = props.pathProbe;
    this.untrackedRoot = props.untrackedRoot;
    const host = NativeHostSchema.parse(props.host ?? this.env["FLIGHT_RULES_HOST"] ?? "claude");
    const settingsProps = {
      cwd: props.cwd,
      env: this.env,
      ...props.home !== void 0 ? { home: props.home } : {},
      ...props.untrackedRoot !== void 0 ? { untrackedCwd: props.untrackedRoot } : {}
    };
    this.hostSettings = props.hostSettings ?? (host === "codex" ? new NeutralSettingsSource(settingsProps) : new ClaudeSettingsSource(settingsProps));
  }
  /** The flight-rules config file path, as `flight-rules config path` reports it. */
  filePath() {
    const override = this.env["FLIGHT_RULES_CONFIG"];
    const host = this.hostSettings.host === "codex" ? "codex" : "claude";
    const here = resolveConfigPath(this.cwd, override, this.pathProbe, host);
    if (override !== void 0 || this.untrackedRoot === void 0) return here;
    const isFile = this.pathProbe?.isFile.bind(this.pathProbe) ?? existsSync6;
    return isFile(here) ? here : resolveConfigPath(this.untrackedRoot, void 0, this.pathProbe, host);
  }
  pathFor(scope) {
    return scope === "file" ? this.filePath() : this.hostSettings.pathFor(scope);
  }
  layers() {
    return configScopes.map((scope) => this.readLayer(scope));
  }
  load() {
    return this.report().config;
  }
  report() {
    const { values, sources, layers } = this.merge();
    if (Object.keys(values).length === 0) {
      throw new Error(
        `No flight-rules config found. Run the flight-rules setup skill, write ${this.filePath()}, or ${this.hostSettings.hint()}`
      );
    }
    return { config: ConfigSchema.parse(values), sources, layers };
  }
  inspect() {
    const merged = this.merge();
    const result = ConfigSchema.safeParse(merged.values);
    if (result.success) return { host: this.hostSettings.host, valid: true, ...merged, values: result.data };
    const error = Object.keys(merged.values).length === 0 ? "no flight-rules config found" : result.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
    return { host: this.hostSettings.host, valid: false, error, ...merged };
  }
  /**
   * The scope a write lands in when the caller names none: wherever the key
   * is set now, else the config file when one exists, else `local`.
   */
  defaultScopeFor(key) {
    const layers = this.layers();
    const owner = [...layers].reverse().find((layer) => key in layer.values);
    if (owner !== void 0) return owner.scope;
    return this.layer(layers, "file").present ? "file" : "local";
  }
  set(key, rawValues, scope) {
    const value = this.coerce(key, rawValues);
    this.write(scope, (values) => ({ ...values, [key]: value }));
    return scope;
  }
  unset(key, scope) {
    this.assertKnownKey(key);
    this.write(scope, (values) => {
      const next = { ...values };
      delete next[key];
      return next;
    });
  }
  /**
   * The highest-precedence scope that sets `key`, when it outranks `scope`.
   * A write to `scope` would then not take effect.
   */
  shadowingScope(key, scope) {
    const rank = configScopes.indexOf(scope);
    return [...this.layers()].reverse().find((layer) => configScopes.indexOf(layer.scope) > rank && key in layer.values)?.scope;
  }
  merge() {
    const layers = this.layers();
    if (this.env["FLIGHT_RULES_CONFIG"] !== void 0 && !this.layer(layers, "file").present) {
      throw new Error(`FLIGHT_RULES_CONFIG points at ${this.filePath()}, which does not exist`);
    }
    const values = {};
    const sources = {};
    for (const layer of layers) {
      for (const [key, value] of Object.entries(layer.values)) {
        values[key] = value;
        sources[key] = { scope: layer.scope, path: layer.path };
      }
    }
    return {
      values,
      sources,
      layers: layers.map(({ scope, path, present }) => ({ scope, path, present }))
    };
  }
  layer(layers, scope) {
    const found = layers.find((l) => l.scope === scope);
    if (found === void 0) throw new Error(`unknown config scope ${scope}`);
    return found;
  }
  readLayer(scope) {
    const path = this.pathFor(scope);
    if (scope === "file") {
      if (!existsSync6(path)) return { scope, path, present: false, values: {} };
      return { scope, path, present: true, values: parseFrontmatter(readFileSync6(path, "utf-8")) };
    }
    const values = this.hostSettings.read(scope);
    return { scope, path, present: values !== void 0, values: values ?? {} };
  }
  write(scope, update) {
    if (scope !== "file") {
      this.hostSettings.write(scope, update);
      return;
    }
    const path = this.filePath();
    const contents = existsSync6(path) ? readFileSync6(path, "utf-8") : void 0;
    mkdirSync4(dirname6(path), { recursive: true });
    const values = update(contents === void 0 ? {} : parseFrontmatter(contents));
    const body = contents?.replace(/^---\n[\s\S]*?\n---\n?/, "") ?? "";
    writeFileSync4(path, `${this.toFrontmatter(values)}${body}`);
  }
  toFrontmatter(values) {
    const lines = Object.entries(values).flatMap(
      ([key, value]) => Array.isArray(value) ? [`${key}:`, ...value.map((item) => `  - ${String(item)}`)] : [`${key}: ${String(value)}`]
    );
    return `---
${lines.join("\n")}
---
`;
  }
  assertKnownKey(key) {
    if (!(key in ConfigSchema.shape)) {
      throw new Error(
        `Unknown config key "${key}" \u2014 expected one of: ${Object.keys(ConfigSchema.shape).join(", ")}`
      );
    }
  }
  coerce(key, rawValues) {
    this.assertKnownKey(key);
    const field = Object.entries(ConfigSchema.shape).find(([name]) => name === key)?.[1];
    if (field === void 0) return void 0;
    const isArray = field.safeParse([]).success && !field.safeParse("").success;
    const joined = rawValues.join(" ");
    const value = isArray ? [...rawValues] : joined;
    const result = field.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid value for ${key}: ${result.error.issues.map((i) => i.message).join("; ")}`);
    }
    return value;
  }
};

// src/git/worktree-locator/worktree-locator.ts
import { execFileSync } from "node:child_process";
import { basename, dirname as dirname7 } from "node:path";
var WorktreeLocator = class {
  execFileSync;
  constructor(props = {}) {
    this.execFileSync = props.execFileSyncFn ?? ((file, args, cwd) => execFileSync(file, [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  }
  /** The main checkout's root when `cwd` is inside a linked worktree; otherwise undefined. */
  mainCheckoutFor(cwd) {
    let output;
    try {
      output = this.execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], cwd);
    } catch {
      return void 0;
    }
    const [gitDir, commonDir] = output.trim().split("\n");
    if (gitDir === void 0 || commonDir === void 0 || gitDir === commonDir) return void 0;
    if (basename(commonDir) !== ".git") return void 0;
    return dirname7(commonDir);
  }
};

// src/tasks/evidence/evidence-location.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { dirname as dirname8, join as join7 } from "node:path";
var EvidenceLocation = class {
  root;
  execFileSync;
  constructor(props) {
    this.root = props.mainCheckout ?? props.cwd;
    this.execFileSync = props.execFileSyncFn ?? ((file, args, cwd) => execFileSync2(file, [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  }
  dirFor(ticket) {
    if (ticket.trim() === "" || /[/\\]|\.\./.test(ticket)) {
      throw new Error(`invalid ticket id "${ticket}" for an evidence directory`);
    }
    const path = join7(dirname8(resolveConfigPath(this.root, void 0)), "evidence", ticket);
    return { path, gitignored: this.isIgnored(path) };
  }
  isIgnored(path) {
    try {
      this.execFileSync("git", ["check-ignore", "-q", "--no-index", path], this.root);
      return true;
    } catch (err) {
      return typeof err === "object" && err !== null && "status" in err && err.status === 1 ? false : null;
    }
  }
};

// src/shared/env.ts
import { z as z15 } from "zod";
var EnvSchema = z15.object({
  githubToken: z15.string().optional(),
  jiraToken: z15.string().optional(),
  jiraEmail: z15.string().optional(),
  jiraHost: JiraHostSchema.optional()
});
var EnvLoader = class {
  overrides;
  cachedEnv = null;
  constructor(overrides = {}) {
    this.overrides = overrides;
  }
  load(source = process.env, forceRefresh = false) {
    if (!forceRefresh && this.cachedEnv) return this.cachedEnv;
    this.cachedEnv = EnvSchema.parse({
      githubToken: source["GITHUB_TOKEN"],
      jiraToken: source["JIRA_TOKEN"] ?? source["JIRA_API_TOKEN"] ?? source["JIRA_API_KEY"],
      jiraEmail: source["JIRA_EMAIL"],
      jiraHost: source["JIRA_HOST"]
    });
    this.cachedEnv = {
      ...this.cachedEnv,
      ...this.overrides
    };
    return this.cachedEnv;
  }
};

// src/tasks/github-task-tracker/github-task-tracker.ts
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

// src/tasks/body-metadata/body-metadata.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// src/tasks/task-tracker/task-tracker.ts
import { z as z16 } from "zod";
var TrackerUserSchema = z16.object({
  accountId: z16.string(),
  displayName: z16.string()
});
var EntityMetadataSchema = z16.object({
  tddId: z16.number().optional(),
  epicId: z16.number().optional(),
  notes: z16.string().optional(),
  /** Explicit body-format override read first by BodyFormatDetector (docs/bug-report-format.md). */
  kind: z16.enum(["bug", "story"]).optional(),
  /** Why a blocked-by edge leaves this ticket's epic, keyed by blocker id (docs/epic-boundaries.md). */
  crossEpicReasons: z16.record(z16.string(), z16.string()).optional()
}).passthrough();
var CommentSchema = z16.object({
  id: z16.string(),
  body: z16.string(),
  author: z16.string(),
  createdAt: z16.string(),
  updatedAt: z16.string()
});
var AttachmentSchema = z16.object({
  id: z16.string(),
  filename: z16.string(),
  mimeType: z16.string(),
  size: z16.number().optional(),
  mediaUuid: z16.string().optional()
});
var TechnicalDesignSchema = z16.object({
  id: z16.string(),
  epicId: z16.string(),
  url: z16.string().optional(),
  body: z16.string(),
  comments: z16.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z16.string()
});
var TicketSchema = z16.object({
  id: z16.string(),
  size: z16.literal("ticket"),
  status: z16.string(),
  labels: z16.array(z16.string()),
  title: z16.string(),
  body: z16.string(),
  comments: z16.array(CommentSchema),
  assignee: z16.string().nullable(),
  attachments: z16.array(AttachmentSchema).default([]),
  reporter: z16.string().nullable().default(null),
  issueType: z16.string().default("unknown"),
  blockedBy: z16.array(z16.string()).default([]),
  blocking: z16.array(z16.string()).default([]),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z16.string()
});
var EpicSchema = z16.object({
  id: z16.string(),
  size: z16.literal("epic"),
  status: z16.string(),
  labels: z16.array(z16.string()),
  title: z16.string(),
  body: z16.string(),
  childIssues: z16.array(TicketSchema),
  comments: z16.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z16.string()
});
var CreateEpicInputSchema = z16.object({
  title: z16.string(),
  body: z16.string(),
  labels: z16.array(z16.string()).default([]),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTicketInputSchema = z16.object({
  title: z16.string(),
  body: z16.string(),
  /** Absent for a standalone ticket: a ticket-sized RFC has no epic to parent to. */
  epicId: z16.string().optional(),
  labels: z16.array(z16.string()).default([]),
  assignee: z16.string().optional(),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTechnicalDesignInputSchema = z16.object({
  title: z16.string(),
  body: z16.string(),
  epicId: z16.string(),
  metadata: EntityMetadataSchema.partial().optional()
});
var UpdateEpicInputSchema = z16.object({
  body: z16.string(),
  title: z16.string().optional(),
  labels: z16.array(z16.string()).optional()
});
var UpdateTicketInputSchema = z16.object({
  body: z16.string(),
  title: z16.string().optional(),
  labels: z16.array(z16.string()).optional()
});
var UpdateInitiativeInputSchema = z16.object({
  body: z16.string(),
  title: z16.string().optional()
});
var InitiativeSchema = z16.object({
  id: z16.string(),
  size: z16.literal("initiative"),
  title: z16.string(),
  body: z16.string(),
  epics: z16.array(z16.object({ id: z16.string(), title: z16.string() })).default([])
});
var CreateInitiativeInputSchema = z16.object({
  title: z16.string(),
  body: z16.string()
});
var partialWriteErrorSchema = z16.object({
  name: z16.literal("TaskTrackerPartialWriteError"),
  id: z16.string().min(1),
  message: z16.string()
});
var TaskTrackerPartialWriteError = class extends Error {
  name = "TaskTrackerPartialWriteError";
  id;
  constructor(props) {
    super(props.cause instanceof Error ? props.cause.message : String(props.cause), {
      cause: props.cause
    });
    this.id = props.id;
  }
  /** Recognizes adapter failures across independently bundled package entry points. */
  static isPartialWrite(error) {
    return error instanceof Error && partialWriteErrorSchema.safeParse(error).success;
  }
};

// src/tasks/body-metadata/body-metadata.ts
var sentinelComment = "<!-- flight-rules:metadata -->";
var detailsBlockRe = /<details>\n<summary>LLM Context<\/summary>\n<!-- flight-rules:metadata -->\n\n```yaml\n([\s\S]*?)\n```\n\n<\/details>/;
var BodyMetadataService = class {
  parse(body) {
    const match = detailsBlockRe.exec(body);
    if (match === null || match[1] === void 0) return {};
    const content = match[1].trim();
    if (content === "") return {};
    const raw = parseYaml(content);
    if (raw === null || raw === void 0) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("malformed flight-rules metadata block");
    }
    Reflect.deleteProperty(raw, "size");
    return EntityMetadataSchema.parse(raw);
  }
  splice(body, patch) {
    const existing = this.parse(body);
    const hasBlock = detailsBlockRe.test(body);
    const merged = { ...existing };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== void 0) merged[k] = v;
    }
    if (Object.keys(merged).length === 0 && !hasBlock) return body;
    const yaml = stringifyYaml(merged).trimEnd();
    const block = [
      "<details>",
      "<summary>LLM Context</summary>",
      sentinelComment,
      "",
      "```yaml",
      yaml,
      "```",
      "",
      "</details>"
    ].join("\n");
    if (hasBlock) return body.replace(detailsBlockRe, block);
    return `${body}

${block}`;
  }
};

// src/tasks/github-task-tracker/github-task-tracker.ts
import { z as z18 } from "zod";

// src/tasks/task-tracker/unsupported-tracker-operation-error.ts
import { z as z17 } from "zod";
var UnsupportedTrackerOperationPropsSchema = z17.object({
  tracker: z17.string().min(1),
  operation: z17.string().min(1),
  remedy: z17.string().min(1).optional()
});
var UnsupportedTrackerOperationError = class extends Error {
  tracker;
  operation;
  constructor(props) {
    const parsed = UnsupportedTrackerOperationPropsSchema.parse(props);
    super(
      `The ${parsed.tracker} tracker does not support ${parsed.operation}` + (parsed.remedy !== void 0 ? ` \u2014 ${parsed.remedy}` : "")
    );
    this.name = "UnsupportedTrackerOperationError";
    this.tracker = parsed.tracker;
    this.operation = parsed.operation;
  }
};

// src/tasks/github-task-tracker/github-task-tracker.ts
var IssueRefSchema = z18.object({ number: z18.number() });
var IssueRefListSchema = z18.array(IssueRefSchema);
var ParentNotFoundSchema = z18.object({ status: z18.literal(404) });
var GitHubTaskTracker = class {
  octokit;
  gql;
  owner;
  repo;
  bodyMetadata = new BodyMetadataService();
  constructor(config) {
    this.octokit = new Octokit({ auth: config.token });
    this.gql = graphql.defaults({ headers: { authorization: `token ${config.token}` } });
    this.owner = config.owner;
    this.repo = config.repo;
  }
  async createEpic(input) {
    const body = this.bodyMetadata.splice(input.body, input.metadata ?? {});
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ["epic", ...input.labels]
    });
    return {
      id: String(data.number),
      size: "epic",
      status: data.state,
      labels: data.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: data.title,
      body: data.body ?? "",
      childIssues: [],
      comments: [],
      metadata: this.bodyMetadata.parse(data.body ?? ""),
      updatedAt: data.updated_at
    };
  }
  async createInitiative(input) {
    const { data } = await this.octokit.rest.issues.createMilestone({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      description: input.body
    });
    return {
      id: String(data.number),
      size: "initiative",
      title: data.title,
      body: data.description ?? "",
      epics: []
    };
  }
  async getInitiative(id) {
    const milestoneNumber = parseInt(id, 10);
    const [milestoneResponse, epicsResponse] = await Promise.all([
      this.octokit.rest.issues.getMilestone({
        owner: this.owner,
        repo: this.repo,
        milestone_number: milestoneNumber
      }),
      this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        milestone: String(milestoneNumber),
        labels: "epic",
        state: "all"
      })
    ]);
    const milestone = milestoneResponse.data;
    return {
      id,
      size: "initiative",
      title: milestone.title,
      body: milestone.description ?? "",
      epics: epicsResponse.data.map((issue) => ({
        id: String(issue.number),
        title: issue.title
      }))
    };
  }
  async linkEpicToInitiative(epicId, initiativeId) {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(epicId, 10),
      milestone: parseInt(initiativeId, 10)
    });
  }
  async getEpic(id) {
    const issueNumber = parseInt(id, 10);
    const [issueResponse, commentsResponse, subIssuesResponse] = await Promise.all([
      this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      }),
      this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      }),
      this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      })
    ]);
    const issue = issueResponse.data;
    const body = issue.body ?? "";
    const metadata = this.bodyMetadata.parse(body);
    const childNumbers = IssueRefListSchema.parse(subIssuesResponse.data).map(
      (ref) => String(ref.number)
    );
    const childIssues = await Promise.all(childNumbers.map((n) => this.getTicket(n)));
    let tdd;
    if (metadata.tddId !== void 0) {
      tdd = await this.getTechnicalDesign(String(metadata.tddId));
    }
    return {
      id,
      size: "epic",
      status: issue.state,
      labels: issue.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: issue.title,
      body,
      childIssues,
      comments: commentsResponse.data.map((c) => this.mapComment(c)),
      tdd,
      metadata,
      updatedAt: issue.updated_at
    };
  }
  async createTicket(input) {
    const body = this.bodyMetadata.splice(input.body, input.metadata ?? {});
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ["ticket", ...input.labels],
      ...input.assignee !== void 0 ? { assignee: input.assignee } : {}
    });
    if (input.epicId !== void 0) {
      try {
        await this.linkTicketToEpic(String(data.number), input.epicId);
      } catch (cause) {
        throw new TaskTrackerPartialWriteError({ id: String(data.number), cause });
      }
    }
    return this.mapTicket(data, [], [], [], this.bodyMetadata.parse(data.body ?? ""));
  }
  async getTicket(id) {
    const issueNumber = parseInt(id, 10);
    const [issueResponse, commentsResponse, blockedByResponse, blockingResponse] = await Promise.all([
      this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      }),
      this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      }),
      this.octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
        {
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber
        }
      ),
      this.octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking",
        {
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber
        }
      )
    ]);
    const body = issueResponse.data.body ?? "";
    const metadata = this.bodyMetadata.parse(body);
    const blockedBy = IssueRefListSchema.parse(blockedByResponse.data).map(
      (ref) => String(ref.number)
    );
    const blocking = IssueRefListSchema.parse(blockingResponse.data).map(
      (ref) => String(ref.number)
    );
    return this.mapTicket(issueResponse.data, commentsResponse.data, blockedBy, blocking, metadata);
  }
  async linkTicketToEpic(ticketId, epicId) {
    const epicNumber = parseInt(epicId, 10);
    const ticketNumber = parseInt(ticketId, 10);
    const existing = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      { owner: this.owner, repo: this.repo, issue_number: epicNumber }
    );
    const childNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number);
    if (childNumbers.includes(ticketNumber)) return;
    const subIssueId = await this.resolveIssueId(ticketNumber);
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
      sub_issue_id: subIssueId
    });
  }
  async getTicketEpicId(ticketId) {
    try {
      const { data } = await this.octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/parent",
        {
          owner: this.owner,
          repo: this.repo,
          issue_number: parseInt(ticketId, 10)
        }
      );
      return String(IssueRefSchema.parse(data).number);
    } catch (error) {
      if (ParentNotFoundSchema.safeParse(error).success) return null;
      throw error;
    }
  }
  async blockTicket(ticketId, blockedById) {
    if (ticketId === blockedById) throw new Error("a ticket cannot block itself");
    const ticketNumber = parseInt(ticketId, 10);
    const blockerNumber = parseInt(blockedById, 10);
    const existing = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber }
    );
    const blockerNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number);
    if (blockerNumbers.includes(blockerNumber)) return;
    const issueId = await this.resolveIssueId(blockerNumber);
    await this.octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId }
    );
  }
  async unblockTicket(ticketId, blockedById) {
    const ticketNumber = parseInt(ticketId, 10);
    const issueId = await this.resolveIssueId(parseInt(blockedById, 10));
    await this.octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}",
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId }
    );
  }
  async transitionTicket(ticketId, status) {
    const issueNumber = parseInt(ticketId, 10);
    const slug = `status:${status.trim().toLowerCase().replace(/\s+/g, "-")}`;
    const existing = await this.statusLabelNames();
    const label = existing.find((name) => name.toLowerCase() === slug) ?? slug;
    const { data: issue } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber
    });
    const stale = issue.labels.map((l) => this.labelName(l)).filter((name) => name.startsWith("status:") && name.toLowerCase() !== label.toLowerCase());
    for (const name of stale) {
      await this.octokit.rest.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name
      });
    }
    await this.octokit.rest.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels: [label]
    });
  }
  async listTransitions() {
    return (await this.statusLabelNames()).map(
      (name) => name.slice("status:".length).replace(/-/g, " ").toLowerCase()
    );
  }
  /**
   * GitHub labels double as the tracker's type system — `epic`/`ticket` and
   * `status:<slug>` — so a generic label write could silently change a
   * ticket's size or status. Label lifecycle writes are Jira-only.
   */
  addLabel(ticketId, label) {
    return Promise.reject(
      new UnsupportedTrackerOperationError({
        tracker: "GitHub",
        operation: `adding the label "${label}" to issue #${ticketId}`,
        remedy: "GitHub labels encode issue size and status and are owned by the tracker; use --tracker jira"
      })
    );
  }
  removeLabel(ticketId, label) {
    return Promise.reject(
      new UnsupportedTrackerOperationError({
        tracker: "GitHub",
        operation: `removing the label "${label}" from issue #${ticketId}`,
        remedy: "GitHub labels encode issue size and status and are owned by the tracker; use --tracker jira"
      })
    );
  }
  async updateEpicMetadata(epicId, patch) {
    const issueNumber = parseInt(epicId, 10);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber
    });
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: this.bodyMetadata.splice(data.body ?? "", patch)
    });
  }
  async updateTicketMetadata(ticketId, patch) {
    const issueNumber = parseInt(ticketId, 10);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber
    });
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: this.bodyMetadata.splice(data.body ?? "", patch)
    });
  }
  async updateEpicDescription(epicId, input) {
    await this.replaceIssueBody(epicId, "epic", input);
    try {
      return await this.getEpic(epicId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: epicId, cause });
    }
  }
  async updateTicketDescription(ticketId, input) {
    await this.replaceIssueBody(ticketId, "ticket", input);
    try {
      return await this.getTicket(ticketId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: ticketId, cause });
    }
  }
  async updateInitiativeDescription(initiativeId, input) {
    await this.octokit.rest.issues.updateMilestone({
      owner: this.owner,
      repo: this.repo,
      milestone_number: parseInt(initiativeId, 10),
      description: input.body,
      ...input.title !== void 0 ? { title: input.title } : {}
    });
    try {
      return await this.getInitiative(initiativeId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: initiativeId, cause });
    }
  }
  async updateTddMetadata(tddId, patch) {
    const fetchData = await this.gql(
      `query GetDiscussionForUpdate($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) { id body }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(tddId, 10) }
    );
    const discussion = fetchData.repository.discussion;
    if (discussion === null) throw new Error(`Discussion #${tddId} not found`);
    await this.gql(
      `mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
        updateDiscussion(input: { discussionId: $discussionId, body: $body }) {
          discussion { number }
        }
      }`,
      {
        discussionId: discussion.id,
        body: this.bodyMetadata.splice(discussion.body, patch)
      }
    );
  }
  async createTechnicalDesign(input) {
    const repoData = await this.gql(
      `query GetRepoAndCategory($owner: String!, $repo: String!, $slug: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategory(slug: $slug) { id }
        }
      }`,
      { owner: this.owner, repo: this.repo, slug: "tdds" }
    );
    const categoryId = repoData.repository.discussionCategory?.id;
    if (categoryId === void 0) {
      throw new Error(
        `No "TDDs" discussion category found. Create it in the repo's GitHub Discussions settings.`
      );
    }
    const body = this.bodyMetadata.splice(input.body, {
      epicId: parseInt(input.epicId, 10),
      ...input.metadata
    });
    const createData = await this.gql(
      `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { number body updatedAt url }
        }
      }`,
      { repositoryId: repoData.repository.id, categoryId, title: input.title, body }
    );
    const discussion = createData.createDiscussion.discussion;
    try {
      await this.updateEpicMetadata(input.epicId, { tddId: discussion.number });
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: String(discussion.number), cause });
    }
    return {
      id: String(discussion.number),
      epicId: input.epicId,
      ...discussion.url !== void 0 ? { url: discussion.url } : {},
      body: discussion.body,
      comments: [],
      metadata: this.bodyMetadata.parse(discussion.body),
      updatedAt: discussion.updatedAt
    };
  }
  async getTechnicalDesign(id) {
    const data = await this.gql(
      `query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            number body updatedAt url
            comments(first: 100) {
              nodes { id body author { login } createdAt updatedAt }
            }
          }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(id, 10) }
    );
    const discussion = data.repository.discussion;
    if (discussion === null) {
      throw new Error(`Discussion #${id} not found`);
    }
    const metadata = this.bodyMetadata.parse(discussion.body);
    const epicId = metadata.epicId !== void 0 ? String(metadata.epicId) : "";
    return {
      id,
      epicId,
      ...discussion.url !== void 0 ? { url: discussion.url } : {},
      body: discussion.body,
      comments: discussion.comments.nodes.map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author?.login ?? "",
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
      })),
      metadata,
      updatedAt: discussion.updatedAt
    };
  }
  async addComment(entityId2, body) {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(entityId2, 10),
      body
    });
    return {
      id: String(data.id),
      body: data.body ?? "",
      author: data.user?.login ?? "",
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }
  // eslint-disable-next-line preflight/no-throw-helpers -- a capability stub's whole body is the throw
  async addAttachment(ticketId, filePath) {
    throw new UnsupportedTrackerOperationError({
      tracker: "GitHub",
      operation: `attaching ${filePath} to issue #${ticketId}`,
      remedy: "GitHub issues have no attachment API; use --tracker jira, or gh --attach for pull requests"
    });
  }
  async getUsers() {
    const { data } = await this.octokit.rest.orgs.listMembers({
      org: this.owner,
      per_page: 100
    });
    return data.map((member) => ({ accountId: member.login, displayName: member.login }));
  }
  async ping(options) {
    await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
      ...options?.signal === void 0 ? {} : { request: { signal: options.signal } }
    });
  }
  async replaceIssueBody(id, role, input) {
    const issueNumber = parseInt(id, 10);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber
    });
    const body = this.bodyMetadata.splice(input.body, this.bodyMetadata.parse(data.body ?? ""));
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
      ...input.title !== void 0 ? { title: input.title } : {},
      ...input.labels !== void 0 ? { labels: this.mergeLabels(data.labels, role, input.labels) } : {}
    });
  }
  /**
   * The label set to write on an edit: the caller's labels plus the role
   * (`epic`/`ticket`) and any `status:` label the issue already carries, so a
   * `--labels` edit replaces the free-form labels without dropping the ones the
   * factory manages.
   */
  mergeLabels(current, role, next) {
    const preserved = /* @__PURE__ */ new Set([role]);
    for (const label of current) {
      const name = this.labelName(label);
      if (name.startsWith("status:")) preserved.add(name);
    }
    for (const name of next) preserved.add(name);
    return [...preserved];
  }
  async resolveIssueId(issueNumber) {
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber
    });
    return data.id;
  }
  /**
   * Every `status:` label the repo defines, paginated so a repo with more than
   * one page of labels cannot silently omit some. The vocabulary is repo-wide,
   * which is why `listTransitions` ignores the ticket id it is handed.
   */
  async statusLabelNames() {
    const labels = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
      owner: this.owner,
      repo: this.repo,
      per_page: 100
    });
    return labels.map((label) => this.labelName(label)).filter((name) => name.startsWith("status:"));
  }
  labelName(label) {
    if (typeof label === "string") return label;
    return label.name ?? "";
  }
  mapComment(c) {
    return {
      id: String(c.id),
      body: c.body ?? "",
      author: c.user?.login ?? "",
      createdAt: c.created_at,
      updatedAt: c.updated_at
    };
  }
  mapTicket(issue, comments, blockedBy = [], blocking = [], metadata = {}) {
    const labels = issue.labels.map((l) => this.labelName(l)).filter(Boolean);
    const statusLabel = labels.find((name) => name.startsWith("status:"));
    return {
      id: String(issue.number),
      size: "ticket",
      status: statusLabel !== void 0 ? statusLabel.slice("status:".length) : issue.state,
      labels,
      title: issue.title,
      body: issue.body ?? "",
      comments: comments.map((c) => this.mapComment(c)),
      assignee: issue.assignee?.login ?? null,
      attachments: [],
      reporter: issue.user?.login ?? null,
      issueType: issue.type?.name ?? "Issue",
      blockedBy,
      blocking,
      metadata,
      updatedAt: issue.updated_at
    };
  }
};

// src/tasks/jira-task-tracker/jira-task-tracker.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { basename as basename2 } from "node:path";
import { z as z22 } from "zod";

// src/tasks/jira-task-tracker/jira-client.ts
import { z as z19 } from "zod";

// src/tasks/jira-task-tracker/jira-api-error.ts
var JiraApiError = class extends Error {
  status;
  messages;
  fieldErrors;
  // eslint-disable-next-line preflight/constructor-single-props -- multi-parameter constructor predates charter M-5; tracked in KAN-39
  constructor(status, messages, fieldErrors) {
    super(messages[0] ?? `Jira API error (status ${status})`);
    this.name = "JiraApiError";
    this.status = status;
    this.messages = messages;
    this.fieldErrors = fieldErrors;
  }
};

// src/tasks/jira-task-tracker/jira-client.ts
var maxRetries = 4;
var defaultRetryAfterSeconds = 2;
var maxBackoffMs = 3e4;
var attachmentXsrfHeader = "no-check";
var redirectStatuses = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
var JiraErrorBodySchema = z19.object({
  errorMessages: z19.array(z19.string()).optional(),
  // Caught per-field so an off-contract `errors` map cannot discard a valid sibling `errorMessages`.
  errors: z19.record(z19.string(), z19.string()).optional().catch(void 0),
  message: z19.string().optional()
});
var JiraClient = class {
  baseUrl;
  authHeader;
  constructor(config) {
    this.baseUrl = `https://${config.host}/rest/api/3`;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`;
  }
  async request(method, path, body, params, signal) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await this.fetchWithRetry(url.toString(), {
      method,
      headers: { Authorization: this.authHeader, "Content-Type": "application/json", Accept: "application/json" },
      ...body !== void 0 ? { body: JSON.stringify(body) } : {},
      ...signal === void 0 ? {} : { signal }
    });
    if (!res.ok) await this.throwApiError(res);
    const text = await res.text();
    const data = text.length > 0 ? JSON.parse(text) : void 0;
    return data;
  }
  /**
   * Uploads files as a multipart attachment. Jira's attachment endpoint demands the
   * `X-Atlassian-Token: no-check` XSRF opt-out, and `Content-Type` is left unset so undici
   * writes the multipart boundary itself — setting it by hand would drop the boundary.
   */
  async upload(path, files) {
    const form = new FormData();
    files.forEach((file) => form.append("file", file, file.name));
    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "X-Atlassian-Token": attachmentXsrfHeader
      },
      body: form
    });
    if (!res.ok) await this.throwApiError(res);
    const text = await res.text();
    const data = text.length > 0 ? JSON.parse(text) : void 0;
    return data;
  }
  /**
   * Resolves the `Location` a Jira redirect points at without following it. undici surfaces the
   * real 3xx (not an opaque redirect) under `redirect: 'manual'`, so the status and header are
   * readable; a 3xx leaves `res.ok` false, hence the explicit redirect-status allowance.
   */
  async locationFor(path) {
    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: this.authHeader },
      redirect: "manual"
    });
    if (!res.ok && !redirectStatuses.has(res.status)) await this.throwApiError(res);
    const location = res.headers.get("location");
    await res.body?.cancel();
    if (location === null) {
      throw new JiraApiError(res.status, [`Jira returned no Location header for ${path}`], {});
    }
    return location;
  }
  async fetchWithRetry(url, init, attempt = 0) {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt < maxRetries && init.signal === void 0) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const parsedRetryAfter = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : defaultRetryAfterSeconds;
      const jitter = 0.7 + Math.random() * 0.6;
      const delayMs = Math.min(retryAfterSeconds * 1e3 * jitter, maxBackoffMs);
      await new Promise((resolve12) => setTimeout(resolve12, delayMs));
      return this.fetchWithRetry(url, init, attempt + 1);
    }
    return res;
  }
  async throwApiError(res) {
    const parsed = await res.json().catch(() => void 0);
    const body = JiraErrorBodySchema.catch({}).parse(parsed);
    const messages = body.errorMessages ?? (body.message ? [body.message] : []);
    const fieldErrors = body.errors ?? {};
    throw new JiraApiError(res.status, messages, fieldErrors);
  }
};

// src/tasks/jira-task-tracker/confluence-client.ts
import { z as z20 } from "zod";
var maxRetries2 = 4;
var defaultRetryAfterSeconds2 = 2;
var maxBackoffMs2 = 3e4;
var ConfluenceErrorBodySchema = z20.object({
  errors: z20.array(z20.object({ title: z20.string().optional(), detail: z20.string().optional() })).optional().catch(void 0),
  message: z20.string().optional()
});
var ConfluenceClient = class {
  siteBaseUrl;
  baseUrl;
  authHeader;
  constructor(config) {
    this.siteBaseUrl = `https://${config.host}/wiki`;
    this.baseUrl = `${this.siteBaseUrl}/api/v2`;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`;
  }
  async request(method, path, body, params) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await this.fetchWithRetry(url.toString(), {
      method,
      headers: { Authorization: this.authHeader, "Content-Type": "application/json", Accept: "application/json" },
      ...body !== void 0 ? { body: JSON.stringify(body) } : {}
    });
    if (!res.ok) await this.throwApiError(res);
    const text = await res.text();
    const data = text.length > 0 ? JSON.parse(text) : void 0;
    return data;
  }
  async fetchWithRetry(url, init, attempt = 0) {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt < maxRetries2) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const parsedRetryAfter = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : defaultRetryAfterSeconds2;
      const jitter = 0.7 + Math.random() * 0.6;
      const delayMs = Math.min(retryAfterSeconds * 1e3 * jitter, maxBackoffMs2);
      await new Promise((resolve12) => setTimeout(resolve12, delayMs));
      return this.fetchWithRetry(url, init, attempt + 1);
    }
    return res;
  }
  async throwApiError(res) {
    const parsed = await res.json().catch(() => void 0);
    const body = ConfluenceErrorBodySchema.catch({}).parse(parsed);
    const detail = body.errors?.map((e) => e.detail ?? e.title).filter(Boolean).join("; ") ?? body.message ?? "";
    throw new Error(`Confluence API ${res.status}${detail ? `: ${detail}` : ""}`);
  }
};

// src/tasks/mime-types/mime-types.ts
import { extname } from "node:path";
var mimeTypesByExtension = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  log: "text/plain",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webm: "video/webm",
  webp: "image/webp"
};
var fallbackMimeType = "application/octet-stream";
var ExtensionMimeTypeResolver = class {
  forFilename(filename) {
    const extension = extname(filename).slice(1).toLowerCase();
    return mimeTypesByExtension[extension] ?? fallbackMimeType;
  }
};
var extensionMimeTypeResolver = new ExtensionMimeTypeResolver();

// src/tasks/jira-task-tracker/markdown-adf.ts
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { decodeString } from "micromark-util-decode-string";
import { z as z21 } from "zod";
var MediaRefSchema = z21.object({
  mediaUuid: z21.string().min(1),
  collection: z21.string().default(""),
  width: z21.number().int().positive().optional(),
  height: z21.number().int().positive().optional()
});
var MediaLookupSchema = z21.record(z21.string(), MediaRefSchema);
var attachmentPrefix = /^attachment:/;
var externalTarget = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//;
var detailsOpen = /^<details>/;
var detailsClose = /^<\/details>/;
var summaryTag = /<summary>([\s\S]*?)<\/summary>/;
var panelTypes = {
  NOTE: "info",
  TIP: "success",
  IMPORTANT: "note",
  WARNING: "warning",
  CAUTION: "error"
};
var alertMarkers = Object.fromEntries(
  Object.entries(panelTypes).map(([marker, panelType]) => [panelType, marker])
);
var alertMarker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/;
var headingLine = /^#{1,6} \S/;
var quoteContent = /* @__PURE__ */ new Set(["paragraph", "bulletList", "orderedList", "codeBlock"]);
var panelContent = /* @__PURE__ */ new Set(["paragraph", "heading", "bulletList", "orderedList"]);
var listItemContent = /* @__PURE__ */ new Set(["paragraph", "codeBlock", "bulletList", "orderedList", "taskList"]);
var LayeredBodyAdfConverter = class {
  toAdf(markdown, media = {}) {
    const source = markdown.replace(/\r\n/g, "\n");
    const tree = this.parse(source);
    return { version: 1, type: "doc", content: this.blocks(tree.children, source, void 0, media, true) };
  }
  toMarkdown(nodes, media = {}) {
    const names = new Map(Object.entries(media).map(([filename, ref]) => [ref.mediaUuid, filename]));
    return this.render(nodes, names);
  }
  render(nodes, names) {
    return nodes.map((node) => this.blockToMarkdown(node, names)).filter((block) => block.length > 0).join("\n\n");
  }
  parse(markdown) {
    return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  }
  /**
   * Maps a run of sibling mdast blocks to ADF. `allowed`, when a container passes
   * it, restricts the output to that container's content model: a node whose ADF
   * type falls outside the set degrades to literal paragraph text rather than an
   * invalid child. `media` only reaches the block mapper at the document level
   * (`allowMedia`): a `mediaSingle` is valid ADF as a top-level block but not
   * inside a panel, blockquote, list item, or table cell, so nested runs resolve
   * no attachments and an image there stays literal.
   */
  blocks(nodes, source, allowed, media = {}, allowMedia = false, expandDepth = 0) {
    const out = [];
    let i = 0;
    while (i < nodes.length) {
      const node = nodes[i];
      if (node === void 0) {
        i++;
        continue;
      }
      if (allowed !== void 0 && !allowed.has(this.adfType(node))) {
        out.push(this.literalBlock(node, source, true));
        i++;
        continue;
      }
      if (node.type === "html" && detailsOpen.test(node.value)) {
        const paired = this.pairDetails(nodes, i, source, expandDepth);
        if (paired !== void 0) {
          out.push(...paired.nodes);
          i = paired.next;
          continue;
        }
        out.push(this.literalBlock(node, source));
        i++;
        continue;
      }
      if (node.type === "list") {
        out.push(...this.listNodes(node, source, expandDepth));
        i++;
        continue;
      }
      out.push(this.blockNode(node, source, allowMedia ? media : {}, expandDepth));
      i++;
    }
    return out;
  }
  blockNode(node, source, media, expandDepth = 0) {
    switch (node.type) {
      case "heading":
        return { type: "heading", attrs: { level: node.depth }, content: this.inline(node.children, source) };
      case "paragraph":
        return this.mediaSingle(node, media) ?? { type: "paragraph", content: this.inline(node.children, source) };
      case "code": {
        const lang = node.lang;
        const hasLang = lang !== null && lang !== void 0 && lang !== "";
        return {
          type: "codeBlock",
          attrs: hasLang ? { language: lang } : {},
          content: node.value === "" ? [] : [{ type: "text", text: node.value }]
        };
      }
      case "thematicBreak":
        return { type: "rule" };
      case "blockquote":
        return this.quoteOrPanel(node, source, expandDepth);
      case "table":
        return this.table(node, source);
      default:
        return this.literalBlock(node, source);
    }
  }
  /**
   * A paragraph that holds a single image becomes an inline `mediaSingle > media`
   * node when its target resolves in the lookup, so an uploaded attachment renders
   * where the reader is looking. Returns undefined for anything else — an image
   * mid-sentence, or an unresolved target — leaving the paragraph to map its image
   * to literal text. `layout` is required by ADF; `alt` is emitted for Jira's own
   * example even though it is undocumented, and `width`/`height` only when known.
   */
  mediaSingle(node, media) {
    const [only, ...rest] = node.children;
    if (only === void 0 || only.type !== "image" || rest.length > 0) return void 0;
    const ref = this.resolveMedia(only.url, media);
    if (ref === void 0) return void 0;
    return {
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [
        {
          type: "media",
          attrs: {
            type: "file",
            id: ref.mediaUuid,
            collection: ref.collection,
            alt: only.alt ?? "",
            ...ref.width !== void 0 ? { width: ref.width } : {},
            ...ref.height !== void 0 ? { height: ref.height } : {}
          }
        }
      ]
    };
  }
  /**
   * Resolves an image target to an uploaded attachment, or undefined to leave the
   * image literal. An `attachment:` marker addresses an attachment directly — by
   * exact media UUID first, then by filename — and is never treated as external.
   * Any other URL scheme (or a protocol-relative `//`) is a genuine external image
   * and resolves to nothing, so a lookup keyed by filename cannot hijack
   * `https://host/before.png`. A bare local path resolves by basename.
   */
  resolveMedia(target, media) {
    if (attachmentPrefix.test(target)) {
      const rest = target.replace(attachmentPrefix, "");
      return this.mediaByUuid(rest, media) ?? this.mediaByName(rest, media);
    }
    if (externalTarget.test(target)) return void 0;
    return this.mediaByName(target, media);
  }
  mediaByUuid(value, media) {
    return Object.values(media).find((ref) => ref.mediaUuid === value);
  }
  /** Looks up a target's basename as an OWN entry, so inherited names (`constructor`, `__proto__`) never resolve. */
  mediaByName(target, media) {
    const basename5 = target.slice(target.lastIndexOf("/") + 1);
    return Object.hasOwn(media, basename5) ? media[basename5] : void 0;
  }
  /** The ADF block type an mdast node maps to, or `''` when it only degrades to literal text. */
  adfType(node) {
    switch (node.type) {
      case "heading":
        return "heading";
      case "paragraph":
        return "paragraph";
      case "code":
        return "codeBlock";
      case "thematicBreak":
        return "rule";
      case "blockquote":
        return "blockquote";
      case "table":
        return "table";
      case "list":
        return this.listAdfType(node);
      default:
        return "";
    }
  }
  listAdfType(node) {
    if (node.children.some((item) => item.checked === true || item.checked === false)) return "taskList";
    return node.ordered === true ? "orderedList" : "bulletList";
  }
  /**
   * A blockquote whose first paragraph opens with a `[!TYPE]` marker is a GitHub
   * admonition and maps to an ADF `panel` — but only when its remaining blocks all
   * fit the panel content model. A code fence (or anything else a panel rejects)
   * forces the plain-`blockquote` fallback, which keeps the marker as literal text
   * in the first paragraph. A blockquote with no marker maps straight to
   * `blockquote`, its own disallowed children (headings, nested quotes) degrading.
   */
  quoteOrPanel(node, source, expandDepth = 0) {
    const depth = expandDepth + 1;
    const marker = this.alertType(node);
    const panelType = marker === void 0 ? void 0 : panelTypes[marker];
    if (marker !== void 0 && panelType !== void 0) {
      const rest = this.stripAlertMarker(node.children);
      if (rest.every((child) => panelContent.has(this.adfType(child)))) {
        return { type: "panel", attrs: { panelType }, content: this.withBlockContent(this.blocks(rest, source, panelContent, {}, false, depth)) };
      }
    }
    return { type: "blockquote", content: this.withBlockContent(this.blocks(node.children, source, quoteContent, {}, false, depth)) };
  }
  /**
   * ADF's `panel` and `blockquote` content models require at least one child, so a
   * marker-only alert or a bare `>` (which leave no body) get an empty paragraph
   * rather than an empty, schema-invalid container.
   */
  withBlockContent(nodes) {
    return nodes.length === 0 ? [{ type: "paragraph", content: [] }] : nodes;
  }
  alertType(node) {
    const first = node.children[0];
    if (first === void 0 || first.type !== "paragraph") return void 0;
    const text = first.children[0];
    if (text === void 0 || text.type !== "text") return void 0;
    return alertMarker.exec(text.value)?.[1];
  }
  /**
   * Returns the blockquote's children with the admonition marker (and its trailing
   * newline) removed from the first paragraph, dropping that paragraph when nothing
   * but the marker remained. mdast keeps the marker and the first body line in one
   * text node when no blank `>` line separates them, so only the leading text is rewritten.
   */
  stripAlertMarker(children) {
    const [first, ...rest] = children;
    if (first === void 0 || first.type !== "paragraph") return children;
    const [text, ...moreInline] = first.children;
    if (text === void 0 || text.type !== "text") return children;
    const stripped = text.value.replace(alertMarker, "");
    const inline = stripped === "" ? moreInline : [{ ...text, value: stripped }, ...moreInline];
    if (inline.length === 0) return rest;
    return [{ ...first, children: inline }, ...rest];
  }
  /**
   * mdast tables carry phrasing cells and per-column alignment; ADF cells hold
   * block content and cannot express alignment, so each cell becomes a single
   * paragraph, the first row's cells become `tableHeader`, and `node.align` is
   * dropped. An empty cell keeps an empty paragraph so every cell has block content.
   */
  table(node, source) {
    const rows = node.children.map((row, index) => ({
      type: "tableRow",
      content: row.children.map((cell) => ({
        type: index === 0 ? "tableHeader" : "tableCell",
        attrs: {},
        content: [{ type: "paragraph", content: this.inline(cell.children, source) }]
      }))
    }));
    return { type: "table", content: rows };
  }
  /**
   * Re-pairs a `<details>`/`</details>` run of sibling blocks into a single
   * expand. `mdast-util-from-markdown` emits an `html` node for each opener and
   * closer with the inner markdown as ordinary siblings between them, so this
   * scans forward counting nesting depth on those html nodes. The `<summary>`
   * (which shares the opener's html node) becomes the title; if the author left
   * content after `</summary>` on the same html block instead of a blank line,
   * that remainder is parsed and prepended to the inner blocks. An unclosed run
   * returns undefined so the caller degrades the opener to literal text.
   *
   * `expandDepth` is 0 only when this `<details>` is a direct child of the
   * document, because ADF allows an `expand` only at the document top level —
   * never inside a list item, quote, panel, or another expand. So a top-level
   * `<details>` becomes an `expand`, and any nested `<details>` flattens to a
   * bold-titled run of its body — schema-valid content the top-level expand's
   * broad model accepts, rather than the misplaced expand it used to emit, which
   * Jira rejects outright.
   */
  pairDetails(nodes, start, source, expandDepth = 0) {
    const opener = nodes[start];
    if (opener === void 0 || opener.type !== "html") return void 0;
    let depth = 0;
    let end = -1;
    for (let j = start; j < nodes.length; j++) {
      const sibling = nodes[j];
      if (sibling === void 0) continue;
      if (sibling.type === "html" && detailsOpen.test(sibling.value)) depth++;
      else if (sibling.type === "html" && detailsClose.test(sibling.value)) depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) return void 0;
    const summary = opener.value.match(summaryTag);
    const title = summary?.[1]?.trim() ?? "";
    const remainder = summary === null ? "" : opener.value.slice((summary.index ?? 0) + summary[0].length);
    const inner = this.blocks(nodes.slice(start + 1, end), source, void 0, {}, false, expandDepth + 1);
    const leading = remainder.trim() === "" ? [] : this.blocks(this.parse(remainder).children, remainder, void 0, {}, false, expandDepth + 1);
    const content = [...leading, ...inner];
    if (expandDepth > 0) {
      const heading = { type: "paragraph", content: [{ type: "text", text: title, marks: [{ type: "strong" }] }] };
      return { nodes: title === "" ? content : [heading, ...content], next: end + 1 };
    }
    return { nodes: [{ type: "expand", attrs: { title }, content: this.withBlockContent(content) }], next: end + 1 };
  }
  listNodes(node, source, expandDepth = 0) {
    if (node.children.some((item) => item.checked === true || item.checked === false)) {
      return this.taskList(node, source, expandDepth);
    }
    const ordered = node.ordered === true;
    const start = typeof node.start === "number" ? node.start : 1;
    const spread = node.spread === true || node.children.some((item) => item.spread === true);
    if (spread) {
      return node.children.map((item, index) => this.singleList(ordered, start + index, [item], source, expandDepth));
    }
    return [this.singleList(ordered, start, node.children, source, expandDepth)];
  }
  singleList(ordered, order, items, source, expandDepth = 0) {
    const content = items.map((item) => ({
      type: "listItem",
      content: this.restrictToListItem(this.blocks(item.children, source, void 0, {}, false, expandDepth + 1))
    }));
    if (!ordered) return { type: "bulletList", content };
    return { type: "orderedList", ...order === 1 ? {} : { attrs: { order } }, content };
  }
  /**
   * Coerces block content into a `listItem`'s content model, filling an empty item
   * with a paragraph. See {@link coerceListItemBlock} for the per-block rule.
   */
  restrictToListItem(nodes) {
    return this.withBlockContent(nodes.flatMap((node) => this.coerceListItemBlock(node)));
  }
  /**
   * Reshapes one block into what a `listItem` may hold, preserving inline nodes —
   * mention identity above all. A heading becomes a paragraph of its inline
   * content; a quote, panel, or table unwraps to its own (already listItem-valid)
   * inner blocks rather than being re-serialized to markdown, which would flatten a
   * mention into literal `@{…}` text that later exports re-escape into corruption; a
   * rule drops, having no list-item form. Paragraphs, code blocks, and nested lists
   * pass straight through.
   */
  coerceListItemBlock(node) {
    if (listItemContent.has(node.type)) return [node];
    if (node.type === "heading") return [{ type: "paragraph", content: node.content ?? [] }];
    if (node.type === "rule") return [];
    if (node.type === "table") {
      return (node.content ?? []).flatMap((row) => row.content ?? []).flatMap((cell) => cell.content ?? []).flatMap((block) => this.coerceListItemBlock(block));
    }
    return (node.content ?? []).flatMap((child) => this.coerceListItemBlock(child));
  }
  /**
   * ADF's `taskItem` is inline-only, so each item takes just the inline content
   * of its leading paragraph. A task item's remaining blocks (a nested list or a
   * continuation paragraph) can't live inside the taskItem or nest a list within
   * it — both are invalid ADF — so they spill out as sibling blocks after the
   * taskList, preserving the content without corrupting the flat-checklist case
   * that gets posted to Jira. Round-trip stays valid; the rare nested case flattens.
   */
  taskList(node, source, expandDepth = 0) {
    const overflow = [];
    const content = node.children.map((item, index) => {
      const first = item.children[0];
      const leadsWithParagraph = first !== void 0 && first.type === "paragraph";
      overflow.push(...this.blocks(leadsWithParagraph ? item.children.slice(1) : item.children, source, void 0, {}, false, expandDepth + 1));
      return {
        type: "taskItem",
        attrs: { localId: `task-${index + 1}`, state: item.checked === true ? "DONE" : "TODO" },
        content: leadsWithParagraph ? this.inline(first.children, source) : []
      };
    });
    return [{ type: "taskList", attrs: { localId: "task-list" }, content }, ...overflow];
  }
  inline(nodes, source, marks = []) {
    const out = [];
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          out.push(...this.mentionSegments(this.literal(node, source), node.value, marks));
          break;
        case "emphasis":
          out.push(...this.inline(node.children, source, [...marks, { type: "em" }]));
          break;
        case "strong":
          out.push(...this.inline(node.children, source, [...marks, { type: "strong" }]));
          break;
        case "delete":
          out.push(...this.inline(node.children, source, [...marks, { type: "strike" }]));
          break;
        // ADF's code mark excludes fontStyle marks (so inherited emphasis/strong drop) but keeps an enclosing link.
        case "inlineCode":
          out.push({
            type: "text",
            text: node.value,
            marks: [...marks.filter((mark) => mark.type === "link"), { type: "code" }]
          });
          break;
        case "break":
          out.push({ type: "hardBreak" });
          break;
        case "link": {
          const hasTitle = typeof node.title === "string" && node.title !== "";
          const attrs = hasTitle ? { href: node.url, title: node.title } : { href: node.url };
          const link = { type: "link", attrs };
          out.push(...this.inline(node.children, source, [...marks.filter((mark) => mark.type !== "link"), link]));
          break;
        }
        default:
          out.push({ type: "text", text: this.literal(node, source), ...marks.length > 0 ? { marks } : {} });
      }
    }
    return out;
  }
  /**
   * Splits a text value on soft line breaks. mdast keeps a soft break as a `\n`
   * inside one `text` node, but today's ADF interleaves `hardBreak` nodes and
   * the multi-line-paragraph round-trip depends on that. An empty segment — from a
   * value that leads or trails with the break, e.g. a mention starting a line —
   * emits only its hardBreak, never an empty `text` node, which ADF rejects.
   */
  textSegments(value, marks) {
    const out = [];
    value.split("\n").forEach((segment, index) => {
      if (index > 0) out.push({ type: "hardBreak" });
      if (segment !== "") out.push({ type: "text", text: segment, ...marks.length > 0 ? { marks } : {} });
    });
    return out;
  }
  /**
   * Splits `@{accountId|Display Name}` tokens out of an inline text node into
   * `mention` nodes. Detection runs over the raw source slice, because only the
   * source tells an escaped `\@{…}` (and an entity-encoded `&#64;{…}`, which never
   * matches the literal-`@` token) from a real mention; mdast's decoded value
   * collapses all three to `@{…}`, so pairing decoded matches to source ones by
   * order would hand an escape flag to the wrong token. The surrounding text and
   * the split points come from the decoded `value` instead: each real mention's
   * decoded token (`@{id|display}`, rebuilt with the same `decodeString` mdast
   * applied) is located in `value` in order, and the text between tokens is
   * emitted straight from `value`, so a container marker that survives in the
   * source slice — a blockquote's `> ` continuation, an alert's stripped
   * `[!TYPE]` — never leaks into the text. An escaped token, or a pipe-less
   * `@{Name}`, stays literal text; the id resolves identity, and mentions never
   * carry marks.
   */
  mentionSegments(raw, value, marks) {
    const regex = this.mentionToken();
    const mentions = [];
    let match;
    while ((match = regex.exec(raw)) !== null) {
      if (this.isEscaped(raw, match.index)) continue;
      const id = decodeString(match[1] ?? "");
      const display = decodeString(match[2] ?? "");
      mentions.push({ token: `@{${id}|${display}}`, node: this.mention(id, display) });
    }
    if (mentions.length === 0) return this.textSegments(value, marks);
    const realCount = /* @__PURE__ */ new Map();
    for (const { token } of mentions) realCount.set(token, (realCount.get(token) ?? 0) + 1);
    const decodedIsSound = [...realCount].every(([token, n]) => this.countOccurrences(value, token) === n);
    if (!decodedIsSound) return this.mentionSegmentsFromSource(raw, marks);
    const out = [];
    let cursor = 0;
    for (const { token, node } of mentions) {
      const at = value.indexOf(token, cursor);
      if (at === -1) return this.mentionSegmentsFromSource(raw, marks);
      if (at > cursor) out.push(...this.textSegments(value.slice(cursor, at), marks));
      out.push(node);
      cursor = at + token.length;
    }
    if (cursor < value.length || out.length === 0) out.push(...this.textSegments(value.slice(cursor), marks));
    return out;
  }
  /** Non-overlapping occurrences of `needle` in `haystack`. */
  countOccurrences(haystack, needle) {
    let count = 0;
    let from = 0;
    for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, from)) {
      count++;
      from = at + needle.length;
    }
    return count;
  }
  /**
   * The original source-space split, kept for the rare text node where the decoded
   * value carries a literal identical to a real mention (an escaped or entity token).
   * It emits the surrounding text from the source slice, so a container marker there
   * can leak — the same, pre-existing behaviour — but escape, entity, and order stay
   * exact, which matters more than a marker in that corner.
   */
  mentionSegmentsFromSource(raw, marks) {
    const out = [];
    const regex = this.mentionToken();
    let buffer = "";
    let cursor = 0;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      buffer += raw.slice(cursor, match.index);
      cursor = match.index + match[0].length;
      if (this.isEscaped(raw, match.index)) {
        buffer += match[0];
        continue;
      }
      if (buffer.length > 0) {
        out.push(...this.textSegments(decodeString(buffer), marks));
        buffer = "";
      }
      out.push(this.mention(decodeString(match[1] ?? ""), decodeString(match[2] ?? "")));
    }
    buffer += raw.slice(cursor);
    if (buffer.length > 0 || out.length === 0) out.push(...this.textSegments(decodeString(buffer), marks));
    return out;
  }
  /** A token is escaped when an odd run of backslashes precedes its `@`. */
  isEscaped(raw, index) {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && raw[i] === "\\"; i--) backslashes++;
    return backslashes % 2 === 1;
  }
  mention(id, display) {
    return { type: "mention", attrs: { id, ...display !== "" ? { text: `@${display}` } : {} } };
  }
  /**
   * The canonical mention token `@{accountId|Display Name}`. The pipe is
   * required so a literal `@{Name}` stays text, and the display admits `\`
   * escapes so a display carrying a brace or markdown delimiter round-trips.
   * Built fresh per call because the `g` flag carries `lastIndex` and the inline
   * walk recurses.
   */
  mentionToken() {
    return /@\{([^|{}\n]+)\|((?:\\[^\n]|[^{}\\\n])*)\}/g;
  }
  /**
   * Degrades an unmappable block to a literal paragraph of its source text. When
   * demoted into a container that re-quotes its body (a blockquote), the outer
   * `> ` on each continuation line belongs to the enclosing quote, not the child —
   * mdast strips it from the first line only — so `stripEnclosingQuote` removes one
   * quote level from the rest. Otherwise a nested quote, quoted table, or quoted
   * task list would accrete a `>` on every round trip.
   */
  literalBlock(node, source, stripEnclosingQuote = false) {
    const text = this.literal(node, source);
    const inner = stripEnclosingQuote ? this.stripEnclosingQuote(text) : text;
    return { type: "paragraph", content: this.textSegments(inner, []) };
  }
  stripEnclosingQuote(text) {
    return text.split("\n").map((line, index) => index === 0 ? line : line.replace(/^> ?/, "")).join("\n");
  }
  literal(node, source) {
    return source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  }
  /** A Smart Link has no text; it renders as a plain link to attrs.url, or nothing without one. */
  smartLinkToMarkdown(node) {
    const url = node.attrs?.["url"];
    return typeof url === "string" && url !== "" ? this.linkToMarkdown(url, { type: "link", attrs: { href: url } }) : "";
  }
  blockToMarkdown(node, names) {
    switch (node.type) {
      case "heading": {
        const level = typeof node.attrs?.["level"] === "number" ? node.attrs["level"] : 1;
        return `${"#".repeat(level)} ${this.inlineToMarkdown(node.content ?? [], names)}`;
      }
      case "paragraph":
        return this.inlineToMarkdown(node.content ?? [], names);
      case "codeBlock": {
        const language = typeof node.attrs?.["language"] === "string" ? node.attrs["language"] : "";
        const text = (node.content ?? []).map((child) => child.text ?? "").join("");
        return `\`\`\`${language}
${text}
\`\`\``;
      }
      case "taskList":
        return (node.content ?? []).map(
          (item) => `- [${item.attrs?.["state"] === "DONE" ? "x" : " "}] ${this.inlineToMarkdown(item.content ?? [], names)}`
        ).join("\n");
      case "bulletList":
        return (node.content ?? []).map((item) => this.listItemToMarkdown(item, "- ", names)).join("\n");
      case "orderedList": {
        const order = typeof node.attrs?.["order"] === "number" ? node.attrs["order"] : 1;
        return (node.content ?? []).map((item, index) => this.listItemToMarkdown(item, `${order + index}. `, names)).join("\n");
      }
      // A nestedExpand reads back to the same `<details>` as an expand; depth re-derives which to emit on write.
      case "expand":
      case "nestedExpand": {
        const title = typeof node.attrs?.["title"] === "string" ? node.attrs["title"] : "";
        return `<details><summary>${title}</summary>

${this.render(node.content ?? [], names)}

</details>`;
      }
      case "rule":
        return "---";
      case "table":
        return this.tableToMarkdown(node, names);
      case "blockquote":
        return this.quoteToMarkdown(this.containerBody(node.content ?? [], names));
      case "panel":
        return this.panelToMarkdown(node, names);
      // A media node lands here directly (inside a mediaSingle) or standalone; both read back as a reference.
      case "mediaSingle":
      case "mediaGroup":
        return (node.content ?? []).map((child) => this.blockToMarkdown(child, names)).join("\n\n");
      case "media":
        return this.mediaReference(node, names);
      // Block Smart Links keep their destination in attrs.url, like inlineCard, and read back as a link paragraph.
      case "blockCard":
      case "embedCard":
        return this.smartLinkToMarkdown(node);
      default:
        return node.text ?? this.render(node.content ?? [], names);
    }
  }
  /**
   * Recovers an image reference from a `media` (or `mediaInline`) node, escaping
   * the alt text and the destination exactly as a link's are so a filename with a
   * space or bracket (a screenshot named `screen shot.png`) survives the round
   * trip. A `type: 'external'` node carries a `url` and reads back as
   * `![alt](url)`; otherwise the filename comes from the inverted lookup and
   * degrades to the media UUID, never to `alt`, which Jira does not always preserve.
   */
  mediaReference(node, names) {
    const alt = typeof node.attrs?.["alt"] === "string" ? node.attrs["alt"] : "";
    const url = node.attrs?.["url"];
    const id = typeof node.attrs?.["id"] === "string" ? node.attrs["id"] : "";
    const destination = typeof url === "string" ? url : `attachment:${names.get(id) ?? id}`;
    return `![${this.encodeAlt(alt)}](${this.encodeDestination(destination)})`;
  }
  /**
   * Escapes image alt text so `![alt](dest)` re-parses to the same alt: the `]`
   * that would close the description early, `\` itself, the markdown delimiters
   * that would reinterpret the name, and `&` (which would otherwise decode as an
   * entity) each gain a backslash that mdast strips on the way back.
   */
  encodeAlt(alt) {
    return alt.replace(/[\\[\]*`~_&]/g, (ch) => `\\${ch}`);
  }
  /**
   * Joins a container's child blocks. A markdown heading is self-delimiting, so
   * the block after one needs no blank line; every other block gets the usual
   * blank line. That reproduces `> ## x` then `> body` (a heading demoted to
   * literal text inside a quote) and a panel heading followed by a paragraph.
   */
  containerBody(nodes, names) {
    let out = "";
    for (const node of nodes) {
      const rendered = this.blockToMarkdown(node, names);
      if (rendered.length === 0) continue;
      if (out.length === 0) {
        out = rendered;
        continue;
      }
      const previousLine = out.slice(out.lastIndexOf("\n") + 1);
      out = `${out}${headingLine.test(previousLine) ? "\n" : "\n\n"}${rendered}`;
    }
    return out;
  }
  quoteToMarkdown(body) {
    return body.split("\n").map((line) => line.length === 0 ? ">" : `> ${line}`).join("\n");
  }
  /**
   * Emits an admonition as `> [!TYPE]` over the quoted body. An unknown panelType
   * has no marker to restore, so it degrades to a plain blockquote.
   */
  panelToMarkdown(node, names) {
    const panelType = typeof node.attrs?.["panelType"] === "string" ? node.attrs["panelType"] : "";
    const marker = alertMarkers[panelType];
    const body = this.containerBody(node.content ?? [], names);
    if (marker === void 0) return this.quoteToMarkdown(body);
    return body.length === 0 ? `> [!${marker}]` : `> [!${marker}]
${this.quoteToMarkdown(body)}`;
  }
  /**
   * Emits a GFM table: a header row, a `---` delimiter (alignment is not
   * representable in ADF and is dropped), then the body. The first row is always
   * the header even when its cells read back as `tableCell`.
   */
  tableToMarkdown(node, names) {
    const lines = [];
    (node.content ?? []).forEach((row, index) => {
      const cells = (row.content ?? []).map((cell) => this.cellToMarkdown(cell, names));
      lines.push(`| ${cells.join(" | ")} |`);
      if (index === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    });
    return lines.join("\n");
  }
  /**
   * Flattens a cell's block content to one line: blocks join with a space, a UI
   * cell's internal newlines collapse to spaces, and a literal `|` re-escapes so
   * it survives GFM's cell parse (which unescapes `\|`) instead of splitting the row.
   */
  cellToMarkdown(cell, names) {
    return (cell.content ?? []).map((block) => this.blockToMarkdown(block, names)).join(" ").replace(/\n/g, " ").replace(/\|/g, "\\|");
  }
  /**
   * Emits one list item and its nested blocks. ADF holds a nested list as a
   * sibling of the item's paragraph, so a nested list joins onto the item with a
   * single newline while any other block joins with a blank line; continuation
   * lines then indent by the marker width, nesting `- ` at two spaces, `1. ` at
   * three, and `10. ` at four.
   */
  listItemToMarkdown(item, marker, names) {
    let body = "";
    for (const block of item.content ?? []) {
      const rendered = this.blockToMarkdown(block, names);
      if (rendered.length === 0) continue;
      const nestedList = block.type === "bulletList" || block.type === "orderedList" || block.type === "taskList";
      body = body.length === 0 ? rendered : `${body}${nestedList ? "\n" : "\n\n"}${rendered}`;
    }
    const indent = " ".repeat(marker.length);
    return `${marker}${body.replace(/\n/g, `
${indent}`)}`;
  }
  /**
   * Serializes a text node's marks as coalesced spans rather than wrapping each
   * node independently. Marks are stored outermost-first, so a delimiter opens
   * when a mark first appears across adjacent nodes and closes only once it stops
   * applying to the next node. That keeps a mark spanning several text nodes as a
   * single span (`**before [x](u) after**`) instead of re-opening it per node,
   * which would re-parse to duplicate marks. Text inside a code span is emitted
   * verbatim; all other text is escaped so decoded literals (`literal *x*`)
   * don't re-parse as syntax.
   */
  inlineToMarkdown(nodes, names) {
    let out = "";
    const open = [];
    const closeFrom = (from) => {
      while (open.length > from) {
        const mark = open.pop();
        if (mark !== void 0) out += this.markClose(mark);
      }
    };
    for (const node of nodes) {
      if (node.type === "mediaInline") {
        out += this.mediaReference(node, names);
        continue;
      }
      if (node.type === "mention") {
        const codeDepth = open.findIndex((mark) => mark.type === "code");
        if (codeDepth !== -1) closeFrom(codeDepth);
        out += this.mentionToMarkdown(node);
        continue;
      }
      if (node.type === "inlineCard") {
        closeFrom(0);
        out += this.smartLinkToMarkdown(node);
        continue;
      }
      if (node.type === "status") {
        closeFrom(0);
        const label = node.attrs?.["text"];
        if (typeof label === "string" && label.trim() !== "") out += `**[${this.escapeText(label.trim(), false)}]**`;
        continue;
      }
      if (node.type === "hardBreak") {
        closeFrom(0);
        out += "\n";
        continue;
      }
      if (node.text === void 0) {
        closeFrom(0);
        const inner = node.content !== void 0 ? this.inlineToMarkdown(node.content, names) : "";
        out += [...node.marks ?? []].reverse().reduce((text2, mark) => this.applyMark(text2, mark), inner);
        continue;
      }
      const marks = node.marks ?? [];
      const solo = marks[0];
      if (marks.length === 1 && open.length === 0 && solo !== void 0) {
        const bare = this.tryBareUrl(node.text, solo);
        if (bare !== void 0) {
          out += bare;
          continue;
        }
      }
      let common = 0;
      while (common < open.length && common < marks.length) {
        const opened = open[common];
        const wanted = marks[common];
        if (opened === void 0 || wanted === void 0 || !this.marksEqual(opened, wanted)) break;
        common++;
      }
      closeFrom(common);
      const opening = marks.slice(common);
      let text = node.text;
      if (common === 0 && opening.length > 0 && opening.every((mark) => this.isEmphasis(mark))) {
        const lead = /^\s+/.exec(text)?.[0];
        if (lead !== void 0 && lead.length < text.length) {
          out += lead;
          text = text.slice(lead.length);
        }
      }
      for (let k = common; k < marks.length; k++) {
        const mark = marks[k];
        if (mark === void 0) continue;
        out += this.markOpen(mark);
        open.push(mark);
      }
      out += this.escapeText(text, open.some((mark) => mark.type === "code"));
    }
    closeFrom(0);
    return out;
  }
  isEmphasis(mark) {
    return mark.type === "em" || mark.type === "strong" || mark.type === "strike";
  }
  /**
   * Emits a `mention` node as `@{id|display}`, dropping the leading `@` from
   * `attrs.text`, and `@{id|}` when `attrs.text` is absent so the read is Jira's
   * to re-resolve from the id. The display is escaped so the token re-parses
   * atomically instead of losing the mention to markdown inside the name.
   */
  mentionToMarkdown(node) {
    const id = typeof node.attrs?.["id"] === "string" ? node.attrs["id"] : "";
    const text = node.attrs?.["text"];
    const display = typeof text === "string" ? text.startsWith("@") ? text.slice(1) : text : "";
    return `@{${id}|${this.escapeMentionDisplay(display)}}`;
  }
  /**
   * Escapes a display name so `@{id|display}` re-parses as one mention: the
   * `}` terminator, `\` itself, the markdown delimiters that would re-interpret
   * the name, and `&` (which would otherwise decode as an entity) each gain a
   * backslash that `decodeString` strips on the way back.
   */
  escapeMentionDisplay(display) {
    return display.replace(/[\\{}*_`[\]&]/g, (ch) => `\\${ch}`);
  }
  /**
   * Wraps text in the markdown for one mark, innermost-first. Only used for the
   * rare content-bearing inline node; the main text path coalesces marks instead.
   */
  applyMark(text, mark) {
    switch (mark.type) {
      case "code":
        return `\`${text}\``;
      case "em":
        return `*${text}*`;
      case "strong":
        return `**${text}**`;
      case "strike":
        return `~~${text}~~`;
      case "link":
        return this.linkToMarkdown(text, mark);
      default:
        return text;
    }
  }
  markOpen(mark) {
    switch (mark.type) {
      case "code":
        return "`";
      case "em":
        return "*";
      case "strong":
        return "**";
      case "strike":
        return "~~";
      case "link":
        return typeof mark.attrs?.["href"] === "string" ? "[" : "";
      default:
        return "";
    }
  }
  markClose(mark) {
    switch (mark.type) {
      case "code":
        return "`";
      case "em":
        return "*";
      case "strong":
        return "**";
      case "strike":
        return "~~";
      case "link":
        return this.linkClose(mark);
      default:
        return "";
    }
  }
  linkClose(mark) {
    const href = mark.attrs?.["href"];
    if (typeof href !== "string") return "";
    const title = mark.attrs?.["title"];
    const suffix = typeof title === "string" ? ` "${this.encodeTitle(title)}"` : "";
    return `](${this.encodeDestination(href)}${suffix})`;
  }
  marksEqual(a, b) {
    if (a.type !== b.type) return false;
    if (a.type === "link") return a.attrs?.["href"] === b.attrs?.["href"] && a.attrs?.["title"] === b.attrs?.["title"];
    return true;
  }
  /**
   * Collapses a link whose visible text equals its destination to the bare url,
   * but only when the destination needs no escaping and there's no title — so the
   * autolink re-parses to the same href. Otherwise the caller emits `[text](dest)`.
   */
  tryBareUrl(text, mark) {
    if (mark.type !== "link") return void 0;
    const href = mark.attrs?.["href"];
    if (typeof href !== "string") return void 0;
    if (typeof mark.attrs?.["title"] === "string") return void 0;
    if (text !== href || this.encodeDestination(href) !== href) return void 0;
    return href;
  }
  linkToMarkdown(text, mark) {
    const href = mark.attrs?.["href"];
    if (typeof href !== "string") return text;
    const bare = this.tryBareUrl(text, mark);
    if (bare !== void 0) return bare;
    const title = mark.attrs?.["title"];
    const suffix = typeof title === "string" ? ` "${this.encodeTitle(title)}"` : "";
    return `[${text}](${this.encodeDestination(href)}${suffix})`;
  }
  /**
   * Escapes a link destination so it re-parses to the same string: literal `\`
   * and `&` are backslash-escaped (mdast otherwise reads `&copy;` as an entity),
   * and a destination carrying spaces, control chars, or parens is wrapped in
   * `<...>` with its `<`/`>` escaped.
   */
  encodeDestination(url) {
    const escaped = url.replace(/[\\&]/g, (ch) => `\\${ch}`);
    if (/[ \t -()]/.test(url)) return `<${escaped.replace(/[<>]/g, (ch) => `\\${ch}`)}>`;
    return escaped;
  }
  /**
   * Escapes a link title emitted inside `"..."`: `\`, `&`, and the `"` delimiter
   * are backslash-escaped so the title re-parses unchanged instead of breaking
   * the link or being read as an entity.
   */
  encodeTitle(title) {
    return title.replace(/[\\&"]/g, (ch) => `\\${ch}`);
  }
  /**
   * Escapes literal text so mdast-decoded content doesn't re-parse as syntax:
   * `\`, `*`, and `` ` `` are the markers that would otherwise reinterpret plain
   * text as emphasis or code. Text inside a code span is left verbatim, and
   * characters that only matter at block scope (`[`, `|`, `>`, `!`) stay
   * unescaped so degraded literal blocks round-trip byte-for-byte. Marks like
   * emphasis are emitted via their own delimiters, not through this. A literal
   * text node that itself reads as a mention token (`@{id|name}`) is escaped to
   * `\@{…}` so it re-parses as text rather than a mention.
   */
  escapeText(text, insideCode) {
    if (insideCode) return text;
    const escaped = text.replace(/[\\*`]/g, (ch) => `\\${ch}`);
    return escaped.replace(this.mentionToken(), (full) => `\\${full}`);
  }
};
var markdownAdfConverter = new LayeredBodyAdfConverter();

// src/tasks/jira-task-tracker/adf-metadata.ts
import { parse as parseYaml2, stringify as stringifyYaml2 } from "yaml";

// src/tasks/jira-task-tracker/adf.ts
var DefaultAdfBuilder = class {
  doc(text) {
    return {
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }]
    };
  }
  codeBlock(text, language = "yaml") {
    return {
      type: "codeBlock",
      attrs: { language },
      content: [{ type: "text", text }]
    };
  }
  expand(title, child) {
    return {
      type: "expand",
      attrs: { title },
      content: [child]
    };
  }
};
var adfBuilder = new DefaultAdfBuilder();

// src/tasks/jira-task-tracker/adf-metadata.ts
var metadataTitle = "LLM Context";
var JiraAdfMetadataService = class {
  parse(doc) {
    const yaml = this.readMetadataYaml(doc);
    if (yaml === void 0) return {};
    const raw = parseYaml2(yaml);
    if (raw === null || raw === void 0 || typeof raw !== "object" || Array.isArray(raw)) return {};
    Reflect.deleteProperty(raw, "size");
    return EntityMetadataSchema.parse(raw);
  }
  splice(doc, patch) {
    const merged = { ...this.parse(doc) };
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== void 0) merged[key] = value;
    });
    const node = adfBuilder.expand(metadataTitle, adfBuilder.codeBlock(stringifyYaml2(merged).trimEnd()));
    const contentWithoutMetadata = doc.content.filter((n) => !this.isMetadataExpand(n));
    return { ...doc, content: [...contentWithoutMetadata, node] };
  }
  readMetadataYaml(doc) {
    const expand = doc.content.find((n) => this.isMetadataExpand(n));
    const codeBlock = expand?.content?.find((n) => n.type === "codeBlock");
    const text = codeBlock?.content?.find((n) => n.type === "text")?.text;
    if (text === void 0 || text.trim() === "") return void 0;
    return text;
  }
  isMetadataExpand(node) {
    return node.type === "expand" && node.attrs?.["title"] === metadataTitle;
  }
};
var jiraAdfMetadataService = new JiraAdfMetadataService();

// src/tasks/jira-task-tracker/jira-task-tracker.ts
var metadataExpandTitle = "LLM Context";
var issueFields = "summary,status,labels,assignee,description,issuelinks,updated";
var ticketFields = `${issueFields},attachment,reporter,issuetype`;
var ideaIssueType = "Idea";
var jpdProjectType = "product_discovery";
var deliveryLinkOutward = "implements";
var tddMetadataPropertyKey = "flight-rules-metadata";
var mediaFilePath = /^\/file\/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})\/binary$/;
var mediaLocationBase = "https://media.invalid/";
var JiraUploadedAttachmentSchema = z22.object({
  id: z22.union([z22.string(), z22.number()]).transform(String),
  filename: z22.string(),
  mimeType: z22.string(),
  size: z22.number().optional()
});
var JiraUploadedAttachmentsSchema = z22.array(JiraUploadedAttachmentSchema);
var adfDocValidator = (value) => typeof value === "object" && value !== null && "type" in value && value.type === "doc" && "content" in value && Array.isArray(value.content) && value.content.every(
  (node) => typeof node === "object" && node !== null && "type" in node && typeof node.type === "string"
);
var JiraTaskTracker = class {
  client;
  confluence;
  project;
  jpdProject;
  confluenceSpaceKey;
  metadata = new JiraAdfMetadataService();
  bodyFormat = markdownAdfConverter;
  mimeTypes = new ExtensionMimeTypeResolver();
  issueTypeNames;
  blocksLinkType;
  deliveryLinkType;
  confluenceSpaceId;
  jpdProjectVerified = false;
  constructor(config) {
    this.client = new JiraClient({ host: config.host, email: config.email, token: config.token });
    this.confluence = new ConfluenceClient({
      host: config.host,
      email: config.email,
      token: config.token
    });
    this.project = config.project;
    this.jpdProject = config.jpdProject;
    this.confluenceSpaceKey = config.confluenceSpaceKey;
  }
  async createEpic(input) {
    const issuetype = await this.resolveIssueType("Epic");
    const description = this.metadata.splice(
      this.bodyFormat.toAdf(input.body),
      input.metadata ?? {}
    );
    const created = await this.client.request("POST", "/issue", {
      fields: {
        project: { key: this.project },
        issuetype: { name: issuetype },
        summary: input.title,
        description,
        labels: input.labels
      }
    });
    try {
      return await this.getEpic(created.key);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: created.key, cause });
    }
  }
  async getEpic(id) {
    const issue = await this.client.request("GET", `/issue/${id}`, void 0, {
      fields: issueFields
    });
    const childIssues = await this.searchChildren(issue.key);
    return {
      id: issue.key,
      size: "epic",
      status: issue.fields.status?.name ?? "unknown",
      labels: issue.fields.labels ?? [],
      title: issue.fields.summary,
      body: this.extractBody(issue.fields.description),
      childIssues,
      comments: [],
      metadata: this.parseMetadata(issue),
      updatedAt: issue.fields.updated ?? ""
    };
  }
  async createTicket(input) {
    const issuetype = await this.resolveIssueType("Story");
    const description = this.metadata.splice(
      this.bodyFormat.toAdf(input.body),
      input.metadata ?? {}
    );
    const created = await this.client.request("POST", "/issue", {
      fields: {
        project: { key: this.project },
        issuetype: { name: issuetype },
        summary: input.title,
        description,
        labels: input.labels,
        ...input.epicId !== void 0 ? { parent: { key: input.epicId } } : {},
        ...input.assignee !== void 0 ? { assignee: { accountId: input.assignee } } : {}
      }
    });
    try {
      return await this.getTicket(created.key);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: created.key, cause });
    }
  }
  async getTicket(id) {
    const [issue, blocksLinkType] = await Promise.all([
      this.client.request("GET", `/issue/${id}`, void 0, { fields: ticketFields }),
      this.resolveBlocksLinkType()
    ]);
    return this.mapTicket(issue, blocksLinkType);
  }
  async linkTicketToEpic(ticketId, epicId) {
    const issue = await this.client.request("GET", `/issue/${ticketId}`, void 0, {
      fields: "parent"
    });
    if (issue.fields.parent?.key === epicId) return;
    await this.client.request("PUT", `/issue/${ticketId}`, { fields: { parent: { key: epicId } } });
  }
  async getTicketEpicId(ticketId) {
    const issue = await this.client.request("GET", `/issue/${ticketId}`, void 0, {
      fields: "parent"
    });
    return issue.fields.parent?.key ?? null;
  }
  async blockTicket(ticketId, blockedById) {
    if (ticketId === blockedById) throw new Error("a ticket cannot block itself");
    const blocksLinkType = await this.resolveBlocksLinkType();
    const links = await this.issueLinks(ticketId);
    const alreadyBlocked = links.some(
      (link) => link.type.name === blocksLinkType && link.inwardIssue?.key === blockedById
    );
    if (alreadyBlocked) return;
    await this.client.request("POST", "/issueLink", {
      type: { name: blocksLinkType },
      inwardIssue: { key: blockedById },
      outwardIssue: { key: ticketId }
    });
  }
  async unblockTicket(ticketId, blockedById) {
    const blocksLinkType = await this.resolveBlocksLinkType();
    const links = await this.issueLinks(ticketId);
    const link = links.find(
      (candidate) => candidate.type.name === blocksLinkType && candidate.inwardIssue?.key === blockedById
    );
    if (link?.id === void 0) return;
    await this.client.request("DELETE", `/issueLink/${link.id}`);
  }
  async transitionTicket(ticketId, status) {
    const response = await this.fetchTransitions(ticketId);
    const match = response.transitions.find(
      (transition) => transition.to.name.toLowerCase() === status.toLowerCase()
    );
    if (match === void 0) {
      const available = response.transitions.map((transition) => transition.to.name).join(", ");
      throw new Error(
        `No transition to status "${status}" is available for ${ticketId} from its current status (available: ${available})`
      );
    }
    await this.client.request("POST", `/issue/${ticketId}/transitions`, {
      transition: { id: match.id }
    });
  }
  async listTransitions(ticketId) {
    const response = await this.fetchTransitions(ticketId);
    return response.transitions.map((transition) => transition.to.name);
  }
  /**
   * Jira's `add`/`remove` label verbs are set operations, so the write is
   * atomic against whatever labels the issue already has — no read first.
   */
  async addLabel(ticketId, label) {
    await this.client.request("PUT", `/issue/${ticketId}`, {
      update: { labels: [{ add: label }] }
    });
  }
  async removeLabel(ticketId, label) {
    await this.client.request("PUT", `/issue/${ticketId}`, {
      update: { labels: [{ remove: label }] }
    });
  }
  async updateEpicMetadata(epicId, patch) {
    await this.spliceDescriptionMetadata(epicId, patch);
  }
  async updateTicketMetadata(ticketId, patch) {
    await this.spliceDescriptionMetadata(ticketId, patch);
  }
  async updateTddMetadata(tddId, patch) {
    const existing = await this.tddMetadataProperty(tddId);
    const merged = { ...existing?.value ?? {} };
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== void 0) merged[key] = value;
    });
    if (existing === void 0) {
      await this.confluence.request("POST", `/pages/${tddId}/properties`, {
        key: tddMetadataPropertyKey,
        value: merged
      });
      return;
    }
    await this.confluence.request("PUT", `/pages/${tddId}/properties/${existing.id}`, {
      key: tddMetadataPropertyKey,
      value: merged,
      version: { number: (existing.version?.number ?? 1) + 1 }
    });
  }
  async updateEpicDescription(epicId, input) {
    await this.replaceIssueBody(epicId, input);
    try {
      return await this.getEpic(epicId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: epicId, cause });
    }
  }
  async updateTicketDescription(ticketId, input) {
    await this.replaceIssueBody(ticketId, input);
    try {
      return await this.getTicket(ticketId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: ticketId, cause });
    }
  }
  async updateInitiativeDescription(initiativeId, input) {
    const fields = { description: this.bodyFormat.toAdf(input.body) };
    if (input.title !== void 0) fields["summary"] = input.title;
    await this.client.request("PUT", `/issue/${initiativeId}`, { fields });
    try {
      return await this.getInitiative(initiativeId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: initiativeId, cause });
    }
  }
  async createInitiative(input) {
    const projectKey = await this.ensureJpdProject();
    const created = await this.client.request("POST", "/issue", {
      fields: {
        project: { key: projectKey },
        issuetype: { name: ideaIssueType },
        summary: input.title,
        description: this.bodyFormat.toAdf(input.body)
      }
    });
    try {
      return await this.getInitiative(created.key);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: created.key, cause });
    }
  }
  async getInitiative(id) {
    const idea = await this.client.request("GET", `/issue/${id}`, void 0, {
      fields: "summary,description,issuelinks"
    });
    const deliveryLinkType = await this.resolveDeliveryLinkType();
    const epicKeys = this.deliveryLinkedKeys(idea.fields.issuelinks ?? [], deliveryLinkType);
    const epics = await Promise.all(
      epicKeys.map(async (key) => {
        const epic = await this.client.request("GET", `/issue/${key}`, void 0, {
          fields: "summary"
        });
        return { id: epic.key, title: epic.fields.summary };
      })
    );
    return {
      id: idea.key,
      size: "initiative",
      title: idea.fields.summary,
      body: this.extractBody(idea.fields.description),
      epics
    };
  }
  async linkEpicToInitiative(epicId, initiativeId) {
    const deliveryLinkType = await this.resolveDeliveryLinkType();
    const links = await this.issueLinks(initiativeId);
    const alreadyLinked = links.some(
      (link) => link.type.name === deliveryLinkType && (link.outwardIssue?.key === epicId || link.inwardIssue?.key === epicId)
    );
    if (alreadyLinked) return;
    await this.client.request("POST", "/issueLink", {
      type: { name: deliveryLinkType },
      outwardIssue: { key: initiativeId },
      inwardIssue: { key: epicId }
    });
  }
  async createTechnicalDesign(input) {
    const spaceId = await this.resolveConfluenceSpaceId();
    const propertyValue = { ...input.metadata, epicId: input.epicId };
    const page = await this.confluence.request("POST", "/pages", {
      spaceId,
      status: "current",
      title: input.title,
      body: {
        representation: "atlas_doc_format",
        value: JSON.stringify(this.bodyFormat.toAdf(this.withoutTitleHeading(input.body, input.title)))
      }
    });
    try {
      await this.confluence.request("POST", `/pages/${page.id}/properties`, {
        key: tddMetadataPropertyKey,
        value: propertyValue
      });
      await this.updateEpicMetadata(input.epicId, { tddId: Number(page.id) });
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: page.id, cause });
    }
    return this.mapTechnicalDesign(page, input.body, propertyValue);
  }
  async getTechnicalDesign(id) {
    const [page, property] = await Promise.all([
      this.confluence.request("GET", `/pages/${id}`, void 0, {
        "body-format": "atlas_doc_format"
      }),
      this.tddMetadataProperty(id)
    ]);
    const body = this.readAdfBody(page) ?? await this.readStorageBody(id);
    return this.mapTechnicalDesign(page, body, property?.value ?? {});
  }
  async addComment(entityId2, body) {
    const comment = await this.client.request("POST", `/issue/${entityId2}/comment`, {
      body: this.bodyFormat.toAdf(body)
    });
    return {
      id: comment.id,
      body,
      author: comment.author?.displayName ?? "",
      createdAt: comment.created,
      updatedAt: comment.updated
    };
  }
  /**
   * Uploads a file as a native Jira attachment and resolves the media UUID that
   * inline ADF media nodes address it by; Jira only reveals that UUID in the
   * redirect it issues for the attachment's content URL.
   */
  async addAttachment(ticketId, filePath) {
    const filename = basename2(filePath);
    const file = new File([readFileSync7(filePath)], filename, {
      type: this.mimeTypes.forFilename(filename)
    });
    const uploaded = JiraUploadedAttachmentsSchema.parse(
      await this.client.upload(`/issue/${ticketId}/attachments`, [file])
    );
    const attachment = uploaded[0];
    if (attachment === void 0) {
      throw new Error(
        `Jira accepted the upload of ${filename} to ${ticketId} but returned no attachment`
      );
    }
    return this.mapAttachment(attachment, await this.resolveMediaUuid(attachment.id));
  }
  async getUsers() {
    const users = await this.client.request(
      "GET",
      "/user/assignable/search",
      void 0,
      {
        project: this.project,
        maxResults: 100
      }
    );
    return users.map((user) => ({ accountId: user.accountId, displayName: user.displayName }));
  }
  async ping(options) {
    if (options?.signal === void 0) await this.client.request("GET", "/myself");
    else await this.client.request("GET", "/myself", void 0, void 0, options.signal);
  }
  async searchChildren(epicKey) {
    const [page, blocksLinkType] = await Promise.all([
      this.client.request("GET", "/search/jql", void 0, {
        jql: `parent = ${epicKey}`,
        fields: ticketFields,
        maxResults: 100
      }),
      this.resolveBlocksLinkType()
    ]);
    return page.issues.map((issue) => this.mapTicket(issue, blocksLinkType));
  }
  mapTicket(issue, blocksLinkType) {
    const { blockedBy, blocking } = this.blockingLinks(
      issue.fields.issuelinks ?? [],
      blocksLinkType
    );
    return {
      id: issue.key,
      size: "ticket",
      status: issue.fields.status?.name ?? "unknown",
      labels: issue.fields.labels ?? [],
      title: issue.fields.summary,
      body: this.extractBody(issue.fields.description),
      comments: [],
      assignee: issue.fields.assignee?.accountId ?? null,
      attachments: this.mapAttachments(issue.fields.attachment ?? []),
      reporter: issue.fields.reporter?.accountId ?? null,
      issueType: issue.fields.issuetype?.name ?? "unknown",
      blockedBy,
      blocking,
      metadata: this.parseMetadata(issue),
      updatedAt: issue.fields.updated ?? ""
    };
  }
  mapAttachment(uploaded, mediaUuid) {
    return {
      id: uploaded.id,
      filename: uploaded.filename,
      mimeType: uploaded.mimeType,
      ...uploaded.size !== void 0 ? { size: uploaded.size } : {},
      mediaUuid
    };
  }
  mapAttachments(attachments) {
    return attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename ?? "",
      mimeType: attachment.mimeType ?? "application/octet-stream",
      ...attachment.size !== void 0 ? { size: attachment.size } : {}
    }));
  }
  blockingLinks(links, blocksLinkType) {
    const blockedBy = [];
    const blocking = [];
    links.forEach((link) => {
      if (link.type.name !== blocksLinkType) return;
      if (link.inwardIssue !== void 0) blockedBy.push(link.inwardIssue.key);
      if (link.outwardIssue !== void 0) blocking.push(link.outwardIssue.key);
    });
    return { blockedBy, blocking };
  }
  async replaceIssueBody(key, input) {
    const issue = await this.client.request("GET", `/issue/${key}`, void 0, {
      fields: "description"
    });
    const description = this.metadata.splice(
      this.bodyFormat.toAdf(input.body),
      this.parseMetadata(issue)
    );
    const fields = { description };
    if (input.title !== void 0) fields["summary"] = input.title;
    if (input.labels !== void 0) fields["labels"] = input.labels;
    await this.client.request("PUT", `/issue/${key}`, { fields });
  }
  async spliceDescriptionMetadata(key, patch) {
    const issue = await this.client.request("GET", `/issue/${key}`, void 0, {
      fields: "description"
    });
    const current = issue.fields.description ?? this.bodyFormat.toAdf("");
    const next = this.metadata.splice(current, patch);
    await this.client.request("PUT", `/issue/${key}`, { fields: { description: next } });
  }
  deliveryLinkedKeys(links, deliveryLinkType) {
    const keys = [];
    links.forEach((link) => {
      if (link.type.name !== deliveryLinkType) return;
      const key = link.outwardIssue?.key ?? link.inwardIssue?.key;
      if (key !== void 0) keys.push(key);
    });
    return keys;
  }
  async ensureJpdProject() {
    if (this.jpdProject === void 0) {
      throw new Error("No JPD project is configured; set jpdProject to create or link initiatives");
    }
    if (!this.jpdProjectVerified) {
      const project = await this.client.request("GET", `/project/${this.jpdProject}`);
      if (project.projectTypeKey !== jpdProjectType) {
        throw new Error(
          `Project ${this.jpdProject} is a "${project.projectTypeKey}" project, not a ${jpdProjectType} (JPD) project`
        );
      }
      this.jpdProjectVerified = true;
    }
    return this.jpdProject;
  }
  async issueLinks(ticketId) {
    const issue = await this.client.request("GET", `/issue/${ticketId}`, void 0, {
      fields: "issuelinks"
    });
    return issue.fields.issuelinks ?? [];
  }
  async fetchTransitions(ticketId) {
    return this.client.request("GET", `/issue/${ticketId}/transitions`);
  }
  async resolveMediaUuid(attachmentId) {
    const location = await this.client.locationFor(`/attachment/content/${attachmentId}`);
    const uuid = this.extractMediaUuid(location);
    if (uuid === void 0) {
      throw new Error(
        `Jira did not redirect attachment ${attachmentId} to a media file URL, so it cannot be embedded inline (location: ${location})`
      );
    }
    return uuid;
  }
  // Extracts the media UUID only from a well-formed `/file/<uuid>/binary` pathname.
  // Parses the Location as a URL (absolute media URLs keep their origin; a relative
  // Location resolves against a base), then matches the anchored pathname — so an
  // unparseable Location or any other path yields undefined and is rejected by the caller.
  extractMediaUuid(location) {
    let pathname;
    try {
      pathname = new URL(location, mediaLocationBase).pathname;
    } catch {
      return void 0;
    }
    return mediaFilePath.exec(pathname)?.[1];
  }
  async resolveBlocksLinkType() {
    if (this.blocksLinkType === void 0) {
      const response = await this.client.request(
        "GET",
        "/issueLinkType"
      );
      const match = response.issueLinkTypes.find((type) => type.name.toLowerCase() === "blocks");
      if (match === void 0) {
        const names = response.issueLinkTypes.map((type) => type.name).join(", ");
        throw new Error(
          `No "Blocks" issue link type is configured in this Jira instance (found: ${names})`
        );
      }
      this.blocksLinkType = match.name;
    }
    return this.blocksLinkType;
  }
  async resolveDeliveryLinkType() {
    if (this.deliveryLinkType === void 0) {
      const response = await this.client.request(
        "GET",
        "/issueLinkType"
      );
      const match = response.issueLinkTypes.find(
        (type) => type.outward.toLowerCase() === deliveryLinkOutward
      );
      if (match === void 0) {
        const names = response.issueLinkTypes.map((type) => type.name).join(", ");
        throw new Error(
          `No JPD delivery link type (outward "${deliveryLinkOutward}") is available in this Jira instance (found: ${names})`
        );
      }
      this.deliveryLinkType = match.name;
    }
    return this.deliveryLinkType;
  }
  parseMetadata(issue) {
    const description = issue.fields.description;
    return description === null || description === void 0 ? {} : this.metadata.parse(description);
  }
  /** @param media filenames to uploaded media UUIDs, empty until the read path can resolve an issue's attachments. */
  extractBody(description, media = {}) {
    if (description === null || description === void 0) return "";
    return this.bodyFormat.toMarkdown(
      description.content.filter((node) => !this.isMetadataNode(node)),
      media
    );
  }
  isMetadataNode(node) {
    return node.type === "expand" && node.attrs?.["title"] === metadataExpandTitle;
  }
  async resolveIssueType(name) {
    const available = await this.availableIssueTypes();
    const match = available.find((type) => type.toLowerCase() === name.toLowerCase());
    if (match === void 0) {
      throw new Error(
        `Issue type "${name}" is not available in project ${this.project} (found: ${available.join(", ")})`
      );
    }
    return match;
  }
  async availableIssueTypes() {
    if (this.issueTypeNames === void 0) {
      const meta = await this.client.request(
        "GET",
        `/issue/createmeta/${this.project}/issuetypes`
      );
      this.issueTypeNames = meta.issueTypes.map((type) => type.name);
    }
    return this.issueTypeNames;
  }
  async resolveConfluenceSpaceId() {
    if (this.confluenceSpaceKey === void 0) {
      throw new Error(
        "No Confluence space is configured; set confluenceSpaceKey to create or fetch technical designs"
      );
    }
    if (this.confluenceSpaceId === void 0) {
      const response = await this.confluence.request(
        "GET",
        "/spaces",
        void 0,
        {
          keys: this.confluenceSpaceKey
        }
      );
      const space = response.results[0];
      if (space === void 0)
        throw new Error(`Confluence space "${this.confluenceSpaceKey}" was not found`);
      this.confluenceSpaceId = space.id;
    }
    return this.confluenceSpaceId;
  }
  async tddMetadataProperty(pageId) {
    const response = await this.confluence.request(
      "GET",
      `/pages/${pageId}/properties`
    );
    return response.results.find((property) => property.key === tddMetadataPropertyKey);
  }
  withoutTitleHeading(body, title) {
    const match = /^\s*#[ \t]+([^\n]*?)[ \t#]*(?:\r?\n|$)/.exec(body);
    if (match === null || match[1]?.trim().toLowerCase() !== title.trim().toLowerCase()) return body;
    return body.slice(match[0].length).replace(/^\s*\n/, "");
  }
  /** Converts the ADF body to markdown, or returns undefined when it is missing or unreadable. */
  readAdfBody(page) {
    const raw = page.body?.atlas_doc_format?.value;
    if (raw === void 0) return void 0;
    try {
      const doc = JSON.parse(raw);
      if (adfDocValidator(doc)) return this.bodyFormat.toMarkdown(doc.content);
    } catch {
    }
    return void 0;
  }
  /** Pages published as storage XHTML (or with an unparseable ADF body) fall back to the storage value unchanged. */
  async readStorageBody(id) {
    const page = await this.confluence.request("GET", `/pages/${id}`, void 0, {
      "body-format": "storage"
    });
    return page.body?.storage?.value ?? "";
  }
  mapTechnicalDesign(page, body, propertyValue) {
    const { epicId: rawEpicId, ...rest } = propertyValue;
    const metadata = EntityMetadataSchema.parse(rest);
    const epicId = typeof rawEpicId === "string" ? rawEpicId : rawEpicId !== void 0 ? String(rawEpicId) : "";
    const webui = page._links?.webui;
    return {
      id: String(page.id),
      epicId,
      ...webui !== void 0 ? { url: `${this.confluence.siteBaseUrl}${webui}` } : {},
      body,
      comments: [],
      metadata,
      updatedAt: page.version?.createdAt ?? ""
    };
  }
};

// src/tasks/tool-probe/tool-probe.ts
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
import { z as z24 } from "zod";

// src/tasks/readiness/probe-diagnostics.ts
import { z as z23 } from "zod";
var ProbeDiagnosticsPropsSchema = z23.object({ env: z23.record(z23.string(), z23.string().optional()) });
var ErrorFactsSchema = z23.object({
  code: z23.union([z23.string(), z23.number()]).nullable().optional(),
  status: z23.number().optional(),
  statusCode: z23.number().optional(),
  killed: z23.boolean().optional(),
  name: z23.string().optional(),
  message: z23.string().optional(),
  stderr: z23.string().optional(),
  cause: z23.unknown().optional()
});
var RedactedProbeDiagnostics = class {
  secrets;
  constructor(props) {
    const { env } = ProbeDiagnosticsPropsSchema.parse({
      ...props,
      env: props.env === void 0 ? void 0 : { ...props.env }
    });
    this.secrets = Object.entries(env).filter(
      ([key, value]) => /token|secret|password|api[_-]?key|credential/i.test(key) && Boolean(value)
    ).flatMap(([, value]) => value === void 0 ? [] : [value, encodeURIComponent(value)]).sort((a, b) => b.length - a.length);
  }
  redact(text) {
    let result = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@").replace(/\b(Bearer|Basic)\s+[^\s,'";]+/gi, "$1 [REDACTED]").replace(/([?&](?:token|access_token|api_key|key|signature)=)[^&#\s]+/gi, "$1[REDACTED]").replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]");
    for (const secret of this.secrets) result = result.replaceAll(secret, "[REDACTED]");
    return result;
  }
  failure(name, error, required, fallback = "UNKNOWN") {
    const parsed = ErrorFactsSchema.safeParse(error);
    const facts = parsed.success ? parsed.data : {};
    const cause = ErrorFactsSchema.safeParse(facts.cause);
    const code = facts.code ?? (cause.success ? cause.data.code : void 0);
    const status = facts.status ?? facts.statusCode;
    const raw = facts.stderr?.trim() || facts.message || String(error);
    let category = fallback;
    if (code === "ENOENT")
      category = name.startsWith("local:") ? "PATH_UNAVAILABLE" : "MISSING_TOOL";
    else if (facts.killed || facts.name === "TimeoutError" || code === "ETIMEDOUT" || /timed? out/i.test(raw))
      category = "TIMEOUT";
    else if (status === 401 || /HTTP 401|bad credentials|authentication failed|not logged in|could not read Username|Permission denied \(publickey\)/i.test(
      raw
    ))
      category = "AUTHENTICATION";
    else if (code === "EACCES" || code === "EPERM" || status === 403 || /HTTP 403|operation not permitted|permission denied|sandbox.*denied/i.test(raw))
      category = "PERMISSION_DENIED";
    else if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(String(code)) || status !== void 0 && status >= 500 || /connection refused|could not resolve|network is unreachable|failed to connect|fetch failed|HTTP 5\d\d/i.test(
      raw
    ))
      category = "NETWORK";
    const remedies = {
      MISSING_TOOL: "Install the missing executable and make it available on this invocation PATH.",
      PATH_UNAVAILABLE: "Resolve the intended existing filesystem path before relying on write access.",
      TIMEOUT: "Check service connectivity or a stalled credential helper, then rerun the bounded probe.",
      AUTHENTICATION: "Authenticate the relevant account through its supported login or credential setup, then rerun.",
      PERMISSION_DENIED: "Inspect the named account or host policy denial and use its normal scoped approval/setup path.",
      NETWORK: "Check DNS, routing and service availability. A connection failure alone does not establish sandbox denial.",
      UNKNOWN: "Inspect the operation and establish the missing capability before relying on it."
    };
    return {
      name,
      ok: false,
      required,
      code: category,
      detail: category === "MISSING_TOOL" ? "not installed" : this.redact(raw),
      remedy: remedies[category] ?? remedies.UNKNOWN
    };
  }
};

// src/tasks/tool-probe/tool-probe.ts
var minimumGhVersion = [2, 99, 0];
var ghVersionLine = /gh version (\d+)\.(\d+)\.(\d+)/;
var NodeToolProbePropsSchema = z24.object({ cwd: z24.string().optional(), env: z24.record(z24.string(), z24.string().optional()).optional(), timeoutMs: z24.int().positive().max(6e4).default(1e4) });
var NodeToolProbe = class {
  execFile;
  env;
  constructor(props = {}) {
    const input = NodeToolProbePropsSchema.parse({ ...props, env: props.env === void 0 ? void 0 : { ...props.env } });
    const promisified = promisify3(execFile3);
    const cwd = input.cwd ?? process.cwd();
    const env = props.env ?? process.env;
    this.env = env;
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args], { cwd, env, timeout: input.timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }));
  }
  async probe(input) {
    const diagnostics = new RedactedProbeDiagnostics({ env: this.env });
    const qaRequired = input.qaInstructionsFound;
    const ghRequired = input.githubRequired ?? input.repo !== void 0;
    const pushRequired = input.pushRequired ?? ghRequired;
    const [gh, ghAuth, ghPush, playwright, ffmpeg, curl] = await Promise.all([
      this.ghVersion(ghRequired, diagnostics),
      this.ghAuth(ghRequired, diagnostics),
      this.ghPush(input.repo, pushRequired, diagnostics),
      this.present("tools:playwright-cli", "playwright-cli", ["--version"], qaRequired, diagnostics),
      this.present("tools:ffmpeg", "ffmpeg", ["-version"], qaRequired, diagnostics),
      this.present("tools:curl", "curl", ["--version"], qaRequired, diagnostics)
    ]);
    return [gh, ghAuth, ghPush, playwright, ffmpeg, curl];
  }
  async ghVersion(required, diagnostics) {
    try {
      const { stdout } = await this.execFile("gh", ["--version"]);
      const match = ghVersionLine.exec(stdout);
      if (match === null) {
        return { name: "tools:gh", ok: false, detail: `unrecognized version output: ${diagnostics.redact(stdout.trim())}`, required, code: "UNKNOWN", remedy: "Inspect the gh executable selected by PATH and verify its version." };
      }
      const [, major, minor, patch] = match;
      const version = [Number(major), Number(minor), Number(patch)];
      const ok = this.meetsMinimumVersion(version, minimumGhVersion);
      const found = `${version[0]}.${version[1]}.${version[2]}`;
      return {
        name: "tools:gh",
        ok,
        detail: ok ? `gh ${found}` : `gh ${found} is older than the required ${minimumGhVersion.join(".")}`,
        required,
        ...ok ? {} : { code: "TOOL_VERSION", remedy: `Install gh ${minimumGhVersion.join(".")} or newer before this workflow.` }
      };
    } catch (err) {
      return { ...diagnostics.failure("tools:gh", err, required), required };
    }
  }
  async ghAuth(required, diagnostics) {
    try {
      await this.execFile("gh", ["auth", "status"]);
      return { name: "tools:gh-auth", ok: true, detail: "authenticated", required };
    } catch (err) {
      return { ...diagnostics.failure("tools:gh-auth", err, required, "AUTHENTICATION"), required };
    }
  }
  async ghPush(repo, required, diagnostics) {
    if (repo === void 0) {
      return { name: "tools:gh-push", ok: false, detail: "skipped \u2014 repo is not configured", required };
    }
    try {
      const { stdout } = await this.execFile("gh", [
        "api",
        `repos/${repo}`,
        "--jq",
        ".permissions.push"
      ]);
      const ok = stdout.trim() === "true";
      return {
        name: "tools:gh-push",
        ok,
        detail: ok ? `GitHub account has push entitlement to ${repo}; transport and branch policy are not tested` : stdout.trim() === "false" ? `no push entitlement to ${repo}` : `push entitlement to ${repo} is unverified`,
        code: ok ? "AVAILABLE" : stdout.trim() === "false" ? "PERMISSION_DENIED" : "UNKNOWN",
        ...ok ? {} : { remedy: "Verify the selected GitHub account has push entitlement to this repository; this probe does not change access." },
        required
      };
    } catch (err) {
      return { ...diagnostics.failure("tools:gh-push", err, required), required };
    }
  }
  async present(name, file, args, required, diagnostics) {
    try {
      const { stdout } = await this.execFile(file, args);
      return { name, ok: true, detail: diagnostics.redact(stdout.trim().split("\n")[0] ?? "installed"), required };
    } catch (err) {
      return { ...diagnostics.failure(name, err, required), required };
    }
  }
  /** True when `version` is at least `minimum`, comparing major, minor, then patch. */
  meetsMinimumVersion(version, minimum) {
    for (let i = 0; i < minimum.length; i++) {
      const actual = version[i] ?? 0;
      const required = minimum[i] ?? 0;
      if (actual !== required) return actual > required;
    }
    return true;
  }
};
var nodeToolProbe = new NodeToolProbe();

// src/tasks/readiness/repository-readiness.ts
import { z as z30 } from "zod";

// src/tasks/readiness/workflow-preflight.ts
import { execFile as execFile4 } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve as resolve4 } from "node:path";
import { promisify as promisify4 } from "node:util";
import { z as z29 } from "zod";

// src/orchestration/orchestration-policy.ts
import { isDeepStrictEqual } from "node:util";
import { z as z27 } from "zod";

// src/agents/agent-emitter/agent-emitter.schema.ts
import { z as z25 } from "zod";
var ModelBindingsSchema = z25.strictObject({
  standard: z25.string().trim().min(1),
  escalated: z25.string().trim().min(1),
  expert: z25.string().trim().min(1)
});
var AgentDefinitionSchema = z25.strictObject({
  frontmatter: AgentRegistrationSchema,
  body: z25.string().refine((body) => body.trim() !== "", "agent prompt must not be empty")
});

// src/orchestration/orchestration.schema.ts
import { isAbsolute as isAbsolute2, relative, sep as sep2 } from "node:path";
import { z as z26 } from "zod";
var OrchestrationTextSchema = z26.string().refine((value) => value.trim().length > 0, "must not be blank");
var AbsolutePathSchema = OrchestrationTextSchema.refine(
  isAbsolute2,
  "must be an absolute path on this host"
);
var CapabilityNameSchema = z26.string().regex(/^[a-z][a-zA-Z0-9:.-]*$/);
var RunContextObjectSchema = z26.strictObject({
  runId: OrchestrationTextSchema,
  taskId: OrchestrationTextSchema,
  cwd: AbsolutePathSchema,
  repositoryRoot: AbsolutePathSchema,
  baseRef: OrchestrationTextSchema,
  skill: OrchestrationTextSchema
});
var RunContextSchema = RunContextObjectSchema.refine((value) => {
  const path = relative(value.repositoryRoot, value.cwd);
  return path !== ".." && !path.startsWith(`..${sep2}`) && !isAbsolute2(path);
}, "working directory must be inside the active repository root");
var CallerContextSchema = RunContextSchema.safeExtend({ attempt: z26.int().positive() });
var CapabilityEvidenceSchema = z26.discriminatedUnion("state", [
  z26.strictObject({ state: z26.literal("available"), evidence: OrchestrationTextSchema }),
  z26.strictObject({
    state: z26.enum(["denied", "unknown"]),
    evidence: OrchestrationTextSchema,
    remedy: OrchestrationTextSchema
  })
]);
var AdapterLimitsSchema = z26.strictObject({
  maxConcurrent: z26.int().nonnegative().nullable(),
  activeWorkers: z26.int().nonnegative(),
  currentDepth: z26.int().nonnegative(),
  maxDepth: z26.int().nonnegative().nullable(),
  source: OrchestrationTextSchema
});
var RuntimeSnapshotSchema = z26.strictObject({
  context: CallerContextSchema,
  host: z26.strictObject({ name: OrchestrationTextSchema, version: OrchestrationTextSchema }),
  observedAt: z26.iso.datetime(),
  agent: AgentFrontmatterSchema.shape.name.nullable(),
  spawn: CapabilityEvidenceSchema,
  ask: CapabilityEvidenceSchema,
  permissions: z26.record(CapabilityNameSchema, CapabilityEvidenceSchema),
  limits: AdapterLimitsSchema
});
var DispatchRequestSchema = z26.strictObject({
  id: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema,
  input: z26.record(z26.string(), z26.json()),
  requiredCapabilities: z26.array(CapabilityNameSchema).optional()
});
var OrchestrationFailureSchema = z26.strictObject({
  code: z26.enum([
    "UNKNOWN_AGENT",
    "UNSUPPORTED_AGENT_SETTINGS",
    "CONTEXT_MISMATCH",
    "CAPABILITY_DENIED",
    "CAPABILITY_UNKNOWN",
    "DISPATCH_UNAVAILABLE",
    "LIMITS_UNKNOWN",
    "CAPACITY_EXHAUSTED",
    "DEPTH_EXCEEDED",
    "QUESTIONS_DISABLED",
    "QUESTIONS_UNAVAILABLE",
    "INVALID_HANDOFF",
    "INVALID_REPORT",
    "INVALID_HISTORY",
    "OPEN_QUESTIONS",
    "UNVERIFIABLE",
    "ATTEMPTS_EXHAUSTED",
    "EXECUTION_FAILED",
    "CANCELLED"
  ]),
  message: OrchestrationTextSchema,
  remedy: OrchestrationTextSchema,
  capability: CapabilityNameSchema.optional()
});
var OutcomeIdentitySchema = z26.strictObject({
  dispatchId: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema
});
var DispatchOutcomeSchema = z26.discriminatedUnion("status", [
  OutcomeIdentitySchema.extend({
    status: z26.literal("completed"),
    report: z26.record(z26.string(), z26.json())
  }),
  OutcomeIdentitySchema.extend({
    status: z26.enum(["failed", "unavailable"]),
    failure: OrchestrationFailureSchema
  })
]);
var QuestionRequestSchema = z26.strictObject({
  context: CallerContextSchema,
  question: OrchestrationTextSchema,
  allowHumanQuestions: z26.boolean()
});
var SiblingSkillRequestSchema = z26.strictObject({
  context: CallerContextSchema,
  skill: OrchestrationTextSchema,
  input: z26.record(z26.string(), z26.json())
});

// src/orchestration/orchestration-policy.ts
var RegistryOrchestrationPolicyPropsSchema = z27.strictObject({
  agents: z27.array(AgentDefinitionSchema).min(1).refine(
    (agents) => new Set(agents.map((agent) => agent.frontmatter.name)).size === agents.length,
    "duplicate agent name"
  )
});
var RegistryOrchestrationPolicy = class {
  agents;
  constructor(props) {
    this.agents = new Map(
      RegistryOrchestrationPolicyPropsSchema.parse(props).agents.map((agent) => [
        agent.frontmatter.name,
        agent
      ])
    );
  }
  prepare(request, runtime) {
    const input = DispatchRequestSchema.parse(request);
    const snapshot = RuntimeSnapshotSchema.parse(runtime);
    const definition = this.agents.get(input.agent);
    if (definition === void 0) {
      return {
        status: "unavailable",
        failure: {
          code: "UNKNOWN_AGENT",
          message: `No registered agent named ${input.agent}.`,
          remedy: "Install or load the named registration before dispatch."
        }
      };
    }
    if (!isDeepStrictEqual(input.context, snapshot.context) || snapshot.agent !== input.agent) {
      return {
        status: "unavailable",
        failure: {
          code: "CONTEXT_MISMATCH",
          message: "Runtime evidence belongs to another context or worker.",
          remedy: "Observe effective access for this named worker in this task, checkout and attempt."
        }
      };
    }
    if (definition.frontmatter.sandbox !== void 0 || definition.frontmatter.dispatch !== void 0) {
      return {
        status: "unavailable",
        failure: {
          code: "UNSUPPORTED_AGENT_SETTINGS",
          message: "Explicit worker sandbox or dispatch restrictions need an enforcing runtime binding.",
          remedy: "Provide an adapter that can enforce the declared restrictions before dispatch; do not drop them."
        }
      };
    }
    if (snapshot.spawn.state !== "available") {
      return {
        status: "unavailable",
        failure: {
          code: "DISPATCH_UNAVAILABLE",
          capability: "spawn",
          message: snapshot.spawn.evidence,
          remedy: snapshot.spawn.remedy
        }
      };
    }
    const { maxConcurrent, activeWorkers, currentDepth, maxDepth } = snapshot.limits;
    if (maxConcurrent === null || maxDepth === null) {
      return {
        status: "unavailable",
        failure: {
          code: "LIMITS_UNKNOWN",
          message: "Concurrency or nesting capacity has not been established.",
          remedy: "Read the host limits or provide a documented conservative adapter bound with its provenance."
        }
      };
    }
    if (currentDepth >= maxDepth) {
      return {
        status: "unavailable",
        failure: {
          code: "DEPTH_EXCEEDED",
          message: `A child at depth ${currentDepth + 1} exceeds the bound ${maxDepth}.`,
          remedy: "Invoke orchestration in a supported caller context with remaining worker depth."
        }
      };
    }
    if (activeWorkers >= maxConcurrent) {
      return {
        status: "unavailable",
        failure: {
          code: "CAPACITY_EXHAUSTED",
          message: `All ${maxConcurrent} worker slots are occupied or disabled.`,
          remedy: "Wait for a worker to finish, refresh current usage, then plan the remaining work."
        }
      };
    }
    const required = /* @__PURE__ */ new Set([
      ...definition.frontmatter.capabilities,
      ...input.requiredCapabilities ?? []
    ]);
    for (const capability of required) {
      const permission = snapshot.permissions[capability];
      if (permission === void 0 || permission.state !== "available") {
        return {
          status: "unavailable",
          failure: {
            code: permission?.state === "denied" ? "CAPABILITY_DENIED" : "CAPABILITY_UNKNOWN",
            capability,
            message: permission?.evidence ?? `No effective worker access evidence for ${capability}.`,
            remedy: permission?.remedy ?? `Establish ${capability} access for this worker and working directory before dispatch.`
          }
        };
      }
    }
    return { status: "ready", request: input, definition: AgentDefinitionSchema.parse(definition) };
  }
  ask(request, runtime) {
    const input = QuestionRequestSchema.parse(request);
    const snapshot = RuntimeSnapshotSchema.parse(runtime);
    if (!isDeepStrictEqual(input.context, snapshot.context)) {
      return {
        status: "unavailable",
        failure: {
          code: "CONTEXT_MISMATCH",
          message: "Question capability evidence belongs to another caller context.",
          remedy: "Refresh capability evidence for this caller before asking."
        }
      };
    }
    if (!input.allowHumanQuestions) {
      return {
        status: "unavailable",
        failure: {
          code: "QUESTIONS_DISABLED",
          capability: "ask",
          message: "This invocation is unattended or has not opted into human questions.",
          remedy: "Return the unresolved question to the caller as a named failure; do not prompt."
        }
      };
    }
    if (snapshot.ask.state !== "available") {
      return {
        status: "unavailable",
        failure: {
          code: "QUESTIONS_UNAVAILABLE",
          capability: "ask",
          message: snapshot.ask.evidence,
          remedy: snapshot.ask.remedy
        }
      };
    }
    return { status: "awaiting-answer", request: input };
  }
  sibling(request) {
    return SiblingSkillRequestSchema.parse(request);
  }
};

// src/tasks/readiness/readiness.schema.ts
import { z as z28 } from "zod";
var WorkflowSchema = z28.enum([
  "execute-work",
  "execute-wave",
  "break-down-work",
  "reproduce-bug",
  "verify-ticket",
  "remediate-review"
]);
var WorkflowEvidenceSchema = z28.strictObject({
  context: CallerContextSchema,
  callerCapabilities: z28.record(z28.string(), CapabilityEvidenceSchema),
  workers: z28.array(
    z28.strictObject({ registration: AgentRegistrationSchema, runtime: RuntimeSnapshotSchema })
  ).refine(
    (workers) => new Set(workers.map((worker) => worker.registration.name)).size === workers.length,
    "duplicate worker evidence"
  )
});
var ReadinessOptionsSchema = z28.strictObject({
  workflow: WorkflowSchema.optional(),
  /** Supplying evidence opts into host checks in addition to environment probes. */
  evidence: WorkflowEvidenceSchema.optional()
}).refine(
  (value) => value.evidence === void 0 || value.workflow !== void 0,
  "workflow is required with capability evidence"
);

// src/tasks/readiness/workflow-preflight.ts
var WorkflowPreflightPropsSchema = z29.object({
  cwd: z29.string(),
  env: z29.record(z29.string(), z29.string().optional()),
  timeoutMs: z29.int().positive().max(6e4).default(1e4)
});
var NodeWorkflowPreflight = class {
  cwd;
  env;
  timeoutMs;
  constructor(props) {
    const input = WorkflowPreflightPropsSchema.parse({
      ...props,
      env: props.env === void 0 ? void 0 : { ...props.env }
    });
    this.cwd = input.cwd;
    this.env = props.env;
    this.timeoutMs = input.timeoutMs;
  }
  async inspect(workflow, evidence) {
    const selected = WorkflowSchema.parse(workflow);
    const parsed = evidence === void 0 ? void 0 : WorkflowEvidenceSchema.parse(evidence);
    const diagnostics = new RedactedProbeDiagnostics({ env: this.env });
    const codeWorkflow = selected === "execute-work" || selected === "execute-wave";
    const checks = parsed === void 0 ? [] : this.hostChecks(selected, parsed, diagnostics);
    if (codeWorkflow) {
      checks.push(await this.checkoutContext(parsed, diagnostics));
      checks.push(await this.remoteRead(diagnostics));
      checks.push(await this.localWrite("local:workspace-write", this.cwd, diagnostics));
      checks.push(await this.gitWrite(diagnostics));
    }
    return checks;
  }
  hostChecks(selected, parsed, diagnostics) {
    const codeWorkflow = selected === "execute-work" || selected === "execute-wave";
    const requiredAgents = codeWorkflow ? ["code-implementation", "code-implementation-escalated", "code-verifier", "tech-writer"] : selected === "remediate-review" ? [] : selected === "break-down-work" ? ["research-agent"] : [selected === "reproduce-bug" ? "qa-engineer" : "qa-engineer-verify"];
    const checks = [];
    const contextMatches = resolve4(parsed.context.cwd) === resolve4(this.cwd);
    checks.push({
      name: "host:context",
      ok: contextMatches,
      required: true,
      code: contextMatches ? "AVAILABLE" : "CONTEXT_MISMATCH",
      detail: contextMatches ? "Caller context matches this working directory" : "Missing or mismatched caller context",
      remedy: "Supply current host observations for this task and active checkout, then rerun the workflow check."
    });
    const required = [
      "shell",
      "network",
      "tracker.write",
      ...codeWorkflow ? ["edit", "git.write", "git.push"] : [],
      ...["reproduce-bug", "verify-ticket"].includes(selected) ? ["evidence.write"] : []
    ];
    for (const capability of required) {
      const observed = contextMatches ? parsed.callerCapabilities[capability] : void 0;
      checks.push({
        name: `host:${capability}`,
        ok: observed?.state === "available",
        required: true,
        code: observed?.state === "available" ? "AVAILABLE" : observed?.state === "denied" ? "CAPABILITY_DENIED" : "CAPABILITY_UNKNOWN",
        detail: diagnostics.redact(
          observed?.evidence ?? `No effective caller evidence for ${capability}`
        ),
        remedy: observed?.state === "available" ? void 0 : diagnostics.redact(
          observed?.remedy ?? `Establish ${capability} through the host's scoped setup/approval path before mutations.`
        )
      });
    }
    const policy = parsed.workers.length ? new RegistryOrchestrationPolicy({
      agents: parsed.workers.map((worker) => ({
        frontmatter: worker.registration,
        body: "Preflight registration requirements; this check does not dispatch."
      }))
    }) : void 0;
    for (const agent of requiredAgents) {
      const worker = contextMatches ? parsed.workers.find((item) => item.registration.name === agent) : void 0;
      if (worker === void 0 || policy === void 0) {
        checks.push({
          name: `dispatch:${agent}`,
          ok: false,
          required: true,
          code: "CAPABILITY_UNKNOWN",
          detail: `No scoped runtime evidence for ${agent}`,
          remedy: "Discover the installed registration and observe its effective permissions, dispatch support and limits."
        });
        continue;
      }
      const decision = policy.prepare(
        { id: `preflight:${agent}`, agent, context: parsed.context, input: {} },
        worker.runtime
      );
      checks.push(
        decision.status === "ready" ? {
          name: `dispatch:${agent}`,
          ok: true,
          required: true,
          code: "AVAILABLE",
          detail: "Reported worker access, dispatch capacity and depth satisfy this registration; no worker was launched"
        } : {
          name: `dispatch:${agent}`,
          ok: false,
          required: true,
          code: decision.failure.code,
          detail: diagnostics.redact(decision.failure.message),
          remedy: diagnostics.redact(decision.failure.remedy)
        }
      );
    }
    return checks;
  }
  async command(args) {
    const run2 = promisify4(execFile4);
    const { stdout } = await run2("git", args, {
      cwd: this.cwd,
      env: { ...this.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
      timeout: this.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  }
  async remoteRead(diagnostics) {
    try {
      await this.command(["ls-remote", "origin"]);
      return {
        name: "git:remote-read",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail: "Read origin refs successfully; this does not test push transport or branch policy"
      };
    } catch (error) {
      return diagnostics.failure("git:remote-read", error, true);
    }
  }
  async checkoutContext(evidence, diagnostics) {
    try {
      const root = await this.command(["rev-parse", "--show-toplevel"]);
      if (evidence !== void 0 && await realpath(root) !== await realpath(evidence.context.repositoryRoot)) {
        return {
          name: "git:context",
          ok: false,
          required: true,
          code: "CONTEXT_MISMATCH",
          detail: "Runtime evidence names another repository root",
          remedy: "Use the active worktree root in caller and worker context."
        };
      }
      await this.command([
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${evidence?.context.baseRef ?? "HEAD"}^{commit}`
      ]);
      return {
        name: "git:context",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail: evidence === void 0 ? "Active checkout found and HEAD resolves to a commit" : "Active checkout matches and the fixed base resolves to a commit"
      };
    } catch (error) {
      return diagnostics.failure("git:context", error, true);
    }
  }
  async localWrite(name, path, diagnostics) {
    try {
      await access(path, constants.W_OK);
      return {
        name,
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail: "Filesystem access check permits directory writes; no file was created; the harness enforces access when operations run"
      };
    } catch (error) {
      return diagnostics.failure(name, error, true);
    }
  }
  async gitWrite(diagnostics) {
    try {
      const paths = await this.command(["rev-parse", "--git-dir", "--git-common-dir"]);
      const directories = paths.split("\n").map((path) => resolve4(this.cwd, path));
      if (directories.length !== 2) {
        return {
          name: "local:git-write",
          ok: false,
          required: true,
          code: "UNKNOWN",
          detail: "Could not resolve Git metadata directories",
          remedy: "Inspect the active repository/worktree metadata before branching or committing."
        };
      }
      await Promise.all(directories.map((directory) => access(directory, constants.W_OK)));
      return {
        name: "local:git-write",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail: "Git and common metadata directories pass filesystem write-access checks; no git mutation was attempted"
      };
    } catch (error) {
      return diagnostics.failure("local:git-write", error, true);
    }
  }
};

// src/tasks/readiness/repository-readiness.ts
var RepositoryReadinessPropsSchema = z30.object({
  cwd: z30.string().optional(),
  env: z30.record(z30.string(), z30.string().optional()).optional(),
  timeoutMs: z30.int().positive().max(6e4).default(1e4)
});
var NodeRepositoryReadiness = class {
  cwd;
  env;
  timeoutMs;
  constructor(props = {}) {
    const input = RepositoryReadinessPropsSchema.parse({
      ...props,
      env: props.env === void 0 ? void 0 : { ...props.env }
    });
    this.cwd = input.cwd ?? process.cwd();
    this.env = props.env ?? process.env;
    this.timeoutMs = input.timeoutMs;
  }
  async inspect(input) {
    const parsed = ReadinessOptionsSchema.safeParse(input.options ?? {});
    if (!parsed.success)
      return {
        tracker: null,
        repo: null,
        checks: [
          {
            name: "runtime",
            ok: false,
            required: true,
            code: "INVALID_CONTEXT",
            detail: "Workflow or runtime evidence does not match the readiness schema",
            remedy: "Select a supported workflow. If supplying optional programmatic evidence, it must match WorkflowEvidenceSchema."
          }
        ],
        ok: false,
        scope: "workflow"
      };
    const options = parsed.data;
    const scope = options.workflow === void 0 ? "environment" : "workflow";
    const diagnostics = new RedactedProbeDiagnostics({ env: this.env });
    const checks = [];
    let config;
    try {
      config = input.config();
    } catch (error) {
      checks.push(diagnostics.failure("config", error, true, "CONFIGURATION"));
      return {
        tracker: null,
        repo: null,
        checks,
        ok: false,
        scope,
        ...options.workflow === void 0 ? {} : { workflow: options.workflow }
      };
    }
    checks.push({
      name: "config",
      ok: true,
      detail: `tracker=${config.tracker} repo=${config.repo}`
    });
    let missing;
    try {
      missing = this.missingCredentials(config);
    } catch (error) {
      checks.push(diagnostics.failure("credentials", error, true, "CONFIGURATION"));
      return {
        tracker: config.tracker,
        repo: config.repo,
        checks,
        ok: false,
        scope,
        ...options.workflow === void 0 ? {} : { workflow: options.workflow }
      };
    }
    checks.push({
      name: "credentials",
      ok: missing.length === 0,
      detail: missing.length === 0 ? "present" : `not set: ${missing.join(", ")}`,
      ...missing.length ? { code: "AUTHENTICATION" } : {}
    });
    if (missing.length === 0) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(
          new DOMException("Tracker reachability probe timed out", "TimeoutError")
        ),
        this.timeoutMs
      );
      try {
        await Promise.race([
          input.tracker().ping({ signal: controller.signal }),
          new Promise(
            (_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
              once: true
            })
          )
        ]);
        checks.push({
          name: "reachable",
          ok: true,
          detail: `${config.repo ?? config.jiraProject} responded; write operations were not tested`
        });
      } catch (error) {
        checks.push(diagnostics.failure("reachable", error, true));
      } finally {
        clearTimeout(timer);
      }
    } else
      checks.push({
        name: "reachable",
        ok: false,
        detail: "skipped \u2014 credentials missing",
        code: "AUTHENTICATION"
      });
    const qaWorkflow = options.workflow === "reproduce-bug" || options.workflow === "verify-ticket";
    let qa = { found: false, sources: [] };
    try {
      qa = input.finder.discover({
        from: this.cwd,
        legacyRecipePath: getQaRecipePath(config, input.configPath())
      });
      const [nearest] = qa.sources;
      checks.push({
        name: "qa-instructions",
        ok: qa.found,
        required: qaWorkflow,
        detail: nearest === void 0 ? "none found \u2014 add a QA.md or a QA section in AGENTS.md to enable the QA lane" : [nearest.path, ...qa.sources.slice(1).map((source) => source.path)].join(", ") + (nearest.legacy === true ? " (legacy recipe \u2014 migrate to QA.md)" : "")
      });
    } catch (error) {
      checks.push(diagnostics.failure("qa-instructions", error, qaWorkflow));
    }
    const codeWorkflow = options.workflow === "execute-work" || options.workflow === "execute-wave";
    checks.push(
      ...await input.probe.probe({
        repo: config.repo,
        qaInstructionsFound: options.workflow === "break-down-work" || options.workflow === "remediate-review" ? false : qa.found || qaWorkflow,
        ...options.workflow === void 0 ? {} : {
          githubRequired: codeWorkflow || options.workflow === "remediate-review" || config.tracker === "github",
          pushRequired: codeWorkflow
        }
      })
    );
    if (codeWorkflow && config.repo === void 0)
      checks.push({
        name: "pr:repo",
        ok: false,
        required: true,
        code: "CONFIGURATION",
        detail: "A GitHub owner/repo is required to open the PR",
        remedy: "Resolve and store the intended repository before starting work."
      });
    if (options.workflow !== void 0)
      checks.push(
        ...await new NodeWorkflowPreflight({
          cwd: this.cwd,
          env: this.env,
          timeoutMs: this.timeoutMs
        }).inspect(options.workflow, options.evidence)
      );
    const redacted = checks.map((check) => ({
      ...check,
      detail: diagnostics.redact(check.detail),
      ...check.remedy === void 0 ? {} : { remedy: diagnostics.redact(check.remedy) }
    }));
    return {
      tracker: config.tracker,
      repo: config.repo,
      checks: redacted,
      ok: redacted.every((check) => check.ok || check.required === false),
      scope,
      ...options.workflow === void 0 ? {} : { workflow: options.workflow }
    };
  }
  missingCredentials(config) {
    const env = new EnvLoader().load(this.env);
    if (config.tracker === "github") return env.githubToken?.trim() ? [] : ["GITHUB_TOKEN"];
    return [
      ...env.jiraToken?.trim() ? [] : ["JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY)"],
      ...(env.jiraEmail ?? config.jiraEmail)?.trim() ? [] : ["JIRA_EMAIL (or jiraEmail in the config)"]
    ];
  }
};

// src/flight-rules/flight-rules.schema.ts
import { z as z33 } from "zod";

// src/operations/git-config-operations.ts
import { existsSync as existsSync7, lstatSync as lstatSync2, realpathSync as realpathSync3 } from "node:fs";
import { dirname as dirname10, isAbsolute as isAbsolute3, join as join9, parse, relative as relative2, resolve as resolve5, sep as sep3 } from "node:path";
import { z as z32 } from "zod";

// src/git/commit-message-builder/commit-message-builder.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { dirname as dirname9, join as join8 } from "node:path";

// src/shared/attribution-stripper/attribution-stripper.ts
var trailerText = String.raw`(?:Co-Authored-By:[^\n"']*(?:Claude|anthropic\.com)[^\n"']*|Claude-Session:[^\n"']*|https://claude\.ai/code/session_[A-Za-z0-9_-]+)`;
var lineEnd = String.raw`(?=["']?[ \t]*(?:\r?\n|$))`;
var closingBlock = new RegExp(
  String.raw`(?:\r?\n[ \t]*)+${trailerText}(?:\r?\n[ \t]*${trailerText})*(?=["'](?:\s|$)|$)`,
  "gi"
);
var attributionLine = new RegExp(String.raw`(?:^|\r?\n)[ \t]*${trailerText}${lineEnd}`, "gi");
var messageCommand = /(^|[\s;&|(])(?:git\b[^\n;&|]*\bcommit\b|gh\s+pr\s+(?:create|edit)\b|flight-rules\s+(?:git\s+commit|pr\s+create)\b)/;
var AttributionStripper = class {
  strip(text) {
    const stripped = text.replace(closingBlock, "").replace(attributionLine, "");
    if (stripped === text) return text;
    return stripped.replace(/\n{3,}/g, "\n\n");
  }
  /** The command with attribution removed, or undefined when it writes no message or carries none. */
  stripCommand(command) {
    if (!messageCommand.test(command)) return void 0;
    const stripped = this.strip(command);
    return stripped === command ? void 0 : stripped;
  }
  /** True when a single trailer line, such as one `--footer` value, is Claude attribution. */
  isAttribution(line) {
    return this.strip(`
${line.trim()}`) === "";
  }
};

// src/git/commit-message-builder/commit-message.schema.ts
import { z as z31 } from "zod";
var CommitMessageInputSchema = z31.object({
  type: SemanticTypeSchema,
  // Bare issue numbers make one-character scopes legitimate; 32 clears a 10-character tracker key plus a six-digit number.
  scope: z31.string().min(1).max(32),
  description: z31.string().min(2).max(50),
  body: z31.string().optional(),
  model: z31.string().max(72).optional(),
  footers: z31.array(z31.string().regex(/^[a-zA-Z0-9-]+(: |=).*$/)).default([])
});
var CommitMessageHeaderSchema = z31.preprocess(
  (arg) => {
    return z31.string({ error: "Git Commit headers should be 72 characters or less" }).max(72).parse(arg);
  },
  z31.templateLiteral([SemanticTypeSchema, "(", z31.string(), "): ", z31.string()])
);
var CommitMessageBuilderPropsSchema = z31.object({
  binPath: z31.string().min(1),
  agentEnv: z31.string().optional()
});

// src/git/commit-message-builder/commit-message-builder.ts
var DefaultCommitMessageBuilder = class _DefaultCommitMessageBuilder {
  pluginVersion;
  harnessVersion;
  stripper = new AttributionStripper();
  constructor(props) {
    const parsed = CommitMessageBuilderPropsSchema.parse(props);
    this.pluginVersion = _DefaultCommitMessageBuilder.readPluginVersion(parsed.binPath);
    this.harnessVersion = _DefaultCommitMessageBuilder.parseHarnessVersion(parsed.agentEnv);
  }
  build(input) {
    const sections = [];
    const headerValidation = CommitMessageHeaderSchema.safeParse(
      `${input.type}(${input.scope}): ${input.description}`
    );
    if (!headerValidation.success) throw headerValidation.error;
    sections.push(`${headerValidation.data}
`);
    const body = input.body === void 0 ? void 0 : this.stripper.strip(input.body).trim();
    if (body !== void 0 && body !== "") {
      sections.push(`${body}
`);
    }
    const trailers = [];
    if (input.footers) trailers.push(...input.footers.filter((footer) => !this.stripper.isAttribution(footer)));
    trailers.push(
      `Flight-Rules-Version: ${this.pluginVersion}`,
      ...this.harnessVersion !== void 0 ? [`Harness-Version: ${this.harnessVersion}`] : [],
      ...input.model !== void 0 ? [`Model-Used: ${input.model}`] : []
    );
    sections.push(trailers.join("\n"));
    return sections.join("\n");
  }
  static readPluginVersion(binPath) {
    try {
      const pkgPath = join8(dirname9(binPath), "..", "package.json");
      const parsed = JSON.parse(readFileSync8(pkgPath, "utf-8"));
      if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
        return parsed.version;
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }
  static parseHarnessVersion(agentEnv) {
    if (!agentEnv) return void 0;
    const match = /^(.+)_(\d+-\d+-\d+)_agent$/.exec(agentEnv);
    if (match?.[1] === void 0 || match?.[2] === void 0) return void 0;
    return `${match[1]}@${match[2].replace(/-/g, ".")}`;
  }
};

// src/operations/git-config-operations.ts
var ConfigScopeSchema = z32.enum(configScopes);
var ConfigSetInputSchema = z32.object({
  key: z32.string().min(1),
  values: z32.array(z32.string()).min(1),
  scope: ConfigScopeSchema.optional()
}).strict();
var ConfigUnsetInputSchema = z32.object({ key: z32.string().min(1), scope: ConfigScopeSchema.optional() }).strict();
var GitCommitInputSchema = CommitMessageInputSchema.extend({
  files: z32.array(z32.string()).default([])
}).strict();
var GitCheckoutInputSchema = z32.object({
  type: z32.string().min(1),
  scope: z32.string().min(1),
  description: z32.string().optional(),
  from: z32.string().optional()
}).strict();
var GitPushInputSchema = z32.object({ remote: z32.string().min(1).default("origin"), setUpstream: z32.boolean().default(true) }).strict();
var CommitMessageOutputSchema = z32.object({ message: z32.string() });
var BranchNameInputSchema = z32.object({ type: z32.string().min(1), scope: z32.string().min(1), description: z32.string().optional() }).strict();
var ConfigOperationPolicySchema = z32.object({
  scopes: z32.array(ConfigScopeSchema).default(["project", "local"]),
  roots: z32.array(z32.string().min(1)).default([])
}).strict();
var GitConfigOperationsPropsSchema = z32.object({
  cwd: z32.string().min(1),
  configStore: z32.custom((value) => typeof value === "object" && value !== null),
  git: z32.custom((value) => typeof value === "object" && value !== null),
  configPolicy: ConfigOperationPolicySchema.default({ scopes: ["project", "local"], roots: [] }),
  binPath: z32.string().default(process.argv[1] ?? ""),
  agentEnv: z32.string().optional()
});
var LaunchConfigOperationDeniedError = class extends Error {
  name = "LaunchConfigOperationDeniedError";
};
var DefaultGitConfigOperations = class {
  props;
  allowedScopes;
  allowedRoots;
  constructor(props) {
    this.props = GitConfigOperationsPropsSchema.parse(props);
    this.allowedScopes = new Set(this.props.configPolicy.scopes);
    const roots = this.props.configPolicy.roots.length === 0 ? [this.props.cwd] : this.props.configPolicy.roots;
    this.allowedRoots = [...new Set(roots.map((root) => realpathSync3(root)))];
  }
  operations() {
    return [
      this.descriptor(
        "config-set",
        "Set a value in an allowed configuration scope.",
        ["write", "process"],
        ["config", "set"],
        ConfigSetInputSchema,
        z32.object({
          key: z32.string(),
          scope: ConfigScopeSchema,
          path: z32.string(),
          warning: z32.string().optional()
        }),
        (input) => this.setConfig(input)
      ),
      this.descriptor(
        "config-unset",
        "Remove a value from an allowed configuration scope.",
        ["write", "process"],
        ["config", "unset"],
        ConfigUnsetInputSchema,
        z32.object({ key: z32.string(), scope: ConfigScopeSchema, path: z32.string() }),
        (input) => this.unsetConfig(input)
      ),
      this.descriptor(
        "git-commit",
        "Create a conventional commit in the launch checkout.",
        ["write", "process"],
        ["git", "commit"],
        GitCommitInputSchema,
        z32.object({ sha: z32.string(), message: z32.string() }),
        (input) => this.commit(input)
      ),
      this.descriptor(
        "git-checkout",
        "Start a conventional branch in the launch checkout.",
        ["write", "process"],
        ["git", "checkout"],
        GitCheckoutInputSchema,
        z32.object({
          branch: z32.string(),
          from: z32.string().nullable(),
          renamedFrom: z32.string().nullable()
        }),
        (input) => this.checkout(input)
      ),
      this.descriptor(
        "git-push",
        "Push the current branch from the launch checkout.",
        ["write", "network", "process"],
        ["git", "push"],
        GitPushInputSchema,
        z32.object({ branch: z32.string(), remote: z32.string(), setUpstream: z32.boolean() }),
        (input) => this.push(input)
      ),
      this.descriptor(
        "commit-message",
        "Build the conventional commit message without writing a file.",
        ["read", "process"],
        ["commit-message"],
        CommitMessageInputSchema,
        CommitMessageOutputSchema,
        (input) => ({ message: this.message(input) })
      ),
      this.descriptor(
        "branch-name",
        "Build the conventional branch name without changing git state.",
        ["read", "process"],
        ["branch-name"],
        BranchNameInputSchema,
        z32.object({ branch: z32.string() }),
        (input) => ({
          branch: branchNamer.name({
            type: input.type,
            scope: input.scope,
            ...input.description === void 0 ? {} : { description: input.description }
          })
        })
      )
    ];
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler
    };
  }
  setConfig(input) {
    const scope = input.scope ?? this.props.configStore.defaultScopeFor(input.key);
    const path = this.authorizeConfigWrite(scope);
    this.props.configStore.set(input.key, input.values, scope);
    const shadowedBy = this.props.configStore.shadowingScope(input.key, scope);
    return {
      key: input.key,
      scope,
      path,
      ...shadowedBy === void 0 ? {} : {
        warning: `${input.key} is also set in ${shadowedBy} scope (${this.props.configStore.pathFor(shadowedBy)}), which takes precedence`
      }
    };
  }
  unsetConfig(input) {
    const scope = input.scope ?? this.props.configStore.defaultScopeFor(input.key);
    const path = this.authorizeConfigWrite(scope);
    this.props.configStore.unset(input.key, scope);
    return { key: input.key, scope, path };
  }
  authorizeConfigWrite(scope) {
    if (!this.allowedScopes.has(scope))
      throw new LaunchConfigOperationDeniedError(
        `Configuration scope "${scope}" is not allowed by launch policy`
      );
    const path = this.props.configStore.pathFor(scope);
    const absolutePath = isAbsolute3(path) ? path : resolve5(this.props.cwd, path);
    this.rejectDanglingSymlinks(absolutePath);
    let existingPath = existsSync7(absolutePath) ? absolutePath : dirname10(absolutePath);
    while (!existsSync7(existingPath)) {
      const parent = dirname10(existingPath);
      if (parent === existingPath)
        throw new LaunchConfigOperationDeniedError(
          `Configuration path has no existing parent: ${path}`
        );
      existingPath = parent;
    }
    const resolvedExistingPath = realpathSync3(existingPath);
    const target = existsSync7(absolutePath) ? resolvedExistingPath : resolve5(resolvedExistingPath, relative2(existingPath, absolutePath));
    if (!this.allowedRoots.some((root) => {
      const rel = relative2(root, target);
      return rel === "" || !rel.startsWith("..") && !isAbsolute3(rel);
    }))
      throw new LaunchConfigOperationDeniedError(
        `Configuration path escapes launch roots: ${path}`
      );
    return path;
  }
  rejectDanglingSymlinks(path) {
    const root = parse(path).root;
    let current = root;
    for (const part of path.slice(root.length).split(sep3).filter(Boolean)) {
      current = join9(current, part);
      try {
        if (!lstatSync2(current).isSymbolicLink()) continue;
      } catch {
        break;
      }
      try {
        realpathSync3(current);
      } catch {
        throw new LaunchConfigOperationDeniedError(
          `Configuration path contains an unresolved symlink: ${path}`
        );
      }
    }
  }
  async commit(input) {
    const message = this.message(input);
    await this.props.git.stage(input.files);
    await this.props.git.commit(message, input.files);
    return { sha: await this.props.git.getCommitSha(), message };
  }
  async checkout(input) {
    const result = await this.props.git.startBranch(
      {
        type: input.type,
        scope: input.scope,
        ...input.description === void 0 ? {} : { description: input.description }
      },
      input.from
    );
    return { branch: result.branch, from: input.from ?? null, renamedFrom: result.renamedFrom };
  }
  async push(input) {
    const spec = {
      branch: await this.props.git.getCurrentBranch(),
      remote: input.remote,
      setUpstream: input.setUpstream
    };
    await this.props.git.push(spec);
    return spec;
  }
  message(input) {
    return new DefaultCommitMessageBuilder({
      binPath: this.props.binPath,
      agentEnv: this.props.agentEnv
    }).build(input);
  }
};

// src/flight-rules/flight-rules.schema.ts
var FlightRulesPropsSchema = z33.object({
  cwd: z33.string().optional().describe("Directory used for config discovery; defaults to process.cwd()"),
  env: z33.record(z33.string(), z33.string().optional()).optional().describe("Live environment record; defaults to process.env"),
  configPath: z33.string().optional().describe("Explicit config file, taking precedence over FLIGHT_RULES_CONFIG and discovery"),
  host: NativeHostSchema.optional().describe(
    "Explicit configuration host; otherwise FLIGHT_RULES_HOST, the native package host, or Claude for compatibility"
  ),
  configWritePolicy: z33.object({
    scopes: z33.array(ConfigScopeSchema).optional(),
    roots: z33.array(z33.string().min(1)).optional()
  }).strict().optional()
});

// src/operations/local-discovery-operations.ts
import { readdirSync as readdirSync2 } from "node:fs";
import { resolve as resolve7 } from "node:path";
import { z as z34 } from "zod";

// src/tasks/qa-instructions/qa-instructions.ts
import { existsSync as existsSync8, readFileSync as readFileSync9, statSync as statSync3 } from "node:fs";
import { dirname as dirname11, join as join10, resolve as resolve6 } from "node:path";
var atxHeading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
var fenceRun = /^ {0,3}(`{3,}|~{3,})/;
var legacyHint = 'Legacy QA recipe in use. Move its content into a QA.md at the repo root (or a "QA" section of AGENTS.md); see docs/qa-instructions.md.';
var nodeFileSystem = {
  isFile: (path) => existsSync8(path) && statSync3(path).isFile(),
  exists: (path) => existsSync8(path),
  readFile: (path) => readFileSync9(path, "utf8")
};
var QaInstructionsFinder = class {
  fs;
  constructor(props = {}) {
    this.fs = props.fs ?? nodeFileSystem;
  }
  discover(input) {
    const sources = this.levels(input.from).map((dir) => this.sourceAt(dir)).filter((source) => source !== void 0);
    if (sources.length > 0) return { found: true, sources };
    const legacy = this.legacySource(input.legacyRecipePath);
    if (legacy !== void 0) return { found: true, sources: [legacy] };
    return { found: false, sources: [] };
  }
  /**
   * Extracts the body of the first heading whose text is exactly "QA" (any
   * case, any level), up to the next heading of the same or a higher level.
   * Headings inside fenced code blocks are ignored. Returns undefined when the
   * section is absent or empty.
   */
  extractQaSection(markdown) {
    const lines = markdown.split("\n");
    let openFence = null;
    let sectionLevel = null;
    const body = [];
    for (const line of lines) {
      const fence = fenceRun.exec(line)?.[1];
      if (fence !== void 0) {
        if (openFence === null) openFence = fence;
        else if (fence[0] === openFence[0] && fence.length >= openFence.length) openFence = null;
        if (sectionLevel !== null) body.push(line);
        continue;
      }
      const heading = openFence === null ? atxHeading.exec(line) : null;
      if (heading !== null) {
        const level = heading[1]?.length ?? 0;
        if (sectionLevel !== null && level <= sectionLevel) break;
        if (sectionLevel === null && (heading[2] ?? "").trim().toLowerCase() === "qa") {
          sectionLevel = level;
          continue;
        }
      }
      if (sectionLevel !== null) body.push(line);
    }
    const content = body.join("\n").trim();
    return content.length > 0 ? content : void 0;
  }
  /** The start directory and each parent up to the repository root; only the start when no root is found. */
  levels(from) {
    const absolute = resolve6(from);
    const start = this.fs.isFile(absolute) ? dirname11(absolute) : absolute;
    const levels = [];
    let current = start;
    for (; ; ) {
      levels.push(current);
      if (this.fs.exists(join10(current, ".git"))) return levels;
      const parent = dirname11(current);
      if (parent === current) return [start];
      current = parent;
    }
  }
  sourceAt(dir) {
    const agentsMd = join10(dir, "AGENTS.md");
    if (this.fs.isFile(agentsMd)) {
      const section = this.extractQaSection(this.fs.readFile(agentsMd));
      if (section !== void 0)
        return { path: agentsMd, kind: "agents-md-section", dir, content: section };
    }
    return this.fileSource(join10(dir, "QA.md"), "qa-md", dir) ?? this.fileSource(join10(dir, ".agents", "QA.md"), "agents-dir-qa-md", dir);
  }
  fileSource(path, kind, dir) {
    if (!this.fs.isFile(path)) return void 0;
    const content = this.fs.readFile(path).trim();
    return content.length > 0 ? { path, kind, dir, content } : void 0;
  }
  legacySource(path) {
    if (path === void 0) return void 0;
    const source = this.fileSource(path, "legacy-recipe", dirname11(path));
    return source === void 0 ? void 0 : { ...source, legacy: true, hint: legacyHint };
  }
};

// src/operations/local-discovery-operations.ts
var QaSourceSchema = z34.object({
  path: z34.string(),
  kind: z34.enum(["agents-md-section", "qa-md", "agents-dir-qa-md", "legacy-recipe"]),
  dir: z34.string(),
  content: z34.string(),
  legacy: z34.literal(true).optional(),
  hint: z34.string().optional()
});
var QaInstructionsSchema = z34.object({ found: z34.boolean(), sources: z34.array(QaSourceSchema) });
var ReadinessCheckSchema = z34.object({
  name: z34.string(),
  ok: z34.boolean(),
  detail: z34.string(),
  required: z34.boolean().optional(),
  code: z34.string().optional(),
  remedy: z34.string().optional()
});
var ReadinessReportSchema = z34.object({
  tracker: z34.string().nullable(),
  repo: z34.string().nullable().optional(),
  checks: z34.array(ReadinessCheckSchema),
  ok: z34.boolean(),
  workflow: WorkflowSchema.optional(),
  scope: z34.enum(["environment", "workflow"])
});
var ConfigInspectionSchema = z34.object({
  host: z34.string(),
  valid: z34.boolean(),
  error: z34.string().optional(),
  values: z34.record(z34.string(), z34.unknown()),
  sources: z34.record(
    z34.string(),
    z34.object({ scope: z34.enum(["user", "project", "local", "file"]), path: z34.string() })
  ),
  layers: z34.array(
    z34.object({
      scope: z34.enum(["user", "project", "local", "file"]),
      path: z34.string(),
      present: z34.boolean()
    })
  )
});
var CharterInputSchema = z34.object({
  paths: z34.array(z34.string()).optional(),
  diff: z34.string().optional(),
  repository: z34.boolean().default(false),
  pathOutput: z34.boolean().default(false)
}).strict().refine(
  (input) => Number(input.paths !== void 0 && input.paths.length > 0) + Number(input.diff !== void 0) + Number(input.repository) <= 1,
  "Choose one charter selection source"
);
var QaInstructionsInputSchema = z34.object({ from: z34.string().optional() }).strict();
var RfcDirectoryOutputSchema = z34.object({ path: z34.string() });
var RfcNextIdOutputSchema = z34.object({
  id: z34.string().regex(/^RFC-\d+$/),
  directory: z34.string()
});
var QaRecipeOutputSchema = z34.object({ path: z34.string() });
var EvidenceDirectoryOutputSchema = z34.object({
  path: z34.string(),
  gitignored: z34.boolean().nullable()
});
var rfcIdPattern = /^RFC-(\d+)\.md$/;
var LocalDiscoveryPropsSchema = z34.object({
  cwd: z34.string().min(1),
  getConfig: z34.custom((value) => typeof value === "function"),
  getConfigStore: z34.custom((value) => typeof value === "function"),
  getCharters: z34.custom((value) => typeof value === "function"),
  getRepositoryPaths: z34.custom((value) => typeof value === "function"),
  getEvidence: z34.custom((value) => typeof value === "function"),
  getReadiness: z34.custom((value) => typeof value === "function"),
  getProbe: z34.custom((value) => typeof value === "function"),
  getTracker: z34.custom((value) => typeof value === "function"),
  getConfigPath: z34.custom((value) => typeof value === "function"),
  getQaFinder: z34.custom((value) => typeof value === "function").optional()
});
var DefaultLocalDiscoveryOperations = class {
  props;
  constructor(props) {
    this.props = LocalDiscoveryPropsSchema.parse(props);
  }
  operations() {
    return [
      this.descriptor(
        "charter",
        "Print the core and applicable language charters.",
        ["read", "process"],
        ["charter"],
        CharterInputSchema,
        z34.object({
          charters: z34.array(
            z34.object({ path: z34.string(), contents: z34.string(), language: z34.string().nullable() })
          ),
          unmatched: z34.boolean()
        }),
        (input) => this.charter(input)
      ),
      this.descriptor(
        "competencies",
        "Read the configured worker competencies.",
        ["read", "process"],
        ["competencies"],
        z34.object({}),
        z34.array(z34.string()),
        () => this.props.getConfig().competencies
      ),
      this.descriptor(
        "rfc-dir",
        "Resolve the RFC directory for this checkout.",
        ["read", "process"],
        ["rfc", "dir"],
        z34.object({}),
        RfcDirectoryOutputSchema,
        () => ({ path: getRfcDir(this.props.getConfig(), this.props.cwd) })
      ),
      this.descriptor(
        "rfc-next-id",
        "Find the next RFC number in the configured RFC directory.",
        ["read", "process"],
        ["rfc", "next-id"],
        z34.object({}),
        RfcNextIdOutputSchema,
        () => this.nextRfcId()
      ),
      this.descriptor(
        "qa-instructions",
        "Find QA instructions that apply to a directory.",
        ["read", "process"],
        ["qa", "instructions"],
        QaInstructionsInputSchema,
        QaInstructionsSchema,
        (input) => this.qaInstructions(input)
      ),
      this.descriptor(
        "qa-evidence-dir",
        "Resolve the persistent evidence directory for a ticket.",
        ["read", "process"],
        ["qa", "evidence-dir"],
        z34.object({ ticket: z34.string().min(1) }),
        EvidenceDirectoryOutputSchema,
        (input) => this.props.getEvidence().dirFor(input.ticket)
      ),
      this.descriptor(
        "qa-recipe",
        "Resolve the nearest QA instruction path (deprecated CLI route).",
        ["read", "process"],
        ["qa", "recipe"],
        z34.object({}),
        QaRecipeOutputSchema,
        () => this.qaRecipe()
      ),
      this.descriptor(
        "config-path",
        "Resolve the config file path for this checkout.",
        ["read", "process"],
        ["config", "path"],
        z34.object({}),
        z34.object({ path: z34.string() }),
        () => ({ path: this.props.getConfigStore().filePath() })
      ),
      this.descriptor(
        "config-show",
        "Inspect merged configuration and its sources.",
        ["read", "process"],
        ["config", "show"],
        z34.object({}),
        ConfigInspectionSchema,
        () => this.props.getConfigStore().inspect()
      ),
      this.descriptor(
        "check",
        "Check local configuration, tools, and optional workflow readiness.",
        ["read", "process", "network"],
        ["check"],
        ReadinessOptionsSchema,
        ReadinessReportSchema,
        (input) => this.check(input)
      )
    ];
  }
  configStore() {
    return this.props.getConfigStore();
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler
    };
  }
  async charter(input) {
    let paths = input.paths ?? [];
    if (input.diff !== void 0)
      paths = await this.props.getRepositoryPaths().changedSince(input.diff);
    else if (input.repository || input.paths === void 0)
      paths = await this.props.getRepositoryPaths().inventory();
    const selected = this.props.getCharters().select(paths);
    return {
      charters: selected.map(({ path, contents, language }) => ({ path, contents, language })),
      unmatched: selected.every((charter) => charter.language === null)
    };
  }
  nextRfcId() {
    const directory = getRfcDir(this.props.getConfig(), this.props.cwd);
    let files;
    try {
      files = readdirSync2(directory);
    } catch {
      return { id: "RFC-001", directory };
    }
    const ids = files.map((file) => file.match(rfcIdPattern)).filter((match) => match !== null).map((match) => Number(match[1] ?? 0));
    return {
      id: `RFC-${String(ids.length === 0 ? 1 : Math.max(...ids) + 1).padStart(3, "0")}`,
      directory
    };
  }
  qaInstructions(input) {
    const config = this.safeConfig();
    if (config?.qaRecipe !== void 0 && config.qaRecipe.trim() === "")
      throw new BlankQaRecipeError(
        "qaRecipe is set to a blank value \u2014 remove the key and move the recipe into a QA.md (see docs/qa-instructions.md)"
      );
    return (this.props.getQaFinder?.() ?? new QaInstructionsFinder()).discover({
      from: input.from === void 0 ? this.props.cwd : resolve7(this.props.cwd, input.from),
      ...config === void 0 ? {} : { legacyRecipePath: getQaRecipePath(config, this.props.getConfigPath()) }
    });
  }
  qaRecipe() {
    const result = this.qaInstructions({});
    const nearest = result.sources[0];
    if (nearest === void 0)
      throw new QaInstructionsNotFoundError(
        "No QA instructions found \u2014 add a QA.md at the repo root or a QA section in AGENTS.md (see docs/qa-instructions.md)"
      );
    return { path: nearest.path };
  }
  check(input) {
    return this.props.getReadiness().inspect({
      config: this.props.getConfig,
      tracker: this.props.getTracker,
      configPath: this.props.getConfigPath,
      probe: this.props.getProbe(),
      finder: this.props.getQaFinder?.() ?? new QaInstructionsFinder(),
      options: input
    });
  }
  safeConfig() {
    try {
      return this.props.getConfig();
    } catch {
      return void 0;
    }
  }
};
var QaInstructionsNotFoundError = class extends Error {
  name = "QaInstructionsNotFoundError";
};
var BlankQaRecipeError = class extends Error {
  name = "BlankQaRecipeError";
};

// src/bundled-docs/charter-catalog/charter-catalog.ts
import { matchesGlob } from "node:path";
import { parse as parseYaml3 } from "yaml";
import { z as z35 } from "zod";
var coreCharterId = "coding-charter";
var languageCharterPrefix = `${coreCharterId}-`;
var LanguageFrontmatterSchema = z35.strictObject({
  language: z35.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  "applies-to": z35.array(z35.string().min(1)).min(1)
}).transform(({ language, "applies-to": appliesTo }) => ({ language, appliesTo }));
var FrontmatterSchema = z35.string().transform((contents, ctx) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(contents)?.[1];
  if (block === void 0) {
    ctx.addIssue({ code: "custom", message: "missing YAML frontmatter" });
    return z35.NEVER;
  }
  return parseYaml3(block);
}).pipe(LanguageFrontmatterSchema);
var DocCharterCatalog = class {
  docs;
  constructor(props) {
    this.docs = props.docs;
  }
  all() {
    const core = this.docs.resolve(coreCharterId);
    const languages = this.docs.list().filter((id) => id.startsWith(languageCharterPrefix)).map((id) => this.languageCharter(this.docs.resolve(id)));
    return [
      { id: core.id, language: null, appliesTo: [], tierA: this.tierA(core.contents), path: core.path, contents: core.contents },
      ...languages
    ];
  }
  select(paths) {
    const normalized = paths.map((path) => path.trim().replace(/^\.\//, "")).filter((path) => path.length > 0);
    return this.all().filter(
      (charter) => charter.language === null || normalized.some((path) => charter.appliesTo.some((glob) => matchesGlob(path, glob)))
    );
  }
  languageCharter(doc) {
    const parsed = FrontmatterSchema.safeParse(doc.contents);
    if (!parsed.success) {
      throw new CharterFormatError(`Charter "${doc.id}" has invalid frontmatter: ${z35.prettifyError(parsed.error)}`);
    }
    const expectedId = `${languageCharterPrefix}${parsed.data.language}`;
    if (doc.id !== expectedId) {
      throw new CharterFormatError(`Charter "${doc.id}" declares language "${parsed.data.language}"; its file must be ${expectedId}.md`);
    }
    return { id: doc.id, ...parsed.data, tierA: this.tierA(doc.contents), path: doc.path, contents: doc.contents };
  }
  tierA(contents) {
    const tiers = contents.split(/^## Review tiers\r?$/m)[1]?.split(/^## /m)[0] ?? "";
    const table = tiers.split(/^\*\*Tier B/m)[0] ?? "";
    return [...new Set([...table.matchAll(/^\|\s*([A-Z]+-\d+)\b/gm)].flatMap((match) => match[1] ?? []))];
  }
};
var CharterFormatError = class extends Error {
  name = "CharterFormatError";
};

// src/bundled-docs/charter-catalog/repository-paths.ts
import { execFile as execFile5 } from "node:child_process";
import { promisify as promisify5 } from "node:util";
import { z as z36 } from "zod";
var run = promisify5(execFile5);
var BaseRefSchema = z36.string().regex(/^[^\s-]\S*$/, 'base must be a git ref or commit, and cannot start with "-"');
var GitRepositoryPathsPropsSchema = z36.object({ cwd: z36.string().min(1) });
var GitRepositoryPaths = class {
  cwd;
  constructor(props) {
    this.cwd = GitRepositoryPathsPropsSchema.parse(props).cwd;
  }
  async inventory() {
    const root = await this.root();
    return this.paths(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  }
  async changedSince(base) {
    const ref = BaseRefSchema.parse(base);
    const root = await this.root();
    const mergeBase = (await this.git(root, ["merge-base", ref, "HEAD"])).trim();
    if (mergeBase.length === 0) throw new RepositoryPathsError(`No merge base between ${ref} and HEAD`);
    const changed = await this.paths(root, ["diff", "-z", "--name-only", mergeBase]);
    const untracked = await this.paths(root, ["ls-files", "-z", "--others", "--exclude-standard"]);
    return [.../* @__PURE__ */ new Set([...changed, ...untracked])];
  }
  // Path queries run from the top level so the result never depends on which subdirectory the caller is in.
  async root() {
    return (await this.git(this.cwd, ["rev-parse", "--show-toplevel"])).replace(/\r?\n$/, "");
  }
  // NUL-delimited output keeps paths verbatim; newline output quotes non-ASCII and special characters.
  async paths(root, args) {
    return (await this.git(root, args)).split("\0").filter((path) => path.length > 0);
  }
  async git(cwd, args) {
    try {
      const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    } catch (cause) {
      throw new RepositoryPathsError(`git ${args[0]} failed in ${cwd}`, { cause });
    }
  }
};
var RepositoryPathsError = class extends Error {
  name = "RepositoryPathsError";
};

// src/operations/review-operations.ts
import { z as z40 } from "zod";

// src/code-review/review-policy.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { readFileSync as readFileSync10, realpathSync as realpathSync4 } from "node:fs";
import { dirname as dirname12, join as join11, relative as relative3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { z as z37 } from "zod";
var ReviewPolicyPropsSchema = z37.strictObject({
  home: z37.string().min(1).optional(),
  env: z37.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional()
});
var LoadPolicyPropsSchema = z37.strictObject({ paths: z37.array(z37.string()).optional() });
var RepositoryContextPropsSchema = z37.strictObject({
  cwd: z37.string().min(1),
  trustedRef: HeadShaSchema,
  contextPath: ReviewPathSchema.min(1).default("CODE-REVIEW.md")
});
var FileReviewPolicy = class {
  home;
  env;
  constructor(props = {}) {
    const parsed = ReviewPolicyPropsSchema.parse(props);
    this.home = parsed.home ?? join11(dirname12(fileURLToPath3(import.meta.url)), "..");
    this.env = props.env ?? process.env;
  }
  load(input = {}) {
    const { paths } = LoadPolicyPropsSchema.parse(input);
    const docs = realpathSync4(join11(this.home, "docs"));
    const read = (id) => {
      const path = realpathSync4(join11(docs, `${id}.md`));
      if (relative3(docs, path).startsWith(".."))
        throw new ReviewPolicyError("review policy path leaves the installed docs directory");
      return readFileSync10(path, "utf8");
    };
    const catalog = new DocCharterCatalog({ docs: new FileDocResolver({ docsDir: docs }) });
    const charters = (paths === void 0 ? catalog.all() : catalog.select(paths)).map(
      ({ id, language, appliesTo, tierA, contents }) => ({
        id,
        language,
        appliesTo,
        tierA,
        contents
      })
    );
    return {
      method: read("autonomous-review-method"),
      charter: charters.map(({ contents }) => contents.endsWith("\n") ? contents : `${contents}
`).join("\n"),
      charters,
      tierA: [...new Set(charters.flatMap(({ tierA }) => tierA))],
      contract: read("code-review-findings-contract")
    };
  }
  repository(input) {
    const props = RepositoryContextPropsSchema.parse(input);
    const paths = [
      .../* @__PURE__ */ new Set([
        props.contextPath,
        "AGENTS.md",
        "CLAUDE.md",
        ".github/CODEOWNERS",
        "CODEOWNERS",
        "docs/CODEOWNERS"
      ])
    ];
    const sources = [];
    const missing = [];
    for (const path of paths) {
      const tree = execFileSync3("git", ["ls-tree", "-z", props.trustedRef, "--", path], {
        cwd: props.cwd,
        env: this.env,
        encoding: "utf8"
      });
      if (!tree) {
        missing.push(path);
        continue;
      }
      if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(tree))
        throw new ReviewPolicyError(`review rules must be a regular file: ${path}`);
      sources.push({
        path,
        contents: execFileSync3("git", ["show", `${props.trustedRef}:${path}`], {
          cwd: props.cwd,
          env: this.env,
          encoding: "utf8",
          maxBuffer: 1e7
        })
      });
    }
    return { trustedRef: props.trustedRef, contextPath: props.contextPath, sources, missing };
  }
};
var ReviewPolicyError = class extends Error {
  name = "ReviewPolicyError";
};

// src/code-review/github-review-verifier.ts
import { execFile as execFile6 } from "node:child_process";
import { promisify as promisify6 } from "node:util";
import { z as z38 } from "zod";
var GhReviewGitHubApiPropsSchema = z38.strictObject({
  cwd: z38.string().min(1).optional(),
  env: z38.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional()
});
var GhReviewGitHubApi = class {
  cwd;
  env;
  constructor(props = {}) {
    const parsed = GhReviewGitHubApiPropsSchema.parse(props);
    this.cwd = parsed.cwd ?? process.cwd();
    this.env = props.env ?? process.env;
  }
  async get(path) {
    return this.run(["api", path]);
  }
  async graphql(query, variables) {
    return this.run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      ...Object.entries(variables).flatMap(([key, value]) => [
        typeof value === "number" ? "-F" : "-f",
        `${key}=${value}`
      ])
    ]);
  }
  async run(args) {
    const { stdout } = await promisify6(execFile6)("gh", args, {
      maxBuffer: 2e7,
      cwd: this.cwd,
      env: this.env
    });
    return JSON.parse(stdout);
  }
};
var GitHubReviewVerifierPropsSchema = z38.strictObject({
  repo: z38.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  prNumber: z38.number().int().positive(),
  prAuthorId: z38.number().int().positive(),
  owners: z38.record(z38.string(), z38.array(z38.string().min(1))).default({}),
  requireMapping: z38.boolean().default(false)
});
var UserSchema = z38.looseObject({ id: z38.number(), login: z38.string(), type: z38.string() });
var CommentSchema2 = z38.looseObject({
  id: z38.number(),
  user: UserSchema,
  issue_url: z38.string().optional(),
  pull_request_url: z38.string().optional(),
  body: z38.string()
});
var GitHubReviewVerifier = class {
  props;
  api;
  constructor(props) {
    const { api, ...values } = props;
    this.props = GitHubReviewVerifierPropsSchema.parse(values);
    this.api = api ?? new GhReviewGitHubApi();
  }
  async verify(evidence, headSha) {
    if (evidence.kind === "document") return true;
    if (evidence.kind === "verification") return false;
    if (evidence.kind === "github_comment") {
      const comment = await this.comment(evidence.comment_id, evidence.url);
      return comment !== void 0;
    }
    if (evidence.kind === "thread_resolution") return this.dismissal(evidence);
    if (evidence.kind === "commit") return this.reaches(evidence.sha, headSha);
    if (evidence.kind === "check_run") {
      if (evidence.commit_sha !== headSha) return false;
      const check = z38.looseObject({
        head_sha: z38.string(),
        status: z38.string(),
        conclusion: z38.string().nullable()
      }).parse(await this.api.get(`/repos/${this.props.repo}/check-runs/${evidence.check_run_id}`));
      return check.head_sha === headSha && check.status === "completed" && check.conclusion === "success";
    }
    if (!await this.reaches(evidence.commit_sha, headSha)) return false;
    return (evidence.commit_sha === headSha || await this.hasLine(evidence.path, evidence.line, evidence.commit_sha)) && await this.hasLine(evidence.path, evidence.line, headSha);
  }
  async authorize(answer, finding) {
    if (finding.type !== "decide" || !finding.decision_options.some((option) => option.id === answer.option_id))
      return false;
    const comment = await this.comment(answer.comment_id);
    if (comment === void 0 || comment.user.id !== answer.author_id || comment.user.type !== "User" || !comment.body.trim())
      return false;
    const owners = this.props.owners[finding.decision_owner];
    if (owners !== void 0)
      return owners.some((login) => login.toLowerCase() === comment.user.login.toLowerCase());
    if (this.props.requireMapping || comment.user.id === this.props.prAuthorId) return false;
    const permission = z38.looseObject({ permission: z38.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/collaborators/${encodeURIComponent(comment.user.login)}/permission`
      )
    );
    return ["write", "maintain", "admin"].includes(permission.permission);
  }
  async dismissal(evidence) {
    if (evidence.kind !== "thread_resolution" || evidence.author_id === this.props.prAuthorId)
      return false;
    const result = z38.looseObject({
      data: z38.looseObject({
        node: z38.looseObject({
          isResolved: z38.boolean(),
          resolvedBy: z38.looseObject({ databaseId: z38.number(), actorType: z38.string() }).nullable(),
          pullRequest: z38.looseObject({
            number: z38.number(),
            repository: z38.looseObject({ nameWithOwner: z38.string() })
          })
        }).nullable()
      })
    }).parse(
      await this.api.graphql(
        "query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { isResolved resolvedBy { actorType: __typename ... on User { databaseId } } pullRequest { number repository { nameWithOwner } } } } }",
        { id: evidence.thread_id }
      )
    );
    const thread = result.data.node;
    return thread !== null && thread.isResolved && thread.resolvedBy?.actorType === "User" && thread.resolvedBy.databaseId === evidence.author_id && thread.pullRequest.number === this.props.prNumber && thread.pullRequest.repository.nameWithOwner.toLowerCase() === this.props.repo.toLowerCase();
  }
  /** True when `sha` is the head or an ancestor of it, so the head contains that commit. */
  async reaches(sha, headSha) {
    if (sha === headSha) return true;
    const comparison = z38.looseObject({ status: z38.string() }).parse(await this.api.get(`/repos/${this.props.repo}/compare/${sha}...${headSha}`));
    return ["ahead", "identical"].includes(comparison.status);
  }
  /** True when `ref` has `path` as a file with at least `line` lines. */
  async hasLine(path, line, ref) {
    const file = z38.looseObject({ type: z38.string(), encoding: z38.string(), content: z38.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`
      )
    );
    if (file.type !== "file" || file.encoding !== "base64") return false;
    const text = Buffer.from(file.content, "base64").toString("utf8");
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return line <= lines;
  }
  async comment(id, url) {
    if (url !== void 0 && !url.toLowerCase().startsWith(
      `https://github.com/${this.props.repo.toLowerCase()}/pull/${this.props.prNumber}#`
    ))
      return void 0;
    const endpoints = url?.includes("#discussion_r") ? ["pulls/comments"] : url?.includes("#issuecomment-") ? ["issues/comments"] : ["issues/comments", "pulls/comments"];
    for (const endpoint of endpoints) {
      try {
        const comment = CommentSchema2.parse(
          await this.api.get(`/repos/${this.props.repo}/${endpoint}/${id}`)
        );
        const expected = `https://api.github.com/repos/${this.props.repo.toLowerCase()}`;
        if (comment.id === id && (comment.issue_url?.toLowerCase() === `${expected}/issues/${this.props.prNumber}` || comment.pull_request_url?.toLowerCase() === `${expected}/pulls/${this.props.prNumber}`))
          return comment;
      } catch {
        continue;
      }
    }
    return void 0;
  }
};

// src/code-review/review-planner.ts
import { randomBytes } from "node:crypto";
import { z as z39 } from "zod";
var EvidenceReviewPlanner = class {
  verifier;
  constructor(props) {
    this.verifier = props.verifier;
  }
  async plan(input) {
    const headSha = HeadShaSchema.parse(input.headSha);
    const review = reviewContract.parse(input.review);
    const records = input.records.map((record) => reviewContract.record(record));
    const known = new Map(records.map((record) => [record.finding.id, record]));
    if (known.size !== records.length) throw new InvalidReviewError("duplicate stored finding IDs");
    if (review.head_sha !== headSha)
      throw new InvalidReviewError("reviewed head is stale; rerun against the current PR head");
    for (const entry of review.prior_findings) {
      if (known.get(entry.id)?.status !== "open")
        throw new InvalidReviewError(`unknown or closed prior finding: ${entry.id}`);
    }
    const problems = [];
    const updates = new Map(review.prior_findings.map((entry) => [entry.id, entry]));
    const retained = [];
    for (const record of records) {
      if (record.status !== "open") {
        retained.push(record);
        continue;
      }
      const entry = updates.get(record.finding.id);
      if (entry === void 0) {
        problems.push(`omitted open finding ${record.finding.id}`);
        retained.push(record);
        continue;
      }
      const evidence = entry.evidence ?? [];
      let valid = true;
      for (const reference of evidence) {
        try {
          if (!await this.verifier.verify(reference, headSha)) valid = false;
        } catch {
          valid = false;
        }
      }
      const changed = entry.status !== "still_open" || entry.updated_finding !== void 0 || entry.decision !== void 0;
      if (!valid && changed) {
        problems.push(`evidence could not be validated for ${entry.id}`);
        retained.push(record);
        continue;
      }
      let authorized = false;
      if (entry.decision !== void 0) {
        try {
          authorized = await this.verifier.authorize(entry.decision, record.finding);
        } catch {
          authorized = false;
        }
        if (!authorized) {
          problems.push(`decision authorization was not verified for ${entry.id}`);
          retained.push(record);
          continue;
        }
      }
      if (entry.status === "withdrawn" && entry.withdrawal_basis === "dismissed") {
        let dismissed = false;
        for (const reference of evidence) {
          try {
            if (await this.verifier.dismissal(reference)) dismissed = true;
          } catch {
            continue;
          }
        }
        if (record.finding.blocking || record.finding.type === "decide" || !dismissed) {
          problems.push(`manual dismissal cannot close ${entry.id}`);
          retained.push(record);
          continue;
        }
      }
      const withdrawal = entry.status === "withdrawn" && entry.withdrawal_basis !== "dismissed";
      const decisionChanged = record.finding.type === "decide" && changed;
      if (decisionChanged && !authorized && !withdrawal) {
        problems.push(`decision ${entry.id} still needs an authorized human answer`);
        retained.push(record);
        continue;
      }
      const finding = entry.status === "still_open" && entry.updated_finding !== void 0 ? entry.updated_finding : record.finding;
      retained.push(
        FindingRecordSchema.parse({
          ...record,
          finding,
          status: entry.status === "still_open" ? "open" : entry.status,
          evidence: changed ? evidence : record.evidence,
          ...entry.decision !== void 0 ? { decision: entry.decision } : {}
        })
      );
    }
    const ids = new Set(known.keys());
    const informational = [];
    for (const finding of review.findings) {
      const id = this.newId(ids);
      if (!("type" in finding)) {
        informational.push({ ...finding, id });
        continue;
      }
      retained.push(
        FindingRecordSchema.parse({
          v: 1,
          schema_revision: 1,
          finding: { ...finding, id },
          status: "open",
          evidence: []
        })
      );
    }
    const outcome = this.outcome(review, retained, problems);
    return { review, records: retained, informational, outcome, problems };
  }
  newId(ids) {
    let id = `f-${randomBytes(5).toString("hex")}`;
    while (ids.has(id)) id = `f-${randomBytes(5).toString("hex")}`;
    ids.add(id);
    return id;
  }
  outcome(review, records, problems) {
    if (!review.review_complete || problems.length > 0 || review.outcome === "INCOMPLETE")
      return "INCOMPLETE";
    const blockers = records.filter(
      (record) => record.status === "open" && record.finding.blocking
    );
    if (blockers.some((record) => record.finding.type === "decide")) return "ESCALATE";
    if (review.outcome === "ESCALATE") {
      problems.push("claimed escalation has no matching open blocking decision");
      return "INCOMPLETE";
    }
    if (blockers.length > 0) return "CHANGES_NEEDED";
    if (review.outcome !== "APPROVED") {
      problems.push("claimed outcome has no matching open blocking finding");
      return "INCOMPLETE";
    }
    return "APPROVED";
  }
};
var ValidatedEvidencePropsSchema = z39.strictObject({
  verified: z39.array(z39.string()),
  authorizedDecisions: z39.array(z39.string()),
  dismissals: z39.array(z39.string())
});

// src/operations/review-operations.ts
var ReviewOperationsLaunchPropsSchema = z40.strictObject({
  cwd: z40.string().min(1).optional(),
  trustedRef: HeadShaSchema.optional(),
  owners: z40.record(z40.string(), z40.array(z40.string().min(1))).default({}),
  requireMapping: z40.boolean().default(false)
});
var ReviewOperationsPropsSchema = ReviewOperationsLaunchPropsSchema.extend({
  cwd: z40.string().min(1),
  env: z40.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional(),
  policy: z40.custom(
    (value) => typeof value === "object" && value !== null && "repository" in value && "load" in value
  ).optional(),
  api: z40.custom(
    (value) => typeof value === "object" && value !== null && "get" in value && "graphql" in value
  ).optional()
});
var JsonValueSchema = z40.json();
var schemaInput = z40.strictObject({ transport: z40.boolean().default(false) });
var reviewInput = z40.strictObject({ review: JsonValueSchema });
var reviewOutput = ReviewSchema;
var stateInput = z40.strictObject({ state: JsonValueSchema });
var stateOutput = z40.string();
var contextInput = z40.strictObject({
  contextPath: z40.string().min(1).default("CODE-REVIEW.md")
});
var contextOutput = z40.object({
  trustedRef: HeadShaSchema,
  contextPath: z40.string(),
  sources: z40.array(z40.object({ path: z40.string(), contents: z40.string() })),
  missing: z40.array(z40.string())
});
var planInput = z40.strictObject({
  number: z40.number().int().positive(),
  repo: z40.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  review: JsonValueSchema,
  records: z40.array(JsonValueSchema)
});
var renderInput = z40.strictObject({
  review: JsonValueSchema,
  records: z40.array(FindingRecordSchema),
  outcome: z40.string(),
  problems: z40.array(z40.string())
});
var renderOutput = z40.object({
  headSha: z40.string(),
  outcome: z40.string(),
  problems: z40.array(z40.string()),
  findings: z40.array(
    z40.object({
      id: z40.string(),
      status: z40.string(),
      path: z40.string(),
      line: z40.number(),
      body: z40.string()
    })
  )
});
var planOutput = z40.object({
  review: ReviewSchema,
  records: z40.array(FindingRecordSchema),
  informational: z40.array(StoredFindingSchema),
  outcome: z40.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]),
  problems: z40.array(z40.string())
});
var MissingTrustedReviewRefError = class extends Error {
  name = "MissingTrustedReviewRefError";
};
var DefaultReviewOperations = class {
  cwd;
  policy;
  api;
  trustedRef;
  owners;
  requireMapping;
  constructor(props) {
    const parsed = ReviewOperationsPropsSchema.parse(props);
    this.cwd = parsed.cwd ?? process.cwd();
    this.trustedRef = parsed.trustedRef;
    this.owners = parsed.owners;
    this.requireMapping = parsed.requireMapping;
    const env = props.env ?? process.env;
    this.policy = parsed.policy ?? new FileReviewPolicy({ env });
    this.api = parsed.api ?? new GhReviewGitHubApi({ cwd: this.cwd, env });
  }
  operations() {
    return [
      this.descriptor(
        "review-schema",
        "Return the canonical full or model-facing review contract schema.",
        ["read", "process"],
        ["review", "schema"],
        schemaInput,
        JsonValueSchema,
        ({ transport }) => {
          const schemas = reviewContract.schemas();
          return JsonValueSchema.parse(
            JSON.parse(JSON.stringify(transport ? schemas.transport : schemas.full))
          );
        }
      ),
      this.descriptor(
        "review-validate",
        "Validate and normalize a review against the canonical contract.",
        ["read", "process"],
        ["review", "validate"],
        reviewInput,
        reviewOutput,
        ({ review }) => reviewContract.parse(review)
      ),
      this.descriptor(
        "review-render",
        "Render persisted findings from a validated review plan.",
        ["read", "process"],
        ["review", "render"],
        renderInput,
        renderOutput,
        ({ review, records, outcome, problems }) => {
          const parsedReview = reviewContract.parse(review);
          const codec = new JsonReviewCodec();
          return {
            headSha: parsedReview.head_sha,
            outcome,
            problems,
            findings: records.map((record) => ({
              id: record.finding.id,
              status: record.status,
              path: record.finding.path,
              line: record.finding.line,
              body: codec.render(record)
            }))
          };
        }
      ),
      this.descriptor(
        "review-state",
        "Validate a persisted review state index and return its canonical marker.",
        ["read", "process"],
        ["review", "state"],
        stateInput,
        stateOutput,
        ({ state }) => new JsonReviewCodec().state(ReviewStateSchema.parse(state))
      ),
      this.descriptor(
        "review-context",
        "Read repository review rules from a pinned commit in the launch checkout.",
        ["read", "process"],
        ["review", "context"],
        contextInput,
        contextOutput,
        ({ contextPath }) => {
          if (this.trustedRef === void 0)
            throw new MissingTrustedReviewRefError("trusted review ref was not bound at launch");
          return this.policy.repository({
            cwd: this.cwd,
            trustedRef: this.trustedRef,
            contextPath
          });
        }
      ),
      this.descriptor(
        "review-plan",
        "Plan review transitions after checking current GitHub head and evidence authority.",
        ["read", "network", "process"],
        ["review", "plan"],
        planInput,
        planOutput,
        async ({ number, repo, review, records }) => {
          const pullRequest = z40.looseObject({
            head: z40.looseObject({ sha: HeadShaSchema }),
            user: z40.looseObject({ id: z40.number().int().positive() })
          }).parse(await this.api.get(`/repos/${repo}/pulls/${number}`));
          const planner = new EvidenceReviewPlanner({
            verifier: new GitHubReviewVerifier({
              api: this.api,
              repo,
              prNumber: number,
              prAuthorId: pullRequest.user.id,
              owners: this.owners,
              requireMapping: this.requireMapping
            })
          });
          return planner.plan({ review, records, headSha: pullRequest.head.sha });
        }
      )
    ];
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler
    };
  }
};

// src/operations/tracker-entity-operations.ts
import { existsSync as existsSync10, realpathSync as realpathSync7, statSync as statSync5 } from "node:fs";
import { isAbsolute as isAbsolute5, relative as relative5, resolve as resolve9 } from "node:path";
import { z as z46 } from "zod";

// src/tasks/evidence/evidence.ts
import { realpathSync as realpathSync5 } from "node:fs";
import { basename as basename3 } from "node:path/posix";
import { z as z41 } from "zod";
var mediaReference = /(!?)\[([^\]]*)\]\(\s*<?([^\s()<>]+)>?(?:\s+"[^"]*")?\s*\)/g;
var absoluteTarget = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\/|^#/;
var localPrefix = /^(?:\.\/)+/;
var fenceRun2 = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var AttachmentSpecSchema = z41.string().min(1).transform((spec) => {
  const hash = spec.lastIndexOf("#");
  const path = hash > 0 ? spec.slice(0, hash) : spec;
  const caption = hash > 0 ? spec.slice(hash + 1).trim() : "";
  return { path, caption: caption.length > 0 ? caption : basename3(path) };
});
var DuplicateEvidenceNameError = class extends Error {
  name = "DuplicateEvidenceNameError";
  constructor(props) {
    super(`Two attachments share the filename "${props.filename}": ${props.paths.join(", ")}`);
  }
};
var EvidenceUploadFailure = class extends Error {
  name = "EvidenceUploadFailure";
  attachments;
  constructor(props) {
    super(
      props.attachments.length === 0 && props.cause instanceof Error ? props.cause.message : "One or more attachments could not be uploaded",
      { cause: props.cause }
    );
    this.attachments = props.attachments;
  }
};
var TrackerEvidenceService = class {
  tracker;
  constructor(props) {
    this.tracker = props.tracker;
  }
  async attach(input) {
    const specs = this.parseSpecs(input.specs);
    const attachments = [];
    for (const spec of specs) {
      try {
        const uploaded = await this.tracker.addAttachment(input.ticketId, spec.path);
        attachments.push({
          ...uploaded,
          path: spec.path,
          caption: spec.caption,
          referenced: false
        });
      } catch (cause) {
        throw new EvidenceUploadFailure({ cause, attachments });
      }
    }
    const byName = /* @__PURE__ */ new Map();
    for (const attachment of attachments) byName.set(basename3(attachment.path), attachment);
    const rewritten = this.rewriteReferences(input.body, byName);
    return { body: this.appendUnreferenced(rewritten, attachments), attachments };
  }
  prepareBody(input) {
    const specs = this.parseSpecs(input.specs);
    const attachments = specs.map((spec) => ({
      id: "pending",
      filename: basename3(spec.path),
      mimeType: "application/octet-stream",
      path: spec.path,
      caption: spec.caption,
      referenced: false
    }));
    const byName = /* @__PURE__ */ new Map();
    for (const attachment of attachments) byName.set(basename3(attachment.path), attachment);
    const rewritten = this.rewriteReferences(input.body, byName);
    return this.appendUnreferenced(rewritten, attachments);
  }
  parseSpecs(specs) {
    const parsed = specs.map((spec) => AttachmentSpecSchema.parse(spec));
    this.rejectDuplicateNames(parsed);
    return parsed;
  }
  rejectDuplicateNames(specs) {
    const paths = /* @__PURE__ */ new Map();
    for (const spec of specs) {
      const name = basename3(spec.path);
      paths.set(name, [...paths.get(name) ?? [], spec.path]);
    }
    for (const [filename, group] of paths) {
      if (group.length > 1) throw new DuplicateEvidenceNameError({ filename, paths: group });
    }
  }
  rewriteReferences(body, byName) {
    let fence;
    return body.split("\n").map((line) => {
      if (fence === void 0) {
        const opened = this.openingFence(line);
        if (opened !== void 0) {
          fence = opened;
          return line;
        }
        return this.rewriteLine(line, byName);
      }
      if (this.closesFence(line, fence)) fence = void 0;
      return line;
    }).join("\n");
  }
  /**
   * A line opens a fence when it is a run of >=3 backticks or tildes; a backtick
   * fence's info string may not itself contain a backtick, which keeps inline
   * code from being read as a fence.
   */
  openingFence(line) {
    const match = fenceRun2.exec(line);
    if (match === null) return void 0;
    const run2 = match[1];
    const rest = match[2];
    if (run2 === void 0 || rest === void 0) return void 0;
    if (run2.charAt(0) === "`" && rest.includes("`")) return void 0;
    return { char: run2.charAt(0), length: run2.length };
  }
  /**
   * A line closes an open fence only when it is a run of the SAME character, at
   * least as long as the opening run, with nothing but whitespace after it.
   */
  closesFence(line, fence) {
    const match = fenceRun2.exec(line);
    if (match === null) return false;
    const run2 = match[1];
    const rest = match[2];
    if (run2 === void 0 || rest === void 0) return false;
    return run2.charAt(0) === fence.char && run2.length >= fence.length && rest.trim().length === 0;
  }
  rewriteLine(line, byName) {
    let result = "";
    let last = 0;
    mediaReference.lastIndex = 0;
    for (let match = mediaReference.exec(line); match !== null; match = mediaReference.exec(line)) {
      const whole = match[0];
      const bang = match[1];
      const label = match[2];
      const target = match[3];
      result += line.slice(last, match.index);
      const attachment = bang !== void 0 && label !== void 0 && target !== void 0 ? this.resolve(target, byName) : void 0;
      if (attachment === void 0 || bang === void 0 || label === void 0) {
        result += whole;
      } else {
        attachment.referenced = true;
        result += `${bang}[${label}](attachment:${attachment.filename})`;
      }
      last = match.index + whole.length;
    }
    return result + line.slice(last);
  }
  resolve(target, byName) {
    if (absoluteTarget.test(target)) return void 0;
    if (target.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(target)) {
      try {
        const realTarget = realpathSync5(target);
        return [...byName.values()].find((attachment) => {
          try {
            return realpathSync5(attachment.path) === realTarget;
          } catch {
            return false;
          }
        });
      } catch {
        return void 0;
      }
    }
    return byName.get(basename3(target.replace(localPrefix, "")));
  }
  appendUnreferenced(body, attachments) {
    let result = body;
    for (const attachment of attachments) {
      if (!attachment.referenced)
        result += `

![${attachment.caption}](attachment:${attachment.filename})`;
    }
    return result;
  }
};

// src/tasks/portable-context/portable-context.ts
var tokenStart = String.raw`(?:^|(?<=[\s(\[<{"'\x60=,:;|]))`;
var localReferencePatterns = [
  /file:\/\/\S*/g,
  new RegExp(`${tokenStart}/(?:Users|home)/[^\\s/)\\]>"'\\x60]+\\S*`, "g"),
  new RegExp(`${tokenStart}~/\\S*`, "g"),
  /\b[A-Za-z]:\\Users\\\S*/g
];
var trailingPunctuation = /[`.,;:!?)\]>"']+$/;
var maxReported = 5;
var RegexPortableContextGuard = class {
  find(body) {
    return body.split("\n").flatMap(
      (text, index) => localReferencePatterns.flatMap(
        (pattern) => [...text.matchAll(pattern)].map((m) => ({ line: index + 1, match: m[0].replace(trailingPunctuation, "") }))
      )
    );
  }
  assertPortable(body, opts = {}) {
    if (opts.allowLocalPaths === true) return;
    const found = this.find(body);
    if (found.length === 0) return;
    const listed = found.slice(0, maxReported).map((ref) => `  line ${ref.line}: ${ref.match}`).join("\n");
    const more = found.length > maxReported ? `
  \u2026and ${found.length - maxReported} more` : "";
    throw new Error(
      `body references files on this machine, which nobody else can open:
${listed}${more}
A tracker body must stand on its own for an engineer on a fresh clone. Inline the content, link a published artifact (\`flight-rules tdd create\`, a tracker issue, or a file on the default branch by URL), or use a repo-relative path for code that exists on the default branch. Pass --allow-local-paths only when the path is the subject of the work, not a pointer to context.`
    );
  }
};
var portableContextGuard = new RegexPortableContextGuard();

// src/operations/operation-registry.ts
import { z as z43 } from "zod";

// src/operations/operation.schema.ts
import { z as z42 } from "zod";
var OperationEffectSchema = z42.enum(["read", "write", "network", "process"]);
var OperationIdSchema = z42.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var CliRouteSchema = z42.object({
  path: z42.array(z42.string().min(1)).min(1),
  aliases: z42.array(z42.string().min(1)).default([])
});
var OperationErrorSchema = z42.object({
  name: z42.string().min(1),
  message: z42.string()
});
var OperationEnvelopeSchema = z42.discriminatedUnion("status", [
  z42.object({ status: z42.literal("success"), data: z42.unknown() }),
  z42.object({ status: z42.literal("error"), error: OperationErrorSchema }),
  z42.object({ status: z42.literal("partial"), data: z42.unknown(), error: OperationErrorSchema })
]);

// src/operations/operation-registry.ts
var OperationDescriptorSchema = z43.object({
  id: OperationIdSchema,
  description: z43.string().min(1),
  inputSchema: z43.custom((value) => value instanceof z43.ZodType),
  outputSchema: z43.custom((value) => value instanceof z43.ZodType),
  effects: z43.array(OperationEffectSchema),
  cli: CliRouteSchema,
  handler: z43.custom((value) => typeof value === "function")
});
var OperationRegistryPropsSchema = z43.object({
  operations: z43.array(z43.custom()),
  policy: z43.custom().optional()
});
var AccessPolicyPropsSchema = z43.object({
  allowedOperationIds: z43.array(OperationIdSchema).default([]),
  allowedEffects: z43.array(OperationEffectSchema).default([])
});
var LaunchOperationAccessPolicy = class {
  operationIds;
  effects;
  constructor(props = {}) {
    const grants = AccessPolicyPropsSchema.parse(props);
    this.operationIds = new Set(grants.allowedOperationIds);
    this.effects = new Set(grants.allowedEffects);
  }
  allows(operation) {
    return this.operationIds.has(operation.id) || operation.effects.every((effect) => this.effects.has(effect));
  }
};
var OperationInputShape = class {
  fieldsOf(schema) {
    let json;
    try {
      json = z43.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    } catch {
      return [];
    }
    const parsed = z43.object({
      properties: z43.record(z43.string(), z43.unknown()).optional(),
      required: z43.array(z43.string()).optional()
    }).safeParse(json);
    if (!parsed.success) return [];
    const required = new Set(parsed.data.required ?? []);
    return Object.entries(parsed.data.properties ?? {}).map(([name, property]) => ({
      name,
      type: this.typeOf(property),
      required: required.has(name)
    }));
  }
  render(fields) {
    if (fields.length === 0) return "{}";
    return `{ ${fields.map(({ name, type, required }) => `${name}${required ? "" : "?"}: ${type}`).join(", ")} }`;
  }
  typeOf(property) {
    const parsed = z43.object({
      type: z43.union([z43.string(), z43.array(z43.string())]).optional(),
      enum: z43.array(z43.unknown()).optional(),
      const: z43.unknown().optional(),
      items: z43.unknown().optional(),
      anyOf: z43.array(z43.unknown()).optional()
    }).safeParse(property);
    if (!parsed.success) return "unknown";
    const { type, enum: options, items, anyOf } = parsed.data;
    if (options !== void 0) return options.map((value) => JSON.stringify(value)).join(" | ");
    if (parsed.data.const !== void 0) return JSON.stringify(parsed.data.const);
    if (anyOf !== void 0) return [...new Set(anyOf.map((entry) => this.typeOf(entry)))].join(" | ");
    if (Array.isArray(type)) return type.join(" | ");
    if (type === "array") return `${items === void 0 ? "unknown" : this.typeOf(items)}[]`;
    return type ?? "unknown";
  }
};
var operationInputShape = new OperationInputShape();
var OperationInputError = class extends Error {
  name = "OperationInputError";
};
var OperationOutputError = class extends Error {
  name = "OperationOutputError";
};
var UnknownOperationError = class extends Error {
  name = "UnknownOperationError";
};
var DuplicateOperationIdError = class extends Error {
  name = "DuplicateOperationIdError";
  constructor(operationId) {
    super(`Duplicate operation id: ${operationId}`);
  }
};
var MapOperationRegistry = class {
  operations;
  policy;
  constructor(props) {
    const parsed = OperationRegistryPropsSchema.parse(props);
    this.policy = parsed.policy ?? new LaunchOperationAccessPolicy();
    this.operations = /* @__PURE__ */ new Map();
    for (const descriptor of parsed.operations) {
      const valid = OperationDescriptorSchema.parse(descriptor);
      if (this.operations.has(valid.id)) throw new DuplicateOperationIdError(valid.id);
      const registered = Object.freeze({
        id: valid.id,
        description: valid.description,
        inputSchema: valid.inputSchema,
        outputSchema: valid.outputSchema,
        effects: Object.freeze([...valid.effects]),
        cli: Object.freeze({
          path: [...valid.cli.path],
          aliases: [...valid.cli.aliases]
        }),
        handler: descriptor.handler.bind(descriptor)
      });
      this.operations.set(registered.id, registered);
    }
  }
  list() {
    return [...this.operations.values()].map(({ id, description, effects, cli }) => ({
      id,
      description,
      effects: [...effects],
      cli: { path: [...cli.path], aliases: [...cli.aliases] }
    }));
  }
  admitted() {
    const admitted = new Set(
      [...this.operations.values()].filter((operation) => this.policy.allows(operation)).map(({ id }) => id)
    );
    return this.list().filter(({ id }) => admitted.has(id)).map((summary) => {
      const operation = this.operations.get(summary.id);
      return operation === void 0 ? summary : { ...summary, input: operationInputShape.fieldsOf(operation.inputSchema) };
    });
  }
  async invoke(id, input) {
    const operation = this.operations.get(id);
    if (operation === void 0) throw new UnknownOperationError(`Unknown operation: ${id}`);
    const parsedInput = operation.inputSchema.safeParse(input);
    if (!parsedInput.success)
      throw new OperationInputError(`Invalid input for ${id}: ${parsedInput.error.message}`);
    if (!this.policy.allows(operation)) {
      return OperationEnvelopeSchema.parse({
        status: "error",
        error: {
          name: "OperationAccessDeniedError",
          message: `Access denied for operation: ${id}`
        }
      });
    }
    try {
      const output = await operation.handler(parsedInput.data);
      const partial = z43.object({
        status: z43.literal("partial"),
        data: z43.unknown(),
        error: z43.object({ name: z43.string().min(1), message: z43.string() })
      }).safeParse(output);
      if (partial.success) {
        const parsedPartial = operation.outputSchema.safeParse(partial.data.data);
        if (!parsedPartial.success)
          throw new OperationOutputError(
            `Invalid partial output for ${id}: ${parsedPartial.error.message}`
          );
        return OperationEnvelopeSchema.parse({
          status: "partial",
          data: parsedPartial.data,
          error: partial.data.error
        });
      }
      const parsedOutput = operation.outputSchema.safeParse(output);
      if (!parsedOutput.success)
        throw new OperationOutputError(`Invalid output for ${id}: ${parsedOutput.error.message}`);
      return OperationEnvelopeSchema.parse({ status: "success", data: parsedOutput.data });
    } catch (error) {
      return OperationEnvelopeSchema.parse({
        status: "error",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
};

// src/operations/tracker-read-operations.ts
import { z as z44 } from "zod";

// src/tasks/epic-boundary/epic-boundary.ts
var TrackerRefFormatter = class {
  format(id) {
    return /^\d+$/.test(id) ? `#${id}` : id;
  }
};
var refs = new TrackerRefFormatter();
var CrossEpicDependencyError = class extends Error {
  name = "CrossEpicDependencyError";
  constructor(props) {
    const ticket = refs.format(props.ticketId);
    const blocker = refs.format(props.blockerId);
    const ticketEpic = refs.format(props.ticketEpic);
    const blockerEpic = refs.format(props.blockerEpic);
    super(
      `refusing to block ${ticket} (epic ${ticketEpic}) on ${blocker} (epic ${blockerEpic}): blocked-by edges stay inside one epic. Move ${ticket} into epic ${blockerEpic}, merge the two tickets, or finish epic ${blockerEpic} before epic ${ticketEpic} starts. If the edge is absolutely necessary, pass --cross-epic-reason "<why>" and it is recorded on ${ticket}.`
    );
  }
};
var EpicBoundaryGuard = class {
  constructor(tracker) {
    this.tracker = tracker;
  }
  tracker;
  async block(request) {
    const reason = this.normalizeReason(request.reason);
    const [ticket, blocker] = await Promise.all([
      this.lookupParent(request.ticketId),
      this.lookupParent(request.blockerId)
    ]);
    const warnings = [ticket.warning, blocker.warning].filter((w) => w !== null);
    const sameEpic = ticket.epic !== null && ticket.epic === blocker.epic;
    const crossEpic = ticket.epic !== null && blocker.epic !== null && ticket.epic !== blocker.epic;
    if (crossEpic && reason === void 0) {
      throw new CrossEpicDependencyError({
        ticketId: request.ticketId,
        ticketEpic: ticket.epic ?? "",
        blockerId: request.blockerId,
        blockerEpic: blocker.epic ?? ""
      });
    }
    await this.tracker.blockTicket(request.ticketId, request.blockerId);
    const reasonRecorded = reason !== void 0 && !sameEpic;
    if (reasonRecorded) await this.recordReason(request, ticket.epic, blocker.epic, reason);
    return {
      ticketEpic: ticket.epic,
      blockerEpic: blocker.epic,
      crossEpic,
      reasonRecorded,
      warnings
    };
  }
  normalizeReason(reason) {
    if (reason === void 0) return void 0;
    const oneLine = reason.replace(/\s+/g, " ").trim();
    if (oneLine === "")
      throw new Error("--cross-epic-reason needs a one-line justification, not an empty string");
    return oneLine;
  }
  async lookupParent(ticketId) {
    try {
      const epic = await this.tracker.getTicketEpicId(ticketId) ?? null;
      if (epic !== null) return { epic, warning: null };
      return {
        epic: null,
        warning: `${refs.format(ticketId)} has no parent epic; the epic-boundary check was skipped`
      };
    } catch (error) {
      return {
        epic: null,
        warning: `could not resolve the parent epic of ${refs.format(ticketId)} (${error instanceof Error ? error.message : String(error)}); the epic-boundary check was skipped`
      };
    }
  }
  /**
   * The reason lands twice: a comment for people reading the ticket, and the
   * ticket's metadata so the plan verbs can show it without reading comments
   * (Jira's ticket read carries none). An identical reason already on record
   * is left alone, so re-running the same link does not repeat the comment.
   */
  async recordReason(request, ticketEpic, blockerEpic, reason) {
    const { ticketId, blockerId } = request;
    const existing = (await this.tracker.getTicket(ticketId)).metadata.crossEpicReasons ?? {};
    if (existing[blockerId] === reason) return;
    const blocker = refs.format(blockerId);
    const blockerPart = blockerEpic === null ? blocker : `${blocker} (epic ${refs.format(blockerEpic)})`;
    const ticketPart = ticketEpic === null ? "" : `, while this ticket is in epic ${refs.format(ticketEpic)}`;
    await this.tracker.addComment(
      ticketId,
      `Cross-epic dependency: blocked by ${blockerPart}${ticketPart}. Reason: ${reason}`
    );
    await this.tracker.updateTicketMetadata(ticketId, {
      crossEpicReasons: { ...existing, [blockerId]: reason }
    });
  }
};
var CrossEpicEdgeFinder = class {
  constructor(tracker) {
    this.tracker = tracker;
  }
  tracker;
  async find(epics) {
    const epicOf = /* @__PURE__ */ new Map();
    for (const epic of epics) for (const ticket of epic.childIssues) epicOf.set(ticket.id, epic.id);
    const external = [
      ...new Set(
        epics.flatMap(
          (epic) => epic.childIssues.flatMap((ticket) => ticket.blockedBy.filter((id) => !epicOf.has(id)))
        )
      )
    ];
    const resolved = await Promise.all(
      external.map(
        async (id) => [id, await this.tracker.getTicketEpicId(id).catch(() => null)]
      )
    );
    for (const [id, epic] of resolved)
      if (epic !== null && epic !== void 0) epicOf.set(id, epic);
    return epics.flatMap(
      (epic) => epic.childIssues.filter((ticket) => ticket.status !== "closed").flatMap(
        (ticket) => ticket.blockedBy.filter((blockerId) => epicOf.get(blockerId) !== epic.id).map((blockerId) => ({
          ticket: ticket.id,
          ticketEpic: epic.id,
          blockedBy: blockerId,
          blockerEpic: epicOf.get(blockerId) ?? null,
          justification: ticket.metadata.crossEpicReasons?.[blockerId] ?? null
        }))
      )
    );
  }
  /** One human-readable warning line per edge, for stderr. */
  warnings(edges) {
    return edges.map((edge) => {
      const blockerEpic = edge.blockerEpic === null ? "epic unknown" : `epic ${refs.format(edge.blockerEpic)}`;
      const why = edge.justification === null ? "no justification recorded" : `justification: ${edge.justification}`;
      return `warning: cross-epic dependency: ${refs.format(edge.ticket)} (epic ${refs.format(edge.ticketEpic)}) is blocked by ${refs.format(edge.blockedBy)} (${blockerEpic}); ${why}`;
    });
  }
};

// src/tasks/dependency-planner/dependency-planner.ts
var DependencyPlannerService = class {
  plan(tickets) {
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const isOpen = (t) => t.status !== "closed";
    const openTickets = tickets.filter(isOpen);
    const waveOf = /* @__PURE__ */ new Map();
    const failed = /* @__PURE__ */ new Set();
    const visiting = /* @__PURE__ */ new Set();
    const computeWave = (id) => {
      if (failed.has(id)) return null;
      if (waveOf.has(id)) return waveOf.get(id) ?? null;
      const ticket = byId.get(id);
      if (ticket === void 0 || !isOpen(ticket)) return -1;
      if (visiting.has(id)) return null;
      visiting.add(id);
      const blockerWaves = ticket.blockedBy.map(computeWave);
      visiting.delete(id);
      if (blockerWaves.some((w) => w === null)) {
        failed.add(id);
        return null;
      }
      const wave = Math.max(-1, ...blockerWaves.filter((w) => w !== null)) + 1;
      waveOf.set(id, wave);
      return wave;
    };
    openTickets.forEach((t) => computeWave(t.id));
    const scheduled = openTickets.filter((t) => waveOf.has(t.id));
    const cycles = openTickets.filter((t) => !waveOf.has(t.id)).map((t) => t.id);
    const maxWave = scheduled.reduce((max, t) => Math.max(max, waveOf.get(t.id) ?? 0), -1);
    const waves = Array.from(
      { length: maxWave + 1 },
      (_, i) => scheduled.filter((t) => waveOf.get(t.id) === i)
    );
    return { waves, cycles };
  }
};

// src/tasks/review-plan/review-plan.ts
var maxSimplePrCount = 4;
var ReviewRouteClassifier = class {
  classify(blocked, defaultBranch) {
    const reasons = [];
    const pullRequests = blocked.flatMap((entry) => entry.pr === null ? [] : [entry.pr]);
    const waveCount = new Set(blocked.map((entry) => entry.wave)).size;
    if (waveCount > 1) {
      reasons.push(`spans more than one wave (${waveCount} waves)`);
    }
    const stacked = pullRequests.filter((pr) => pr.baseRefName !== defaultBranch);
    if (stacked.length > 0) {
      const bases = [...new Set(stacked.map((pr) => pr.baseRefName))].join(", ");
      reasons.push(`stacked base: a PR targets ${bases} instead of ${defaultBranch}`);
    }
    if (pullRequests.length > maxSimplePrCount) {
      reasons.push(`more than ${maxSimplePrCount} PRs (${pullRequests.length} PRs)`);
    }
    return { route: reasons.length > 0 ? "complex" : "simple", reasons };
  }
};
var ReviewPlanService = class {
  classifier = new ReviewRouteClassifier();
  /** Tracker statuses are display names on some trackers, so "In Review" and "in-review" must match. */
  normalizeStatus(status) {
    return status.trim().toLowerCase().replace(/[\s-]+/g, "-");
  }
  isInReview(status, inReviewStatus) {
    const normalized = this.normalizeStatus(status);
    return normalized === "in-review" || inReviewStatus !== void 0 && normalized === this.normalizeStatus(inReviewStatus);
  }
  /** Ids of open tickets in review, in plan order. */
  inReviewTicketIds(plan, inReviewStatus) {
    return plan.waves.flat().filter((t) => this.isInReview(t.status, inReviewStatus)).map((t) => t.id);
  }
  build(input) {
    const titles = new Map(input.tickets.map((ticket) => [ticket.id, ticket.title]));
    const blocked = [];
    const missingPrReasons = [];
    input.plan.waves.forEach((wave, waveIndex) => {
      for (const planned of wave) {
        if (!this.isInReview(planned.status, input.inReviewStatus)) continue;
        const found = input.pullRequests.find((pr) => pr.ticket === planned.id);
        blocked.push({
          ticketId: planned.id,
          title: titles.get(planned.id) ?? "",
          wave: waveIndex,
          blockedBy: planned.blockedBy,
          pr: found === void 0 ? null : { number: found.number, url: found.url, headRefName: found.headRefName, baseRefName: found.baseRefName }
        });
        if (found === void 0) missingPrReasons.push(`ticket ${planned.id} is in review but has no open PR`);
      }
    });
    const missing = blocked.filter((entry) => entry.pr === null).map((entry) => entry.ticketId);
    if (missing.length > 0) {
      return {
        route: "incomplete",
        reasons: missingPrReasons,
        missing,
        blocked,
        unblocksOnMerge: this.unblockedOnMerge(input.plan, blocked)
      };
    }
    const decision = this.classifier.classify(blocked, input.defaultBranch);
    return {
      route: decision.route,
      reasons: decision.reasons,
      missing,
      blocked,
      unblocksOnMerge: this.unblockedOnMerge(input.plan, blocked)
    };
  }
  unblockedOnMerge(plan, blocked) {
    const blockedIds = new Set(blocked.map((entry) => entry.ticketId));
    const openIds = new Set(plan.waves.flat().map((t) => t.id));
    return plan.waves.flat().filter((t) => !blockedIds.has(t.id)).filter((t) => {
      const openBlockers = t.blockedBy.filter((id) => openIds.has(id));
      return openBlockers.some((id) => blockedIds.has(id)) && openBlockers.every((id) => blockedIds.has(id));
    }).map((t) => t.id);
  }
};

// src/tasks/body-sections/body-sections.ts
var headingLine2 = /^##\s+(.+?)\s*$/;
var detailsOpen2 = /^<details/;
var detailsClose2 = /^<\/details>/;
var checklistItem = /^-\s+\[( |x|X)\]\s+(.*)$/;
var fenceLine = /^(`{3,}|~{3,})/;
var layeredHeadingKeys = {
  "Problem Statement": "problemStatement",
  Solution: "solution",
  "Acceptance Criteria": "acceptanceCriteria",
  "High-level technical writeup": "technicalWriteup"
};
var bugReportHeadingKeys = {
  Symptom: "symptom",
  Environment: "environment",
  "Steps To Reproduce": "stepsToReproduce",
  "Expected vs Actual": "expectedVsActual",
  "Root Cause": "rootCause",
  "Fixed When": "fixedWhen",
  Evidence: "evidence"
};
var stringSectionKeys = [
  "problemStatement",
  "solution",
  "acceptanceCriteria",
  "technicalWriteup",
  "guidedWalkthrough",
  "symptom",
  "environment",
  "stepsToReproduce",
  "expectedVsActual",
  "rootCause",
  "fixedWhen",
  "evidence",
  "reproductionNotes"
];
var BlobSectionSource = class {
  read(input) {
    const lines = input.body.replace(/\r\n/g, "\n").split("\n");
    const format = input.format ?? this.sniff(lines);
    const headingKeys = format === "bug-report" ? bugReportHeadingKeys : layeredHeadingKeys;
    const raw = {};
    let current;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const heading = line.match(headingLine2);
      if (heading?.[1] !== void 0) {
        current = headingKeys[heading[1]];
        if (current !== void 0) raw[current] = [];
        i++;
        continue;
      }
      if (detailsOpen2.test(line.trim())) {
        const block = this.consumeDetails(lines, i);
        if (/guided walkthrough/i.test(block.title)) {
          raw.guidedWalkthrough = block.inner.split("\n");
        } else if (/reproduction notes/i.test(block.title)) {
          raw.reproductionNotes = block.inner.split("\n");
        }
        current = void 0;
        i = block.next;
        continue;
      }
      if (current !== void 0) raw[current]?.push(line);
      i++;
    }
    const text = (key) => {
      const joined = (raw[key] ?? []).join("\n").trim();
      return joined.length > 0 ? joined : void 0;
    };
    const sections = {
      format,
      acceptanceCriteriaItems: this.checklistItems(raw.acceptanceCriteria),
      fixedWhenItems: this.checklistItems(raw.fixedWhen)
    };
    for (const key of stringSectionKeys) {
      const value = text(key);
      if (value !== void 0) sections[key] = value;
    }
    return sections;
  }
  /**
   * Classifies the body from its FIRST top-level `##` heading, not from any
   * occurrence anywhere: a bug report leads with `## Symptom`, a layered body
   * with `## Problem Statement`. A `## Symptom` buried inside a fenced code
   * block or a `<details>` block (e.g. the Guided Walkthrough) must not flip a
   * layered body to `bug-report`, so both are skipped exactly as the section
   * parser skips them — details via `consumeDetails`, fences by tracking the
   * open marker.
   */
  sniff(lines) {
    let i = 0;
    let openFence;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      if (openFence !== void 0) {
        if (trimmed.startsWith(openFence)) openFence = void 0;
        i++;
        continue;
      }
      const fence = trimmed.match(fenceLine);
      if (fence?.[1] !== void 0) {
        openFence = fence[1];
        i++;
        continue;
      }
      if (detailsOpen2.test(trimmed)) {
        i = this.consumeDetails(lines, i).next;
        continue;
      }
      const heading = line.match(headingLine2);
      if (heading?.[1] !== void 0) return heading[1] === "Symptom" ? "bug-report" : "layered-body";
      i++;
    }
    return "layered-body";
  }
  checklistItems(lines) {
    return (lines ?? []).map((item) => item.match(checklistItem)).filter((match) => match !== null).map((match) => ({ text: (match[2] ?? "").trim(), done: match[1]?.toLowerCase() === "x" }));
  }
  consumeDetails(lines, start) {
    let depth = 0;
    let end = lines.length - 1;
    for (let j = start; j < lines.length; j++) {
      const trimmed = (lines[j] ?? "").trim();
      if (detailsOpen2.test(trimmed)) depth++;
      if (detailsClose2.test(trimmed)) depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
    const block = lines.slice(start, end + 1).join("\n");
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const title = summary?.[1]?.trim() ?? "";
    const afterSummary = block.indexOf("</summary>");
    const withoutHead = afterSummary !== -1 ? block.slice(afterSummary + "</summary>".length) : block.replace(detailsOpen2, "");
    const inner = withoutHead.replace(/<\/details>\s*$/, "").trim();
    return { title, inner, next: end + 1 };
  }
};
var blobSectionSource = new BlobSectionSource();
var sectionFields = {
  "problem-statement": "problemStatement",
  solution: "solution",
  "acceptance-criteria": "acceptanceCriteria",
  "technical-writeup": "technicalWriteup",
  "guided-walkthrough": "guidedWalkthrough",
  symptom: "symptom",
  environment: "environment",
  "steps-to-reproduce": "stepsToReproduce",
  "expected-vs-actual": "expectedVsActual",
  "root-cause": "rootCause",
  "fixed-when": "fixedWhen",
  evidence: "evidence",
  "reproduction-notes": "reproductionNotes"
};
var BodySectionSelector = class {
  select(id, sections, slug) {
    const field = sectionFields[slug];
    if (field === void 0) {
      throw new Error(`unknown section "${slug}" \u2014 expected one of: ${Object.keys(sectionFields).join(", ")}`);
    }
    return {
      id,
      section: slug,
      format: sections.format,
      markdown: sections[field] ?? null,
      ...field === "acceptanceCriteria" ? { items: sections.acceptanceCriteriaItems } : {},
      ...field === "fixedWhen" ? { items: sections.fixedWhenItems } : {}
    };
  }
};
var sectionSelector = new BodySectionSelector();

// src/tasks/body-sections/body-format-detector.ts
var placeholderIssueTypes = ["unknown", "issue"];
var PrecedenceBodyFormatDetector = class {
  detect(input) {
    const { body, metadata, issueType } = input;
    if (metadata.kind === "bug") return "bug-report";
    if (metadata.kind === "story") return "layered-body";
    const explicitType = this.explicitIssueType(issueType);
    if (explicitType === "bug") return "bug-report";
    if (explicitType !== void 0) return "layered-body";
    return blobSectionSource.read({ body }).format;
  }
  /** The lower-cased issue type, or `undefined` when absent or a tracker placeholder. */
  explicitIssueType(issueType) {
    if (issueType === void 0) return void 0;
    const lowered = issueType.toLowerCase();
    return placeholderIssueTypes.includes(lowered) ? void 0 : lowered;
  }
};
var bodyFormatDetector = new PrecedenceBodyFormatDetector();

// src/operations/tracker-read-operations.ts
var propsSchema = z44.object({
  getTracker: z44.custom((value) => typeof value === "function"),
  getPrHost: z44.custom((value) => typeof value === "function").optional(),
  getConfig: z44.custom((value) => typeof value === "function").optional()
});
var sectionNames = [
  "problem-statement",
  "solution",
  "acceptance-criteria",
  "technical-writeup",
  "guided-walkthrough",
  "symptom",
  "environment",
  "steps-to-reproduce",
  "expected-vs-actual",
  "root-cause",
  "fixed-when",
  "evidence",
  "reproduction-notes"
];
var sectionNameSet = new Set(sectionNames);
var sectionName = z44.string().refine(
  (value) => sectionNameSet.has(value),
  `unknown section \u2014 expected one of: ${sectionNames.join(", ")}`
);
var entityInput = z44.strictObject({ id: z44.string().min(1) });
var ticketInput = entityInput.extend({
  section: sectionName.optional()
});
var ticketResult = TicketSchema.passthrough();
var epicResult = EpicSchema.extend({ childIssues: z44.array(ticketResult) }).passthrough();
var initiativeResult = InitiativeSchema.extend({
  epics: z44.array(z44.object({ id: z44.string(), title: z44.string() }).passthrough())
}).passthrough();
var tddResult = TechnicalDesignSchema.passthrough();
var sectionResult = z44.object({
  id: z44.string(),
  section: z44.string(),
  format: z44.enum(["layered-body", "bug-report"]),
  markdown: z44.string().nullable(),
  items: z44.array(z44.object({ text: z44.string(), done: z44.boolean() })).optional()
});
var edgeResult = z44.object({
  ticket: z44.string(),
  ticketEpic: z44.string(),
  blockedBy: z44.string(),
  blockerEpic: z44.string().nullable(),
  justification: z44.string().nullable()
});
var planTicket = z44.object({
  id: z44.string(),
  status: z44.string(),
  blockedBy: z44.array(z44.string()),
  epicId: z44.string().optional()
});
var dependencyPlan = z44.object({
  waves: z44.array(z44.array(planTicket)),
  cycles: z44.array(z44.string())
});
var TrackerDependencyPlanSchema = dependencyPlan.extend({
  crossEpicEdges: z44.array(edgeResult),
  warnings: z44.array(z44.string())
});
var TrackerReviewPlanSchema = z44.object({
  epic: z44.object({ id: z44.string(), title: z44.string() }).optional(),
  initiative: z44.object({ id: z44.string(), title: z44.string() }).optional(),
  defaultBranch: z44.string(),
  route: z44.enum(["simple", "complex", "incomplete"]),
  reasons: z44.array(z44.string()),
  missing: z44.array(z44.string()),
  blocked: z44.array(
    z44.object({
      ticketId: z44.string(),
      title: z44.string(),
      wave: z44.number(),
      blockedBy: z44.array(z44.string()),
      pr: z44.object({
        number: z44.number(),
        url: z44.string(),
        headRefName: z44.string(),
        baseRefName: z44.string()
      }).nullable()
    })
  ),
  unblocksOnMerge: z44.array(z44.string()),
  crossEpicEdges: z44.array(edgeResult),
  warnings: z44.array(z44.string()),
  cycles: z44.array(z44.string())
});
var DefaultTrackerReadOperations = class {
  props;
  constructor(props) {
    this.props = propsSchema.parse(props);
  }
  operations() {
    return [
      this.descriptor(
        "ticket-get",
        "Read a ticket and optionally select one body section.",
        ["read", "network"],
        ["ticket", "get"],
        ticketInput,
        z44.union([ticketResult, sectionResult]),
        (input) => this.getTicket(input)
      ),
      this.descriptor(
        "ticket-transitions",
        "List available status transitions for a ticket.",
        ["read", "network"],
        ["ticket", "transitions"],
        entityInput,
        z44.object({ id: z44.string(), transitions: z44.array(z44.string()) }),
        async ({ id }) => ({ id, transitions: await this.props.getTracker().listTransitions(id) })
      ),
      this.descriptor(
        "users-get",
        "List users available for tracker assignment.",
        ["read", "network"],
        ["users", "get"],
        z44.strictObject({}),
        z44.array(TrackerUserSchema.passthrough()),
        () => this.props.getTracker().getUsers()
      ),
      this.descriptor(
        "tdd-get",
        "Read a technical design by its tracker identifier.",
        ["read", "network"],
        ["tdd", "get"],
        entityInput,
        tddResult,
        ({ id }) => this.props.getTracker().getTechnicalDesign(id)
      ),
      this.descriptor(
        "epic-get",
        "Read an epic and its tracker fields.",
        ["read", "network"],
        ["epic", "get"],
        entityInput,
        epicResult,
        ({ id }) => this.props.getTracker().getEpic(id)
      ),
      this.descriptor(
        "initiative-get",
        "Read an initiative and its linked epics.",
        ["read", "network"],
        ["initiative", "get"],
        entityInput,
        initiativeResult,
        ({ id }) => this.props.getTracker().getInitiative(id)
      ),
      this.descriptor(
        "epic-plan",
        "Plan dependency waves and cross-epic edges for an epic.",
        ["read", "network", "process"],
        ["epic", "plan"],
        entityInput,
        TrackerDependencyPlanSchema,
        ({ id }) => this.planEpic(id)
      ),
      this.descriptor(
        "epic-review-plan",
        "Build the review hand-off for an epic's open pull requests.",
        ["read", "network", "process"],
        ["epic", "review-plan"],
        entityInput,
        TrackerReviewPlanSchema,
        ({ id }) => this.reviewEpic(id)
      ),
      this.descriptor(
        "initiative-plan",
        "Plan dependency waves across every epic in an initiative.",
        ["read", "network", "process"],
        ["initiative", "plan"],
        entityInput,
        TrackerDependencyPlanSchema,
        ({ id }) => this.planInitiative(id)
      ),
      this.descriptor(
        "initiative-review-plan",
        "Build the review hand-off across an initiative's epics.",
        ["read", "network", "process"],
        ["initiative", "review-plan"],
        entityInput,
        TrackerReviewPlanSchema,
        ({ id }) => this.reviewInitiative(id)
      )
    ];
  }
  registry() {
    return new MapOperationRegistry({
      operations: this.operations(),
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network", "process"] })
    });
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler
    };
  }
  async getTicket(input) {
    const ticket = await this.props.getTracker().getTicket(input.id);
    if (input.section === void 0) return ticket;
    const format = bodyFormatDetector.detect({
      body: ticket.body,
      metadata: ticket.metadata,
      issueType: ticket.issueType
    });
    return sectionSelector.select(
      input.id,
      blobSectionSource.read({ body: ticket.body, format }),
      input.section
    );
  }
  async planEpic(id) {
    const tracker = this.props.getTracker();
    const epic = await tracker.getEpic(id);
    const plan = new DependencyPlannerService().plan(this.plannerTickets(epic.childIssues));
    const edges = new CrossEpicEdgeFinder(tracker);
    const crossEpicEdges = await edges.find([epic]);
    return { ...plan, crossEpicEdges, warnings: edges.warnings(crossEpicEdges) };
  }
  async planInitiative(id) {
    const tracker = this.props.getTracker();
    const initiative = await tracker.getInitiative(id);
    const epics = await Promise.all(initiative.epics.map((epic) => tracker.getEpic(epic.id)));
    const tickets = epics.flatMap(
      (epic) => epic.childIssues.map((ticket) => ({ ticket, epicId: epic.id }))
    );
    const plan = new DependencyPlannerService().plan(
      tickets.map(({ ticket, epicId }) => ({
        id: ticket.id,
        status: ticket.status,
        blockedBy: ticket.blockedBy,
        epicId
      }))
    );
    const edges = new CrossEpicEdgeFinder(tracker);
    const crossEpicEdges = await edges.find(epics);
    return { ...plan, crossEpicEdges, warnings: edges.warnings(crossEpicEdges) };
  }
  async reviewEpic(id) {
    const tracker = this.props.getTracker();
    const epic = await tracker.getEpic(id);
    return this.reviewPlan({ epic, epics: [epic] });
  }
  async reviewInitiative(id) {
    const tracker = this.props.getTracker();
    const initiative = await tracker.getInitiative(id);
    const epics = await Promise.all(initiative.epics.map((epic) => tracker.getEpic(epic.id)));
    return this.reviewPlan({ initiative, epics });
  }
  async reviewPlan(input) {
    const tracker = this.props.getTracker();
    const tickets = input.epics.flatMap((epic) => epic.childIssues);
    const plan = new DependencyPlannerService().plan(this.plannerTickets(tickets));
    const { inReviewStatus } = this.props.getConfig?.() ?? {};
    const service = new ReviewPlanService();
    const ids = service.inReviewTicketIds(plan, inReviewStatus);
    const host = this.props.getPrHost?.();
    if (host === void 0)
      throw new PullRequestHostUnavailableError(
        "pull request host is unavailable for review planning"
      );
    const pullRequests = ids.length > 0 ? await host.listOpenPullRequestsForTickets(ids) : [];
    const defaultBranch = await host.defaultBranch();
    const result = service.build({ plan, tickets, pullRequests, defaultBranch, inReviewStatus });
    const edges = new CrossEpicEdgeFinder(tracker);
    const crossEpicEdges = await edges.find(input.epics);
    return {
      ...input.epic === void 0 ? {} : { epic: { id: input.epic.id, title: input.epic.title } },
      ...input.initiative === void 0 ? {} : { initiative: input.initiative },
      defaultBranch,
      ...result,
      crossEpicEdges,
      warnings: edges.warnings(crossEpicEdges),
      cycles: plan.cycles
    };
  }
  plannerTickets(tickets) {
    return tickets.map((ticket) => ({
      id: ticket.id,
      status: ticket.status,
      blockedBy: ticket.blockedBy
    }));
  }
};
var PullRequestHostUnavailableError = class extends Error {
  name = "PullRequestHostUnavailableError";
};

// src/operations/ticket-lifecycle-operations.ts
import { existsSync as existsSync9, realpathSync as realpathSync6, statSync as statSync4 } from "node:fs";
import { isAbsolute as isAbsolute4, relative as relative4, resolve as resolve8 } from "node:path";
import { z as z45 } from "zod";
var propsSchema2 = z45.object({
  getTracker: z45.custom((value) => typeof value === "function"),
  cwd: z45.string().min(1),
  trustedRoots: z45.array(z45.string().min(1)).default([])
});
var idSchema = z45.string().min(1);
var blockInput = z45.object({ ticketId: idSchema, blockerId: idSchema, reason: z45.string().optional() }).strict();
var ticketPairInput = z45.object({ ticketId: idSchema, blockerId: idSchema }).strict();
var statusInput = z45.object({ id: idSchema, status: z45.string().min(1) }).strict();
var commentInput = z45.object({
  id: idSchema,
  body: z45.string(),
  attach: z45.array(z45.string().min(1)).default([])
}).strict();
var labelInput = z45.object({
  id: idSchema,
  add: z45.array(z45.string()).default([]),
  remove: z45.array(z45.string()).default([])
}).strict().refine((input) => input.add.length > 0 || input.remove.length > 0, {
  message: "ticket label needs at least one --add or --remove"
});
var blockResult = z45.object({
  ticketId: idSchema,
  blockerId: idSchema,
  ticketEpic: idSchema.nullable(),
  blockerEpic: idSchema.nullable(),
  crossEpic: z45.boolean(),
  reasonRecorded: z45.boolean(),
  warnings: z45.array(z45.string())
});
var blockPartial = z45.object({
  ticketId: idSchema,
  blockerId: idSchema,
  completedSteps: z45.array(z45.string())
});
var ticketPairResult = z45.object({ ticketId: idSchema, blockerId: idSchema });
var statusResult = z45.object({ id: idSchema, status: z45.string() });
var commentPartial = z45.object({
  id: idSchema,
  attachments: z45.array(
    AttachmentSchema.extend({ path: z45.string(), caption: z45.string(), referenced: z45.boolean() })
  ),
  body: z45.string(),
  completedSteps: z45.array(z45.string())
});
var commentResult = z45.union([CommentSchema, commentPartial]);
var labelResult = z45.object({
  id: idSchema,
  added: z45.array(z45.string()),
  removed: z45.array(z45.string())
});
var labelPartial = z45.object({
  id: idSchema,
  added: z45.array(z45.string()),
  removed: z45.array(z45.string()),
  requestedAdd: z45.array(z45.string()),
  requestedRemove: z45.array(z45.string()),
  completedSteps: z45.array(z45.string())
});
var DefaultTicketLifecycleOperations = class {
  props;
  roots;
  constructor(props) {
    this.props = propsSchema2.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync6(root)))];
  }
  operations() {
    return [
      this.descriptor(
        "ticket-block",
        "Block a ticket with an epic-boundary justification when needed.",
        ["write", "network"],
        ["ticket", "block"],
        blockInput,
        z45.union([blockResult, blockPartial]),
        (input) => this.block(input)
      ),
      this.descriptor(
        "ticket-unblock",
        "Remove a blocked-by relationship from a ticket.",
        ["write", "network"],
        ["ticket", "unblock"],
        ticketPairInput,
        ticketPairResult,
        (input) => this.unblock(input)
      ),
      this.descriptor(
        "ticket-status",
        "Transition a ticket to a supported tracker status.",
        ["write", "network"],
        ["ticket", "status"],
        statusInput,
        statusResult,
        (input) => this.transition(input)
      ),
      this.descriptor(
        "ticket-comment",
        "Add a ticket comment with trusted evidence attachments.",
        ["write", "network"],
        ["ticket", "comment"],
        commentInput,
        commentResult,
        (input) => this.comment(input)
      ),
      this.descriptor(
        "ticket-label",
        "Remove and add ticket labels in safe order.",
        ["write", "network"],
        ["ticket", "label"],
        labelInput,
        z45.union([labelPartial, labelResult]),
        (input) => this.updateLabels(input)
      )
    ];
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler
    };
  }
  async block(input) {
    const completedSteps = [];
    const tracker = this.props.getTracker();
    const observed = {
      getTicketEpicId: (ticketId) => tracker.getTicketEpicId(ticketId),
      blockTicket: async (ticketId, blockerId) => {
        await tracker.blockTicket(ticketId, blockerId);
        completedSteps.push("blocked-by-linked");
      },
      getTicket: (ticketId) => tracker.getTicket(ticketId),
      addComment: async (ticketId, body) => {
        const result = await tracker.addComment(ticketId, body);
        completedSteps.push("reason-commented");
        return result;
      },
      updateTicketMetadata: async (ticketId, patch) => {
        await tracker.updateTicketMetadata(ticketId, patch);
        completedSteps.push("reason-recorded");
      }
    };
    try {
      const outcome = await new EpicBoundaryGuard(observed).block(input);
      return {
        ticketId: input.ticketId,
        blockerId: input.blockerId,
        ...outcome
      };
    } catch (error) {
      if (completedSteps.length === 0) throw error;
      return {
        status: "partial",
        data: {
          ticketId: input.ticketId,
          blockerId: input.blockerId,
          completedSteps
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  async unblock(input) {
    await this.props.getTracker().unblockTicket(input.ticketId, input.blockerId);
    return input;
  }
  async transition(input) {
    await this.props.getTracker().transitionTicket(input.id, input.status);
    return input;
  }
  async comment(input) {
    const tracker = this.props.getTracker();
    const safeSpecs = input.attach.map((spec) => {
      const parsed = AttachmentSpecSchema.parse(spec);
      return `${this.trustedFilePath(parsed.path)}#${parsed.caption}`;
    });
    const evidence = new TrackerEvidenceService({ tracker });
    let body = input.body;
    let attachments = [];
    if (safeSpecs.length > 0) {
      try {
        const attached = await evidence.attach({ ticketId: input.id, body, specs: safeSpecs });
        body = attached.body;
        attachments = attached.attachments;
      } catch (error) {
        if (!(error instanceof EvidenceUploadFailure) || error.attachments.length === 0)
          throw error;
        const rewritten = evidence.prepareBody({
          body,
          specs: error.attachments.map((attachment) => `${attachment.path}#${attachment.caption}`)
        });
        return {
          status: "partial",
          data: {
            id: input.id,
            attachments: error.attachments,
            body: rewritten,
            completedSteps: error.attachments.map(
              (attachment) => `attachment-uploaded:${attachment.id}`
            )
          },
          error: {
            name: error.cause instanceof Error ? error.cause.name : "Error",
            message: error.cause instanceof Error ? error.cause.message : String(error.cause)
          }
        };
      }
    }
    try {
      return await tracker.addComment(input.id, body);
    } catch (error) {
      if (attachments.length === 0) throw error;
      return {
        status: "partial",
        data: {
          id: input.id,
          attachments,
          body,
          completedSteps: [
            "attachments-uploaded",
            ...attachments.map((attachment) => `attachment-uploaded:${attachment.id}`)
          ]
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  async updateLabels(input) {
    const tracker = this.props.getTracker();
    const completedSteps = [];
    const added = [];
    const removed = [];
    try {
      for (const label of input.remove) {
        await tracker.removeLabel(input.id, label);
        removed.push(label);
        completedSteps.push(`removed:${label}`);
      }
      for (const label of input.add) {
        await tracker.addLabel(input.id, label);
        added.push(label);
        completedSteps.push(`added:${label}`);
      }
      return { id: input.id, added: input.add, removed: input.remove };
    } catch (error) {
      if (completedSteps.length === 0) throw error;
      return {
        status: "partial",
        data: {
          id: input.id,
          added,
          removed,
          requestedAdd: input.add,
          requestedRemove: input.remove,
          completedSteps
        },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  trustedFilePath(path) {
    const absolute = isAbsolute4(path) ? path : resolve8(this.props.cwd, path);
    if (!existsSync9(absolute)) throw new Error(`Attachment file does not exist: ${path}`);
    const realPath = realpathSync6(absolute);
    const stat = statSync4(realPath);
    const contained = this.roots.some((root) => {
      const fromRoot = relative4(root, realPath);
      return fromRoot === "" || !fromRoot.startsWith("..") && !isAbsolute4(fromRoot);
    });
    if (!contained || !stat.isFile())
      throw new Error(`Attachment file is outside trusted roots: ${path}`);
    return realPath;
  }
};

// src/operations/tracker-entity-operations.ts
var labelListSchema = z46.array(z46.string()).transform((labels) => [...new Set(labels.map((label) => label.trim()).filter(Boolean))]);
var labelsSchema = labelListSchema.default([]);
var createEpicInput = z46.object({
  ...CreateEpicInputSchema.shape,
  labels: labelsSchema,
  allowLocalPaths: z46.boolean().default(false)
}).strict();
var updateEpicInput = z46.object({
  ...UpdateEpicInputSchema.shape,
  labels: labelListSchema.optional(),
  allowLocalPaths: z46.boolean().default(false)
}).strict();
var createInitiativeInput = CreateInitiativeInputSchema.extend({
  allowLocalPaths: z46.boolean().default(false)
}).strict();
var updateInitiativeInput = UpdateInitiativeInputSchema.extend({
  allowLocalPaths: z46.boolean().default(false)
}).strict();
var createTicketInput = z46.object({
  ...CreateTicketInputSchema.shape,
  labels: labelsSchema,
  allowLocalPaths: z46.boolean().default(false)
}).strict();
var updateTicketInput = z46.object({
  ...UpdateTicketInputSchema.shape,
  labels: labelListSchema.optional(),
  allowLocalPaths: z46.boolean().default(false),
  attach: z46.array(z46.string().min(1)).default([])
}).strict();
var createTddInput = CreateTechnicalDesignInputSchema.extend({
  allowLocalPaths: z46.boolean().default(false)
}).strict();
var entityId = z46.string().min(1);
var linkInput = z46.object({ epicId: entityId, initiativeId: entityId }).strict();
var partialTicketEdit = z46.object({
  id: entityId,
  attachments: z46.array(AttachmentSchema),
  body: z46.string()
});
var ticketEditResult = z46.union([TicketSchema, partialTicketEdit]);
var partialTicketCreate = z46.object({ id: entityId, title: z46.string() });
var ticketCreateResult = z46.union([TicketSchema, partialTicketCreate]);
var partialEntityWrite = z46.object({
  id: entityId,
  title: z46.string().optional(),
  body: z46.string().optional()
});
var partialTddCreate = z46.object({ id: entityId, epicId: entityId, body: z46.string() });
var propsSchema3 = z46.object({
  getTracker: z46.custom((value) => typeof value === "function"),
  getPrHost: z46.custom((value) => typeof value === "function").optional(),
  getConfig: z46.custom((value) => typeof value === "function").optional(),
  cwd: z46.string().min(1),
  trustedRoots: z46.array(z46.string().min(1)).default([])
});
var DefaultTrackerEntityOperations = class {
  props;
  roots;
  constructor(props) {
    this.props = propsSchema3.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync7(root)))];
  }
  operations() {
    return [
      ...new DefaultTrackerReadOperations({
        getTracker: this.props.getTracker,
        ...this.props.getPrHost === void 0 ? {} : { getPrHost: this.props.getPrHost },
        ...this.props.getConfig === void 0 ? {} : { getConfig: this.props.getConfig }
      }).operations(),
      ...new DefaultTicketLifecycleOperations({
        getTracker: this.props.getTracker,
        cwd: this.props.cwd,
        trustedRoots: this.props.trustedRoots
      }).operations(),
      this.descriptor(
        "epic-create",
        "Create an epic with portable context and labels.",
        ["write", "network"],
        ["epic", "create"],
        createEpicInput,
        z46.union([EpicSchema, partialEntityWrite]),
        (input) => this.createEpic(input)
      ),
      this.descriptor(
        "epic-edit",
        "Update an epic description, title, or labels.",
        ["write", "network"],
        ["epic", "edit"],
        z46.object({ id: entityId, ...updateEpicInput.shape }).strict(),
        z46.union([EpicSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editEpic(id, input)
      ),
      this.descriptor(
        "epic-link-initiative",
        "Link an epic to an initiative.",
        ["write", "network"],
        ["epic", "link-initiative"],
        linkInput,
        z46.object({ epicId: entityId, initiativeId: entityId }),
        async ({ epicId, initiativeId }) => {
          await this.props.getTracker().linkEpicToInitiative(epicId, initiativeId);
          return { epicId, initiativeId };
        }
      ),
      this.descriptor(
        "initiative-create",
        "Create an initiative with portable context.",
        ["write", "network"],
        ["initiative", "create"],
        createInitiativeInput,
        z46.union([InitiativeSchema, partialEntityWrite]),
        (input) => this.createInitiative(input)
      ),
      this.descriptor(
        "initiative-edit",
        "Update an initiative description or title.",
        ["write", "network"],
        ["initiative", "edit"],
        z46.object({ id: entityId, ...updateInitiativeInput.shape }).strict(),
        z46.union([InitiativeSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editInitiative(id, input)
      ),
      this.descriptor(
        "ticket-create",
        "Create a ticket with its parent, labels, and assignee.",
        ["write", "network"],
        ["ticket", "create"],
        createTicketInput,
        ticketCreateResult,
        (input) => this.createTicket(input)
      ),
      this.descriptor(
        "ticket-edit",
        "Update a ticket and attach local evidence files.",
        ["write", "network"],
        ["ticket", "edit"],
        z46.object({ id: entityId, ...updateTicketInput.shape }).strict(),
        ticketEditResult,
        ({ id, ...input }) => this.editTicket(id, input)
      ),
      this.descriptor(
        "tdd-create",
        "Create a technical design under its parent epic.",
        ["write", "network"],
        ["tdd", "create"],
        createTddInput,
        z46.union([TechnicalDesignSchema, partialTddCreate]),
        (input) => this.createTdd(input)
      )
    ];
  }
  registry(policy) {
    return new MapOperationRegistry({
      operations: this.operations(),
      policy: policy ?? new LaunchOperationAccessPolicy({ allowedEffects: ["read", "network", "process"] })
    });
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler
    };
  }
  async createEpic(input) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateEpicInputSchema.parse(input);
    try {
      return await this.props.getTracker().createEpic(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial",
        data: { id: error.id, title: fields.title, body: fields.body },
        error: { name: error.name, message: error.message }
      };
    }
  }
  async editEpic(id, input) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = UpdateEpicInputSchema.parse(input);
    try {
      return await this.props.getTracker().updateEpicDescription(id, fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial",
        data: {
          id,
          ...fields.title === void 0 ? {} : { title: fields.title },
          body: fields.body
        },
        error: { name: error.name, message: error.message }
      };
    }
  }
  async createInitiative(input) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateInitiativeInputSchema.parse(input);
    try {
      return await this.props.getTracker().createInitiative(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial",
        data: { id: error.id, title: fields.title, body: fields.body },
        error: { name: error.name, message: error.message }
      };
    }
  }
  async editInitiative(id, input) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = UpdateInitiativeInputSchema.parse(input);
    try {
      return await this.props.getTracker().updateInitiativeDescription(id, fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial",
        data: {
          id,
          ...fields.title === void 0 ? {} : { title: fields.title },
          body: fields.body
        },
        error: { name: error.name, message: error.message }
      };
    }
  }
  async createTicket(input) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateTicketInputSchema.parse(input);
    try {
      return await this.props.getTracker().createTicket(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial",
        data: { id: error.id, title: fields.title },
        error: { name: error.name, message: error.message }
      };
    }
  }
  async editTicket(id, input) {
    const specs = input.attach;
    const safeSpecs = specs.map((spec) => {
      const parsed = AttachmentSpecSchema.parse(spec);
      return `${this.trustedFilePath(parsed.path)}#${parsed.caption}`;
    });
    const tracker = this.props.getTracker();
    const evidence = new TrackerEvidenceService({ tracker });
    let body = input.body;
    let attachments = [];
    if (safeSpecs.length > 0) {
      body = evidence.prepareBody({ body, specs: safeSpecs });
      this.assertPortable(body, input.allowLocalPaths);
      try {
        const result = await evidence.attach({
          ticketId: id,
          body: input.body,
          specs: safeSpecs
        });
        body = result.body;
        attachments = result.attachments;
      } catch (error) {
        if (!(error instanceof EvidenceUploadFailure) || error.attachments.length === 0) {
          if (error instanceof EvidenceUploadFailure) throw error.cause;
          throw error;
        }
        return {
          status: "partial",
          data: { id, attachments: error.attachments, body: input.body },
          error: {
            name: error.cause instanceof Error ? error.cause.name : "Error",
            message: error.cause instanceof Error ? error.cause.message : String(error.cause)
          }
        };
      }
    } else {
      this.assertPortable(body, input.allowLocalPaths);
    }
    try {
      const fields = UpdateTicketInputSchema.parse(input);
      return await tracker.updateTicketDescription(id, { ...fields, body });
    } catch (error) {
      if (attachments.length === 0 && !TaskTrackerPartialWriteError.isPartialWrite(error))
        throw error;
      return {
        status: "partial",
        data: { id, attachments, body },
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
  async createTdd(input) {
    this.assertPortable(input.body, input.allowLocalPaths);
    const fields = CreateTechnicalDesignInputSchema.parse(input);
    try {
      return await this.props.getTracker().createTechnicalDesign(fields);
    } catch (error) {
      if (!TaskTrackerPartialWriteError.isPartialWrite(error)) throw error;
      return {
        status: "partial",
        data: { id: error.id, epicId: fields.epicId, body: fields.body },
        error: { name: error.name, message: error.message }
      };
    }
  }
  assertPortable(body, allowLocalPaths = false) {
    portableContextGuard.assertPortable(body, { allowLocalPaths });
  }
  trustedFilePath(path) {
    const absolute = isAbsolute5(path) ? path : resolve9(this.props.cwd, path);
    if (!existsSync10(absolute)) throw new Error(`Attachment file does not exist: ${path}`);
    const realPath = realpathSync7(absolute);
    const stat = statSync5(realPath);
    const contained = this.roots.some((root) => {
      const fromRoot = relative5(root, realPath);
      return fromRoot === "" || !fromRoot.startsWith("..") && !isAbsolute5(fromRoot);
    });
    if (!contained || !stat.isFile())
      throw new Error(`Attachment file is outside trusted roots: ${path}`);
    return realPath;
  }
};

// src/flight-rules/flight-rules.ts
var DefaultFlightRules = class {
  cwd;
  env;
  launchEnv;
  gitEnv;
  explicitConfigPath;
  hostSettings;
  host;
  configWritePolicy;
  untrackedRoot;
  constructor(props = {}) {
    const parsed = FlightRulesPropsSchema.parse({
      ...props,
      env: props.env === void 0 ? void 0 : { ...props.env }
    });
    this.cwd = resolve10(parsed.cwd ?? process.cwd());
    this.env = props.env ?? process.env;
    this.launchEnv = { ...props.env ?? process.env };
    this.gitEnv = { ...props.env ?? process.env };
    this.explicitConfigPath = parsed.configPath;
    this.hostSettings = props.hostSettings;
    this.host = parsed.host;
    this.configWritePolicy = parsed.configWritePolicy;
  }
  configPath() {
    return this.configStore().filePath();
  }
  configStore() {
    const env = this.explicitConfigPath === void 0 ? this.env : { ...this.env, FLIGHT_RULES_CONFIG: this.explicitConfigPath };
    const untrackedRoot = this.mainCheckout();
    return new ConfigStore({
      cwd: this.cwd,
      env,
      host: NativeHostSchema.parse(
        this.host ?? env["FLIGHT_RULES_HOST"] ?? this.installation().host() ?? "claude"
      ),
      ...this.hostSettings !== void 0 ? { hostSettings: this.hostSettings } : {},
      ...untrackedRoot !== void 0 ? { untrackedRoot } : {}
    });
  }
  installation() {
    return FileNativeInstallation.fromInstall({
      moduleUrl: import.meta.url,
      cwd: this.cwd,
      env: this.env
    });
  }
  /** Looked up once per instance. */
  mainCheckout() {
    this.untrackedRoot ??= { value: new WorktreeLocator().mainCheckoutFor(this.cwd) };
    return this.untrackedRoot.value;
  }
  evidence() {
    return new EvidenceLocation({ cwd: this.cwd, mainCheckout: this.mainCheckout() });
  }
  config(overrideTracker) {
    const config = this.configStore().load();
    if (overrideTracker === void 0) return config;
    if (overrideTracker !== "github" && overrideTracker !== "jira") {
      throw new Error(`Invalid --tracker "${overrideTracker}" \u2014 expected "github" or "jira"`);
    }
    return { ...config, tracker: overrideTracker };
  }
  tracker(overrideTracker) {
    const config = this.config(overrideTracker);
    const env = new EnvLoader().load(this.env);
    if (config.tracker === "github") {
      if (env.githubToken === void 0)
        throw new Error("GITHUB_TOKEN environment variable is required");
      if (config.repo === void 0) throw new Error("repo is required when tracker is github");
      const [owner, repo] = config.repo.split("/");
      if (owner === void 0 || repo === void 0) {
        throw new Error(`Invalid repo format "${config.repo}" \u2014 expected "owner/repo"`);
      }
      return new GitHubTaskTracker({ token: env.githubToken, owner, repo });
    }
    if (env.jiraToken === void 0) {
      throw new Error(
        "JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY) environment variable is required"
      );
    }
    const email = env.jiraEmail ?? config.jiraEmail;
    if (email === void 0)
      throw new Error("JIRA_EMAIL environment variable or jiraEmail config is required");
    const host = env.jiraHost ?? config.jiraHost;
    if (host === void 0)
      throw new Error("JIRA_HOST environment variable or jiraHost config is required");
    if (config.jiraProject === void 0)
      throw new Error("jiraProject is required when tracker is jira");
    return new JiraTaskTracker({
      token: env.jiraToken,
      host,
      email,
      project: config.jiraProject,
      ...config.jpdProject !== void 0 ? { jpdProject: config.jpdProject } : {},
      ...config.confluenceSpaceKey !== void 0 ? { confluenceSpaceKey: config.confluenceSpaceKey } : {}
    });
  }
  prHost(overrideTracker) {
    const config = this.config(overrideTracker);
    if (config.repo === void 0) {
      throw new Error("repo (owner/repo) is required in config to create pull requests");
    }
    return new GhPullRequestHost({ repo: config.repo, cwd: this.cwd, env: this.launchEnv });
  }
  git() {
    return new NodeGitExecutor({ cwd: this.cwd, env: this.gitEnv });
  }
  gitConfigOperations(policy) {
    return new DefaultGitConfigOperations({
      cwd: this.cwd,
      configStore: this.configStore(),
      git: this.git(),
      agentEnv: this.gitEnv["AI_AGENT"],
      configPolicy: policy ?? this.configWritePolicy
    });
  }
  probe() {
    return new NodeToolProbe({ cwd: this.cwd, env: this.env });
  }
  readiness() {
    return new NodeRepositoryReadiness({ cwd: this.cwd, env: this.env });
  }
  docs() {
    return FileDocResolver.fromInstall({ moduleUrl: import.meta.url, env: this.env });
  }
  localOperations() {
    return new DefaultLocalDiscoveryOperations({
      cwd: this.cwd,
      getConfig: () => this.config(),
      getConfigStore: () => this.configStore(),
      getCharters: () => new DocCharterCatalog({ docs: this.docs() }),
      getRepositoryPaths: () => new GitRepositoryPaths({ cwd: this.cwd }),
      getEvidence: () => this.evidence(),
      getReadiness: () => this.readiness(),
      getProbe: () => this.probe(),
      getTracker: () => this.tracker(),
      getConfigPath: () => this.configPath()
    });
  }
  reviewOperations(props = {}) {
    const launch = ReviewOperationsLaunchPropsSchema.parse(props);
    return new DefaultReviewOperations({
      ...launch,
      cwd: launch.cwd ?? this.cwd,
      env: this.env
    });
  }
  trackerEntityOperations() {
    return new DefaultTrackerEntityOperations({
      getTracker: () => this.tracker(),
      getPrHost: () => this.prHost(),
      getConfig: () => this.config(),
      cwd: this.cwd
    });
  }
};
function createFlightRules(props = {}) {
  return new DefaultFlightRules(props);
}

// src/shared/host-settings/host-settings-source.ts
var settingsScopes = ["user", "project", "local"];

// src/version.ts
var appVersion = false ? "0.0.0-dev" : "2.2.1";

// src/agents/agent-frontmatter/agent-frontmatter.ts
import { parse as parseYaml4 } from "yaml";
var MissingFrontmatterError = class extends Error {
  name = "MissingFrontmatterError";
};
var YamlAgentFrontmatterParser = class {
  parse(markdown) {
    const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(markdown);
    if (match === null || match.index !== 0 || match[1] === void 0) {
      throw new MissingFrontmatterError("agent file has no leading --- frontmatter block");
    }
    const raw = parseYaml4(match[1]);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new MissingFrontmatterError("frontmatter is not a YAML mapping");
    }
    return AgentFrontmatterSchema.parse(raw);
  }
};
var agentFrontmatterParser = new YamlAgentFrontmatterParser();

// src/agents/agent-registry/agent-registry.ts
import { readFileSync as readFileSync11, readdirSync as readdirSync3 } from "node:fs";
import { basename as basename4, join as join12 } from "node:path";
import { z as z47 } from "zod";
var AgentNameSchema = AgentFrontmatterSchema.shape.name;
var AgentVariantSchema = z47.strictObject({
  name: AgentNameSchema,
  extends: AgentNameSchema,
  description: AgentFrontmatterSchema.shape.description,
  model: ModelTierSchema,
  modelReason: z47.string().trim().min(1).optional()
});
var AgentVariantsSchema = z47.array(AgentVariantSchema);
var InvalidAgentDefinitionError = class extends Error {
  name = "InvalidAgentDefinitionError";
};
var FileAgentRegistry = class {
  load(directory) {
    const agents = readdirSync3(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
      const markdown = readFileSync11(join12(directory, entry.name), "utf8");
      const frontmatter = AgentRegistrationSchema.parse(agentFrontmatterParser.parse(markdown));
      const body = markdown.replace(/^---\r?\n[\s\S]*?^---(?:\r?\n|$)/m, "");
      if (frontmatter.name !== basename4(entry.name, ".md") || body.trim() === "") {
        throw new InvalidAgentDefinitionError(`Agent ${entry.name} needs a matching name and a nonempty prompt`);
      }
      return { frontmatter, body };
    });
    const canonical = new Map(agents.map((agent) => [agent.frontmatter.name, agent]));
    const names = new Set(canonical.keys());
    const variants = AgentVariantsSchema.parse(JSON.parse(readFileSync11(join12(directory, "variants.json"), "utf8")));
    for (const variant of variants) {
      const base = canonical.get(variant.extends);
      if (base === void 0 || names.has(variant.name)) {
        throw new InvalidAgentDefinitionError(`Variant ${variant.name} needs a unique name and canonical base ${variant.extends}`);
      }
      const { name, description, model, modelReason } = variant;
      const frontmatter = AgentRegistrationSchema.parse({
        ...base.frontmatter,
        name,
        description,
        model,
        modelReason
      });
      agents.push({ frontmatter, body: base.body });
      names.add(variant.name);
    }
    return agents.sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));
  }
};

// src/agents/agent-emitter/claude-agent-emitter.ts
import { stringify as stringifyYaml3 } from "yaml";
import { z as z48 } from "zod";

// src/sdk/claude-builtin-tools.ts
var StandardClaudeBuiltInToolCatalog = class {
  toolsFor(capability) {
    if (capability === "read") return ["Glob", "Grep", "Read"];
    if (capability === "edit") return ["Write", "Edit"];
    if (capability === "shell") return ["Bash"];
    if (capability === "web") return ["WebSearch", "WebFetch"];
    return [];
  }
};
var claudeBuiltInTools = new StandardClaudeBuiltInToolCatalog();

// src/agents/agent-emitter/agent-emitter.ts
var UnsupportedAgentSettingError = class extends Error {
  name = "UnsupportedAgentSettingError";
};

// src/agents/agent-emitter/claude-agent-emitter.ts
var ClaudeAgentEmitterPropsSchema = z48.strictObject({ models: ModelBindingsSchema });
var MarkdownClaudeAgentEmitter = class {
  models;
  constructor(props) {
    this.models = ClaudeAgentEmitterPropsSchema.parse(props).models;
  }
  emit(agent) {
    const { frontmatter, body } = AgentDefinitionSchema.parse(agent);
    if (frontmatter.sandbox !== void 0 || frontmatter.dispatch !== void 0) {
      throw new UnsupportedAgentSettingError(`${frontmatter.name}: sandbox and dispatch restrictions need a runtime adapter`);
    }
    const native = {
      name: frontmatter.name,
      description: frontmatter.description,
      tools: frontmatter.capabilities.flatMap((capability) => this.tools(capability)).join(", "),
      model: this.models[frontmatter.model],
      ...frontmatter.reasoning === void 0 ? {} : { effort: frontmatter.reasoning },
      ...frontmatter["x-claude"]?.color === void 0 ? {} : { color: frontmatter["x-claude"].color }
    };
    return `---
${stringifyYaml3(native, { lineWidth: 0 })}---
${body}`;
  }
  tools(capability) {
    if (capability === "spawn" || capability === "ask") {
      throw new UnsupportedAgentSettingError(`Worker agent capability ${capability} needs an orchestration adapter`);
    }
    return claudeBuiltInTools.toolsFor(capability);
  }
};

// src/agents/agent-emitter/codex-agent-emitter.ts
import { z as z49 } from "zod";
var ReasoningBindingsSchema = z49.strictObject({
  standard: z49.enum(reasoningLevels),
  escalated: z49.enum(reasoningLevels),
  expert: z49.enum(reasoningLevels)
});
var CodexAgentEmitterPropsSchema = z49.strictObject({
  models: ModelBindingsSchema,
  reasoning: ReasoningBindingsSchema
});
var TomlCodexAgentEmitter = class {
  props;
  constructor(props) {
    this.props = CodexAgentEmitterPropsSchema.parse(props);
  }
  emit(agent) {
    const { frontmatter, body } = AgentDefinitionSchema.parse(agent);
    if (frontmatter.dispatch !== void 0 || frontmatter.capabilities.some((capability) => capability === "spawn" || capability === "ask")) {
      throw new UnsupportedAgentSettingError(`${frontmatter.name}: worker orchestration needs a runtime adapter`);
    }
    if (frontmatter.sandbox !== void 0) {
      throw new UnsupportedAgentSettingError(`${frontmatter.name}: explicit filesystem/network restrictions need a runtime permission adapter`);
    }
    const settings = [
      ["name", frontmatter.name],
      ["description", frontmatter.description],
      ["model", this.props.models[frontmatter.model]],
      ["model_reasoning_effort", frontmatter.reasoning ?? this.props.reasoning[frontmatter.model]],
      ["sandbox_mode", frontmatter.capabilities.includes("edit") ? "workspace-write" : "read-only"],
      ["web_search", frontmatter.capabilities.includes("web") ? "live" : "disabled"],
      ["developer_instructions", body]
    ];
    return settings.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n") + "\n";
  }
  diagnostics(agent) {
    const { frontmatter } = AgentDefinitionSchema.parse(agent);
    const diagnostics = [
      "Codex has no equivalent per-agent tool allowlist; capabilities remain instruction constraints and host permissions govern tools.",
      "The parent session can override agent sandbox defaults; evidence directories need writable access from the runtime adapter."
    ];
    if (frontmatter["x-claude"]?.color !== void 0) diagnostics.push("Claude display color has no Codex mapping and is omitted.");
    return diagnostics;
  }
};

// src/plugins/plugin-compiler/plugin-compiler.ts
import {
  chmodSync,
  copyFileSync,
  existsSync as existsSync11,
  lstatSync as lstatSync3,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync12,
  readdirSync as readdirSync4,
  realpathSync as realpathSync8,
  rmSync,
  writeFileSync as writeFileSync5
} from "node:fs";
import { join as join13, resolve as resolve11 } from "node:path";
import { createHash as createHash3 } from "node:crypto";
import { z as z50 } from "zod";
var NativePluginCompilerPropsSchema = z50.strictObject({ sourceDir: z50.string().min(1) });
var PluginHostSchema = z50.enum(["claude", "codex"]);
var PackageVersionSchema = z50.object({ version: z50.string().min(1) });
var PluginIdentitySchema = z50.strictObject({
  name: z50.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z50.string().min(1),
  repository: z50.url(),
  author: z50.strictObject({ name: z50.string().min(1) }),
  license: z50.string().min(1)
});
var InvalidPluginSourceError = class extends Error {
  name = "InvalidPluginSourceError";
};
var NativePluginCompiler = class {
  sourceDir;
  constructor(props) {
    this.sourceDir = realpathSync8(resolve11(NativePluginCompilerPropsSchema.parse(props).sourceDir));
  }
  compile(host = "claude") {
    const target = PluginHostSchema.parse(host);
    for (const resource of [
      "package.json",
      "adapters",
      "agents",
      "skills",
      "docs",
      "hooks",
      "bin"
    ]) {
      this.validateSource(join13(this.sourceDir, resource));
    }
    const identity = PluginIdentitySchema.parse(
      JSON.parse(readFileSync12(join13(this.sourceDir, "adapters/plugin.json"), "utf8"))
    );
    const { version } = PackageVersionSchema.parse(
      JSON.parse(readFileSync12(join13(this.sourceDir, "package.json"), "utf8"))
    );
    const definitions = new FileAgentRegistry().load(join13(this.sourceDir, "agents"));
    const models = JSON.parse(
      readFileSync12(join13(this.sourceDir, "adapters", target, "model-tiers.json"), "utf8")
    );
    const codexEmitter = target === "codex" ? new TomlCodexAgentEmitter({
      models,
      reasoning: JSON.parse(
        readFileSync12(join13(this.sourceDir, "adapters/codex/reasoning-tiers.json"), "utf8")
      )
    }) : void 0;
    const emitter = codexEmitter ?? new MarkdownClaudeAgentEmitter({ models });
    const agents = definitions.map((agent) => ({
      name: agent.frontmatter.name,
      contents: emitter.emit(agent),
      registration: agent.frontmatter
    }));
    const diagnostics = codexEmitter === void 0 ? [] : [...new Set(definitions.flatMap((agent) => codexEmitter.diagnostics(agent)))];
    if (target === "codex")
      diagnostics.push(
        "Claude commit hooks are omitted; Codex gets only the sub-agent status and usage-handoff hooks, which run once trusted through /hooks."
      );
    for (const executable of ["flight-rules", "flight-rules.mjs"]) {
      if (!existsSync11(join13(this.sourceDir, "bin", executable))) {
        throw new InvalidPluginSourceError(
          `Build the CLI before native assembly: missing bin/${executable}`
        );
      }
    }
    const directory = join13(this.sourceDir, "dist", target);
    if (existsSync11(join13(this.sourceDir, "dist")) && lstatSync3(join13(this.sourceDir, "dist")).isSymbolicLink()) {
      throw new InvalidPluginSourceError("Native output cannot use a symlinked dist directory");
    }
    rmSync(directory, { recursive: true, force: true });
    mkdirSync5(directory, { recursive: true });
    const resources = target === "claude" ? ["skills", "docs", "hooks", "bin"] : ["skills", "docs", "bin"];
    for (const resource of resources)
      this.copyDirectory(join13(this.sourceDir, resource), join13(directory, resource));
    this.copyDirectory(
      join13(this.sourceDir, "agents"),
      join13(directory, "bin", "resources", "agents")
    );
    const agentDirectory = target === "claude" ? join13(directory, "agents") : join13(directory, ".codex", "agents");
    mkdirSync5(agentDirectory, { recursive: true });
    const extension = target === "claude" ? "md" : "toml";
    for (const agent of agents)
      writeFileSync5(join13(agentDirectory, `${agent.name}.${extension}`), agent.contents);
    writeFileSync5(
      join13(directory, "flight-rules-install.json"),
      JSON.stringify(
        {
          host: target,
          agents: agents.map((agent) => ({
            name: agent.name,
            sha256: createHash3("sha256").update(agent.contents).digest("hex"),
            registration: agent.registration
          }))
        },
        null,
        2
      ) + "\n"
    );
    mkdirSync5(join13(directory, "adapters", target), { recursive: true });
    copyFileSync(
      join13(this.sourceDir, "adapters", target, "model-tiers.json"),
      join13(directory, "adapters", target, "model-tiers.json")
    );
    if (target === "codex") {
      copyFileSync(
        join13(this.sourceDir, "adapters/codex/reasoning-tiers.json"),
        join13(directory, "adapters/codex/reasoning-tiers.json")
      );
      mkdirSync5(join13(directory, "hooks"), { recursive: true });
      copyFileSync(join13(this.sourceDir, "adapters/codex/hooks.json"), join13(directory, "hooks", "hooks.json"));
    }
    for (const executable of ["flight-rules", "flight-rules.mjs"])
      chmodSync(join13(directory, "bin", executable), 493);
    const manifestDirectory = join13(
      directory,
      target === "claude" ? ".claude-plugin" : ".codex-plugin"
    );
    mkdirSync5(manifestDirectory);
    const manifest = target === "claude" ? {
      ...identity,
      version,
      skills: "./skills/",
      agents: agents.map((agent) => `./agents/${agent.name}.md`)
    } : { ...identity, version, skills: "./skills/" };
    writeFileSync5(join13(manifestDirectory, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
    if (target === "codex") {
      writeFileSync5(join13(directory, ".codex", "config.toml"), "[agents]\nenabled = true\n");
      writeFileSync5(
        join13(directory, "diagnostics.json"),
        JSON.stringify(diagnostics, null, 2) + "\n"
      );
    }
    return { directory, agents: agents.map((agent) => agent.name), diagnostics };
  }
  validateSource(path) {
    const stat = lstatSync3(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) {
      throw new InvalidPluginSourceError(
        `Native resources must be regular files/directories: ${path}`
      );
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync4(path)) this.validateSource(join13(path, entry));
    }
  }
  copyDirectory(source, destination) {
    mkdirSync5(destination, { recursive: true });
    for (const entry of readdirSync4(source, { withFileTypes: true })) {
      const from = join13(source, entry.name);
      const to = join13(destination, entry.name);
      if (entry.isDirectory()) this.copyDirectory(from, to);
      else copyFileSync(from, to);
    }
  }
};

// src/orchestration/report-handoff.ts
import { isDeepStrictEqual as isDeepStrictEqual2 } from "node:util";
var ValidatedReportHandoff = class {
  accept(request, outcome, reportSchema) {
    const expected = DispatchRequestSchema.parse(request);
    const parsed = DispatchOutcomeSchema.safeParse(outcome);
    if (!parsed.success) {
      return {
        status: "rejected",
        failure: {
          code: "INVALID_HANDOFF",
          message: parsed.error.message,
          remedy: "Return a complete structured outcome with the original dispatch identity and caller context."
        }
      };
    }
    const value = parsed.data;
    if (value.dispatchId !== expected.id || value.agent !== expected.agent || !isDeepStrictEqual2(value.context, expected.context)) {
      return {
        status: "rejected",
        failure: {
          code: "INVALID_HANDOFF",
          message: "The result does not belong to this dispatch, agent and caller context.",
          remedy: "Reconcile the original invocation; do not route another task or attempt's report into this run."
        }
      };
    }
    if (value.status !== "completed") return { status: "accepted", outcome: value };
    const report = reportSchema.safeParse(value.report);
    if (!report.success) {
      return {
        status: "rejected",
        failure: {
          code: "INVALID_REPORT",
          message: report.error.message,
          remedy: "Obtain a report matching the requested role's schema; do not fabricate or infer a successful result."
        }
      };
    }
    return { status: "accepted", outcome: { ...value, status: "completed", report: report.data } };
  }
};

// src/orchestration/implementation-loop.schema.ts
import { z as z51 } from "zod";
var ImplementationReportSchema = z51.strictObject({
  summary: OrchestrationTextSchema,
  filesChanged: z51.array(
    z51.strictObject({ path: OrchestrationTextSchema, why: OrchestrationTextSchema })
  ),
  testsRun: z51.array(
    z51.strictObject({ command: OrchestrationTextSchema, result: OrchestrationTextSchema })
  ),
  approach: OrchestrationTextSchema,
  openQuestions: z51.array(OrchestrationTextSchema).optional()
});
var CriterionResultSchema = z51.strictObject({
  criterion: OrchestrationTextSchema,
  verdict: z51.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
  evidence: OrchestrationTextSchema
});
var VerificationReportSchema = z51.strictObject({
  summary: OrchestrationTextSchema,
  criteria: z51.array(CriterionResultSchema).min(1),
  charterConcerns: z51.array(OrchestrationTextSchema).optional(),
  openQuestions: z51.array(OrchestrationTextSchema).optional(),
  verified: z51.boolean()
}).refine(
  (report) => report.verified === report.criteria.every((criterion) => criterion.verdict === "PASS"),
  "verified must agree with every itemized verdict"
);
var HandoffRecordSchema = z51.strictObject({
  request: DispatchRequestSchema,
  outcome: z51.unknown()
});
var ImplementationRunSchema = z51.strictObject({
  context: RunContextSchema,
  criteria: z51.array(OrchestrationTextSchema).min(1).refine((criteria) => new Set(criteria).size === criteria.length, "criteria must be distinct"),
  implementationInput: z51.record(z51.string(), z51.json()).refine(
    (input) => !Object.hasOwn(input, "verifierFailures"),
    "verifierFailures is reserved for validated retry evidence"
  ),
  history: z51.array(
    z51.strictObject({ implementation: HandoffRecordSchema, verification: HandoffRecordSchema })
  ).max(3)
});

// src/orchestration/implementation-loop.ts
import { isDeepStrictEqual as isDeepStrictEqual3 } from "node:util";
var VerifiedImplementationLoop = class {
  reports = new ValidatedReportHandoff();
  next(run2) {
    const parsed = ImplementationRunSchema.safeParse(run2);
    if (!parsed.success) {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HISTORY",
          message: parsed.error.message,
          remedy: "Supply the original run context and at most three ordered implementation/verification receipts."
        }
      };
    }
    const input = parsed.data;
    const filesChanged = /* @__PURE__ */ new Set();
    let failures = [];
    for (const [index, round] of input.history.entries()) {
      const expected = this.implementationRequest(input, index + 1, failures);
      const implementation = this.readReport(
        expected,
        round.implementation,
        ImplementationReportSchema
      );
      if (implementation.status === "stopped") return implementation;
      if (implementation.report.openQuestions?.length)
        return this.openQuestions(implementation.report.openQuestions);
      for (const file of implementation.report.filesChanged) filesChanged.add(file.path);
      const verification = this.readReport(
        this.verificationRequest(input, index + 1, [...filesChanged]),
        round.verification,
        VerificationReportSchema
      );
      if (verification.status === "stopped") return verification;
      const report = verification.report;
      if (!isDeepStrictEqual3(
        report.criteria.map((criterion) => criterion.criterion),
        input.criteria
      )) {
        return {
          status: "stopped",
          failure: {
            code: "INVALID_REPORT",
            message: "Verifier criteria do not match the original criteria in order and text.",
            remedy: "Have the verifier quote each original criterion exactly once, in its original order."
          }
        };
      }
      const terminal = report.verified || report.criteria.some((criterion) => criterion.verdict === "UNVERIFIABLE") || Boolean(report.openQuestions?.length);
      if (terminal && index < input.history.length - 1) {
        return {
          status: "stopped",
          failure: {
            code: "INVALID_HISTORY",
            message: "History continues after a terminal verification result.",
            remedy: "Reconcile the stopped run before starting further work; do not reinterpret it as a retry."
          }
        };
      }
      if (report.openQuestions?.length) return this.openQuestions(report.openQuestions);
      if (report.criteria.some((criterion) => criterion.verdict === "UNVERIFIABLE")) {
        return {
          status: "stopped",
          failure: {
            code: "UNVERIFIABLE",
            message: "At least one acceptance criterion could not be verified.",
            remedy: "Resolve the missing evidence or access described in the verifier report before starting a new run."
          }
        };
      }
      if (report.verified) return { status: "verified", report, filesChanged: [...filesChanged] };
      failures = report.criteria.filter((criterion) => criterion.verdict === "FAIL");
    }
    if (input.history.length === 3) {
      return {
        status: "stopped",
        failure: {
          code: "ATTEMPTS_EXHAUSTED",
          message: "Three implementation attempts received verifier FAIL results.",
          remedy: "Return all remaining failed criteria to the caller for a decision; do not dispatch a fourth attempt."
        }
      };
    }
    return {
      status: "implement",
      request: this.implementationRequest(input, input.history.length + 1, failures),
      filesChanged: [...filesChanged]
    };
  }
  verify(run2, implementation) {
    const decision = this.next(run2);
    if (decision.status === "stopped") return decision;
    if (decision.status === "verified") {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HISTORY",
          message: "This run already passed verification.",
          remedy: "Use the verified result; start a separate run if the task or checkout changes."
        }
      };
    }
    const receipt = HandoffRecordSchema.safeParse(implementation);
    if (!receipt.success) {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HANDOFF",
          message: receipt.error.message,
          remedy: "Supply the original implementation request and its structured outcome."
        }
      };
    }
    const result = this.readReport(decision.request, receipt.data, ImplementationReportSchema);
    if (result.status === "stopped") return result;
    if (result.report.openQuestions?.length) return this.openQuestions(result.report.openQuestions);
    const filesChanged = [
      .../* @__PURE__ */ new Set([
        ...decision.filesChanged,
        ...result.report.filesChanged.map((file) => file.path)
      ])
    ];
    return {
      status: "verify",
      request: this.verificationRequest(run2, decision.request.context.attempt, filesChanged)
    };
  }
  implementationRequest(run2, attempt, failures) {
    return {
      id: `${run2.context.runId}:implementation:${attempt}`,
      agent: attempt === 3 ? "code-implementation-escalated" : "code-implementation",
      context: { ...run2.context, attempt },
      input: {
        ...run2.implementationInput,
        mode: "implement",
        criteria: [...run2.criteria],
        ...failures.length ? { verifierFailures: failures } : {}
      }
    };
  }
  verificationRequest(run2, attempt, filesChanged) {
    return {
      id: `${run2.context.runId}:verification:${attempt}`,
      agent: "code-verifier",
      context: { ...run2.context, attempt },
      input: {
        mode: "verify",
        criteria: [...run2.criteria],
        filesChanged: filesChanged.map((path) => ({ path }))
      }
    };
  }
  readReport(expected, record, schema) {
    if (!isDeepStrictEqual3(expected, record.request)) {
      return {
        status: "stopped",
        failure: {
          code: "INVALID_HISTORY",
          message: "Recorded dispatch differs from the request derived from this run.",
          remedy: "Preserve the original task, attempt, agent and input; do not substitute or enrich verifier requests."
        }
      };
    }
    const handoff = this.reports.accept(expected, record.outcome, schema);
    if (handoff.status === "rejected") return { status: "stopped", failure: handoff.failure };
    if (handoff.outcome.status !== "completed")
      return { status: "stopped", failure: handoff.outcome.failure };
    return { status: "completed", report: handoff.outcome.report };
  }
  openQuestions(questions) {
    return {
      status: "stopped",
      failure: {
        code: "OPEN_QUESTIONS",
        message: questions.join("\n"),
        remedy: "Return these questions to the caller. Use the question policy only when this invocation explicitly permits human questions."
      }
    };
  }
};

// src/orchestration/review-triage.schema.ts
import { z as z52 } from "zod";
var FindingDispositionSchema = z52.discriminatedUnion("disposition", [
  z52.strictObject({
    id: OrchestrationTextSchema,
    disposition: z52.literal("fix"),
    evidence: OrchestrationTextSchema,
    criterion: OrchestrationTextSchema
  }),
  z52.strictObject({
    id: OrchestrationTextSchema,
    disposition: z52.literal("ignore"),
    evidence: OrchestrationTextSchema
  }),
  z52.strictObject({
    id: OrchestrationTextSchema,
    disposition: z52.literal("needs_input"),
    evidence: OrchestrationTextSchema,
    question: OrchestrationTextSchema
  })
]);
var ReviewTriageReportSchema = z52.strictObject({
  summary: OrchestrationTextSchema,
  headSha: z52.string().regex(/^[a-f0-9]{40}$/),
  findings: z52.array(FindingDispositionSchema).refine(
    (findings) => new Set(findings.map((finding) => finding.id)).size === findings.length,
    "Each finding must have exactly one disposition"
  ),
  openQuestions: z52.array(OrchestrationTextSchema).optional()
}).refine(
  (report) => report.findings.every(
    (finding) => finding.disposition !== "needs_input" || report.openQuestions?.includes(finding.question)
  ),
  "Every needs_input question must also appear in openQuestions"
);

// src/orchestration/dispatch-queue.ts
import { z as z53 } from "zod";
var DispatchQueuePropsSchema = z53.strictObject({
  agents: z53.array(AgentDefinitionSchema).min(1),
  requests: z53.array(DispatchRequestSchema).refine(
    (requests) => new Set(requests.map((request) => request.id)).size === requests.length,
    "dispatch IDs must be unique"
  ),
  maxConcurrent: z53.int().positive()
});
var ObservedDispatchIdsSchema = z53.array(z53.string().min(1)).refine((ids) => new Set(ids).size === ids.length, "observed dispatch IDs must be unique");
var InvalidDispatchQueueStateError = class extends Error {
  name = "InvalidDispatchQueueStateError";
};
var BoundedDispatchQueue = class {
  policy;
  reports = new ValidatedReportHandoff();
  requests;
  maxConcurrent;
  active = /* @__PURE__ */ new Map();
  outcomes = /* @__PURE__ */ new Map();
  cursor = 0;
  batchSealed = false;
  constructor(props) {
    const input = DispatchQueuePropsSchema.parse(props);
    this.policy = new RegistryOrchestrationPolicy({ agents: input.agents });
    this.requests = input.requests;
    this.maxConcurrent = input.maxConcurrent;
  }
  pending() {
    const request = this.requests[this.cursor];
    return request === void 0 ? void 0 : DispatchRequestSchema.parse(request);
  }
  admit(runtime, observedDispatchIds) {
    const complete = this.results();
    if (complete !== void 0) return { status: "complete", outcomes: complete };
    if (this.active.size > 0 && (this.batchSealed || this.active.size >= this.maxConcurrent || this.cursor === this.requests.length)) {
      this.batchSealed = true;
      return { status: "waiting", dispatchIds: [...this.active.keys()] };
    }
    const request = this.pending();
    if (request === void 0)
      throw new InvalidDispatchQueueStateError("Unsettled queue has no pending or active requests");
    const snapshot = RuntimeSnapshotSchema.parse(runtime);
    const observed = ObservedDispatchIdsSchema.parse(observedDispatchIds);
    if (observed.some((id) => !this.active.has(id)) || observed.length > snapshot.limits.activeWorkers) {
      throw new InvalidDispatchQueueStateError(
        "Observed local dispatches must be active reservations included in the host worker count"
      );
    }
    const unobservedReservations = this.active.size - observed.length;
    const decision = this.policy.prepare(request, {
      ...snapshot,
      limits: {
        ...snapshot.limits,
        activeWorkers: snapshot.limits.activeWorkers + unobservedReservations
      }
    });
    if (decision.status === "unavailable" && decision.failure.code === "CAPACITY_EXHAUSTED" && this.active.size > 0) {
      this.batchSealed = true;
      return { status: "waiting", dispatchIds: [...this.active.keys()] };
    }
    this.cursor++;
    if (decision.status === "unavailable") {
      const outcome = {
        status: "unavailable",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: decision.failure
      };
      this.outcomes.set(request.id, structuredClone(outcome));
      return { status: "unavailable", outcome };
    }
    this.active.set(request.id, DispatchRequestSchema.parse(request));
    if (this.active.size === this.maxConcurrent) this.batchSealed = true;
    return decision;
  }
  settle(dispatchId, outcome, schema) {
    const request = this.active.get(dispatchId);
    if (request === void 0)
      throw new InvalidDispatchQueueStateError(`No active reservation for ${dispatchId}`);
    const result = this.reports.accept(request, outcome, schema);
    if (result.status === "rejected") return result;
    this.outcomes.set(dispatchId, structuredClone(result.outcome));
    this.active.delete(dispatchId);
    this.batchSealed = this.active.size > 0;
    return result;
  }
  cancel() {
    for (const request of this.requests.slice(this.cursor)) {
      this.outcomes.set(request.id, {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: {
          code: "CANCELLED",
          message: "The caller cancelled queued work before dispatch.",
          remedy: "Start a new invocation only when the caller chooses to resume."
        }
      });
    }
    this.cursor = this.requests.length;
    this.batchSealed = this.active.size > 0;
  }
  results() {
    if (this.outcomes.size !== this.requests.length) return void 0;
    return this.requests.map((request) => {
      const outcome = this.outcomes.get(request.id);
      if (outcome === void 0)
        throw new InvalidDispatchQueueStateError(`Missing terminal outcome for ${request.id}`);
      return structuredClone(outcome);
    });
  }
};
export {
  AdapterLimitsSchema,
  AgentCapabilitySchema,
  AgentFrontmatterSchema,
  AgentInstallScopeSchema,
  AttachmentSchema,
  AttachmentSpecSchema,
  BlobSectionSource,
  BodyMetadataService,
  BodySectionSelector,
  BoundedDispatchQueue,
  CallerContextSchema,
  CapabilityEvidenceSchema,
  CharterFormatError,
  ClaudeSettingsSource,
  CommentSchema,
  CommitMessageInputSchema,
  ConfigSchema,
  ConfigScopeSchema,
  ConfigStore,
  CreateEpicInputSchema,
  CreateInitiativeInputSchema,
  CreateTechnicalDesignInputSchema,
  CreateTicketInputSchema,
  CriterionResultSchema,
  DefaultCommitMessageBuilder,
  DefaultFlightRules,
  DefaultGitConfigOperations,
  DefaultPullRequestBuilder,
  DefaultTicketLifecycleOperations,
  DefaultTrackerEntityOperations,
  DependencyPlannerService,
  DispatchOutcomeSchema,
  DispatchRequestSchema,
  DocCharterCatalog,
  DocIdSchema,
  DuplicateEvidenceNameError,
  EntityMetadataSchema,
  EnvLoader,
  EpicSchema,
  EvidenceUploadFailure,
  FileAgentRegistry,
  FileDocResolver,
  FileNativeInstallation,
  GhOutputParseError,
  GhPullRequestHost,
  GitHubTaskTracker,
  HandoffRecordSchema,
  ImplementationReportSchema,
  ImplementationRunSchema,
  InitiativeSchema,
  InstallationManifestSchema,
  InvalidAgentDefinitionError,
  InvalidDispatchQueueStateError,
  InvalidPluginSourceError,
  InvalidSettingsError,
  JiraTaskTracker,
  LaunchConfigOperationDeniedError,
  LayeredBodyAdfConverter,
  MarkdownClaudeAgentEmitter,
  MediaLookupSchema,
  MediaRefSchema,
  ModelTierSchema,
  NativeHostSchema,
  NativeInstallationError,
  NativePluginCompiler,
  NeutralSettingsSource,
  NodeGitExecutor,
  NodeRepositoryReadiness,
  NodeToolProbe,
  NodeWorkflowPreflight,
  OrchestrationFailureSchema,
  PrecedenceBodyFormatDetector,
  PullRequestTemplateSchema,
  PushSpecSchema,
  QuestionRequestSchema,
  ReadinessOptionsSchema,
  RegistryOrchestrationPolicy,
  ReviewTriageReportSchema,
  RunContextSchema,
  RuntimeSnapshotSchema,
  SemanticTypeSchema,
  SiblingSkillRequestSchema,
  TechnicalDesignSchema,
  TicketSchema,
  TomlCodexAgentEmitter,
  TrackerEvidenceService,
  TrackerUserSchema,
  UnsupportedAgentSettingError,
  UnsupportedTrackerOperationError,
  UpdateEpicInputSchema,
  UpdateInitiativeInputSchema,
  UpdateTicketInputSchema,
  ValidatedReportHandoff,
  VerificationReportSchema,
  VerifiedImplementationLoop,
  WorkflowEvidenceSchema,
  WorkflowSchema,
  YamlAgentFrontmatterParser,
  agentCapabilities,
  agentFrontmatterParser,
  appVersion,
  blobSectionSource,
  bodyFormatDetector,
  configScopes,
  createFlightRules,
  getQaRecipePath,
  getRfcDir,
  markdownAdfConverter,
  modelTiers,
  nodeToolProbe,
  pullRequestBuilder,
  readConfig,
  resolveConfigPath,
  sectionSelector,
  seedCompetencies,
  semanticTypes,
  settingsScopes
};
