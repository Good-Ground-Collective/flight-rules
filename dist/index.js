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
  constructor(execFileFn) {
    const promisified = promisify(execFile);
    this.execFile = execFileFn ?? ((file, args) => promisified(file, [...args]));
  }
  async stage(files) {
    if (files.length === 0) return;
    await this.execFile("git", ["add", "--", ...files]);
  }
  async commit(message, files) {
    if (files !== void 0 && files.length > 0) {
      await this.execFile("git", ["commit", "--cleanup=whitespace", "--only", "-m", message, "--", ...files]);
      return;
    }
    await this.execFile("git", ["commit", "--cleanup=whitespace", "-m", message]);
  }
  async getCommitSha() {
    const { stdout } = await this.execFile("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  }
  async checkout(spec, from) {
    const branch = branchNamer.name(spec);
    const args = ["checkout", "-b", branch];
    if (from !== void 0) args.push(from);
    await this.execFile("git", args);
    return branch;
  }
  async startBranch(spec, from) {
    const branch = branchNamer.name(spec);
    const current = await this.getCurrentBranch();
    if (await this.isDisposableWorktreeBranch(current, from)) {
      await this.execFile("git", ["branch", "-m", branch]);
      return { branch, renamedFrom: current };
    }
    return { branch: await this.checkout(spec, from), renamedFrom: null };
  }
  async getCurrentBranch() {
    const { stdout } = await this.execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  }
  async push(spec) {
    const parsed = PushSpecSchema.parse(spec);
    const args = ["push"];
    if (parsed.setUpstream) args.push("--set-upstream");
    args.push(parsed.remote, parsed.branch);
    await this.execFile("git", args);
  }
  async isDisposableWorktreeBranch(current, from) {
    if (current === "HEAD") return false;
    const { stdout: dirs } = await this.execFile("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
    const [gitDir, commonDir] = dirs.trim().split("\n");
    if (gitDir === void 0 || gitDir === commonDir) return false;
    if (await this.succeeds(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])) return false;
    if (current === await this.defaultBranch()) return false;
    const { stdout: unique } = await this.execFile("git", [
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
      this.execFile("git", ["rev-parse", "HEAD"]),
      this.execFile("git", ["rev-parse", `${from}^{commit}`])
    ]);
    return head.trim() === base.trim();
  }
  async defaultBranch() {
    try {
      const { stdout } = await this.execFile("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      return stdout.trim().replace(/^origin\//, "");
    } catch {
      return void 0;
    }
  }
  async succeeds(args) {
    try {
      await this.execFile("git", args);
      return true;
    } catch {
      return false;
    }
  }
};

// src/pr/pull-request-host/gh-pull-request-host.ts
import { execFile as execFile2 } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { promisify as promisify2 } from "node:util";
import { z as z5 } from "zod";

// src/git/pr-template/pr-template.ts
import { z as z4 } from "zod";
var maxChangeLineLength = 256;
var maxChangeLines = 5;
var PullRequestTemplateSchema = z4.object({
  type: z4.enum(semanticTypes),
  scope: z4.string().min(1),
  description: z4.string().min(1),
  whatWasChanged: z4.array(z4.string().min(1).max(maxChangeLineLength)).min(1).max(maxChangeLines),
  whyWasItChanged: z4.string().min(1),
  otsMaterials: z4.string().min(1).optional(),
  ticketId: z4.string().min(1).optional(),
  ticketUrl: z4.url().optional(),
  baseBranch: z4.string().min(1),
  headBranch: z4.string().min(1),
  reviewers: z4.array(z4.string()).default([]),
  labels: z4.array(z4.string()).default([])
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
var GhPullRequestHostPropsSchema = z5.object({
  repo: z5.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected "owner/repo"')
});
var GhPullRequestListSchema = z5.array(
  z5.object({
    number: z5.number(),
    url: z5.string(),
    headRefName: z5.string(),
    baseRefName: z5.string(),
    title: z5.string()
  })
);
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
  execFile;
  constructor(props) {
    const parsed = GhPullRequestHostPropsSchema.parse(props);
    this.repo = parsed.repo;
    this.builder = props.builder ?? new DefaultPullRequestBuilder();
    const promisified = promisify2(execFile2);
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args]));
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
  async withBodyFile(body, run) {
    const dir = await mkdtemp(join2(tmpdir(), "flight-rules-"));
    const bodyFile = join2(dir, "body.md");
    try {
      await writeFile(bodyFile, body, "utf8");
      return await run(bodyFile);
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
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname4 } from "node:path";

// src/shared/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join3, resolve as resolve2 } from "node:path";
import { z as z8 } from "zod";

// src/tasks/jira-task-tracker/jira-host.ts
import { z as z6 } from "zod";
var JiraHostSchema = z6.string().transform((host) => host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, ""));

// src/shared/ariadne/ariadne.schema.ts
import { z as z7 } from "zod";
var defaultAriadneUrl = "https://ariadne-api-xohlbba2ea-uc.a.run.app";
var loopbackHosts = /* @__PURE__ */ new Set(["localhost", "127.0.0.1"]);
var AriadneUrlSchema = z7.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" && loopbackHosts.has(url.hostname);
}, "must be https (http only for localhost or 127.0.0.1)");
var agentStates = ["nominal", "caution", "abort", "hold"];
var agentItemKinds = ["question", "blocker", "testable", "wave-gate"];
var agentActivityLevels = ["info", "success", "caution", "abort"];
var agentLimits = {
  step: 60,
  heartbeatDetail: 500,
  title: 200,
  itemDetail: 2e3,
  option: 60,
  options: 6,
  text: 500,
  branch: 255
};
var AgentTextNormalizer = class {
  /** Whitespace runs collapse to a space and control characters go. */
  oneLine(value, max) {
    return this.cut(value.replace(/[\x00-\x08\x0e-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim(), max);
  }
  /** Line feeds stay; tabs become spaces and other control characters go. */
  multiLine(value, max) {
    const normalized = value.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").trim();
    return this.cut(normalized, max);
  }
  /** Overlong text ends in an ellipsis, never in half a surrogate pair. */
  cut(value, max) {
    if (value.length <= max) return value;
    const head = value.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "");
    return `${head.trimEnd()}\u2026`;
  }
};
var normalizer = new AgentTextNormalizer();
var oneLineSchema = (max) => z7.string().transform((value) => normalizer.oneLine(value, max)).pipe(z7.string().min(1, "must not be blank"));
var multiLineSchema = (max) => z7.string().transform((value) => normalizer.multiLine(value, max)).pipe(z7.string().min(1, "must not be blank"));
var optionalSchema = (schema) => z7.preprocess((value) => value === "" || value === null ? void 0 : value, schema.optional());
var AgentSessionIdSchema = z7.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "must be 1\u201380 letters, digits, underscores or hyphens");
var AgentRecordIdSchema = AgentSessionIdSchema;
var TicketKeySchema = z7.string().transform((value) => value.trim().toUpperCase()).pipe(z7.string().regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$/, "must be a Jira issue key: project key, hyphen, number"));
var RepoSchema = z7.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/)?[A-Za-z0-9_.-]{1,100}$/, "must be owner/name or name").refine((value) => !value.includes(".."), "must not contain ..");
var BranchSchema = z7.string().regex(/^[A-Za-z0-9_+@][A-Za-z0-9._/+@-]{0,254}$/, "must be a branch name as git prints it").refine((value) => !value.includes(".."), "must not contain ..");
var SkillSchema = z7.string().regex(/^[A-Za-z0-9:._-]{1,80}$/, "must be up to 80 of A-Z a-z 0-9 : . _ -");
var HeartbeatInputSchema = z7.strictObject({
  session: AgentSessionIdSchema,
  step: oneLineSchema(agentLimits.step),
  state: z7.enum(agentStates),
  ticket: optionalSchema(TicketKeySchema),
  repo: optionalSchema(RepoSchema),
  branch: optionalSchema(BranchSchema),
  skill: optionalSchema(SkillSchema),
  detail: optionalSchema(oneLineSchema(agentLimits.heartbeatDetail))
});
var ItemInputSchema = z7.strictObject({
  session: AgentSessionIdSchema,
  kind: z7.enum(agentItemKinds),
  title: oneLineSchema(agentLimits.title),
  ticket: optionalSchema(TicketKeySchema),
  detail: optionalSchema(multiLineSchema(agentLimits.itemDetail)),
  options: z7.array(oneLineSchema(agentLimits.option)).max(agentLimits.options, `up to ${agentLimits.options} options`).refine((labels) => new Set(labels).size === labels.length, "options must be distinct").optional(),
  id: optionalSchema(AgentRecordIdSchema)
});
var ActivityInputSchema = z7.strictObject({
  session: AgentSessionIdSchema,
  text: oneLineSchema(agentLimits.text),
  level: optionalSchema(z7.enum(agentActivityLevels)),
  ticket: optionalSchema(TicketKeySchema),
  id: optionalSchema(AgentRecordIdSchema)
});
var AgentSessionSchema = z7.looseObject({
  id: z7.string(),
  ownerId: z7.string(),
  ticket: z7.string().nullable(),
  step: z7.string(),
  state: z7.string(),
  lastHeartbeat: z7.string(),
  running: z7.boolean()
});
var AgentItemSchema = z7.looseObject({
  id: z7.string(),
  session: z7.string(),
  kind: z7.string(),
  ticket: z7.string().nullable(),
  title: z7.string(),
  detail: z7.string().nullable(),
  options: z7.array(z7.string()),
  status: z7.string(),
  chosenOption: z7.string().nullable(),
  createdAt: z7.string(),
  resolvedAt: z7.string().nullable(),
  resolvedBy: z7.string().nullable()
});
var AgentActivitySchema = z7.looseObject({
  id: z7.string(),
  at: z7.string(),
  session: z7.string(),
  ticket: z7.string().nullable(),
  level: z7.string(),
  text: z7.string()
});
var HeartbeatResponseSchema = z7.looseObject({ session: AgentSessionSchema });
var ItemResponseSchema = z7.looseObject({ item: AgentItemSchema, created: z7.boolean() });
var ActivityResponseSchema = z7.looseObject({ activity: AgentActivitySchema, created: z7.boolean() });
var ItemListResponseSchema = z7.looseObject({ items: z7.array(AgentItemSchema) });
var AgentErrorBodySchema = z7.looseObject({ error: z7.string(), message: z7.string().optional() });

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
var ConfigSchema = z8.object({
  tracker: z8.enum(["github", "jira"]),
  repo: z8.string().optional().describe("GitHub owner/repo; required when tracker is github"),
  jiraHost: JiraHostSchema.optional().describe(
    "Atlassian Cloud host, e.g. acme.atlassian.net"
  ),
  jiraEmail: z8.string().optional().describe("Atlassian account email for Basic auth"),
  jiraProject: z8.string().optional().describe("Jira project key holding epics and tickets"),
  jpdProject: z8.string().optional().describe("Jira Product Discovery project key holding initiatives"),
  confluenceSpaceKey: z8.string().optional().describe("Confluence space key holding technical design docs"),
  inProgressStatus: z8.string().optional().describe(
    "Tracker status meaning work has started; discovered and stored on first run"
  ),
  inReviewStatus: z8.string().optional().describe(
    "Tracker status meaning a PR is open; discovered and stored on first run"
  ),
  defaultLabels: z8.array(z8.string()).default([]),
  rfcStorage: z8.enum(["local", "global"]).default("local"),
  rfcStoragePath: z8.string().optional(),
  qaRecipe: z8.string().optional().describe(
    "Deprecated: path to a legacy QA recipe, read only when no QA.md or AGENTS.md QA section exists; relative paths resolve against the directory holding this config file; defaults to flight-rules.qa.md beside it"
  ),
  competencies: z8.array(z8.string()).default([...seedCompetencies]),
  "ariadne.url": AriadneUrlSchema.optional().describe(
    "Ariadne API base URL for `flight-rules board`; https only (http for localhost); read only from user or local scope; defaults to the production Ariadne API"
  ),
  "ariadne.enabled": z8.boolean().optional().describe(
    "Set false to stop `flight-rules board` reporting even when an Ariadne token is set; read only from user or local scope; defaults to true"
  )
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
function resolveConfigPath(cwd, override, probe = nodePathProbe) {
  if (override !== void 0) {
    return isAbsolute(override) ? override : resolve2(cwd, override);
  }
  const claudePath = resolve2(cwd, ".claude", "flight-rules.local.md");
  const agentsPath = resolve2(cwd, ".agents", "flight-rules.local.md");
  const candidates = [claudePath, agentsPath];
  const existing = candidates.find((path) => probe.isFile(path));
  if (existing !== void 0) return existing;
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
import { z as z9 } from "zod";
var pluginId = "flight-rules@flight-rules";
var pluginKeyPattern = /^flight-rules(@.+)?$/;
var SettingsSchema = z9.looseObject({
  pluginConfigs: z9.record(z9.string(), z9.looseObject({ options: z9.record(z9.string(), z9.unknown()).optional() })).optional()
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

// src/shared/config-store.ts
var configScopes = ["user", "project", "local", "file"];
var userScopedKeys = /* @__PURE__ */ new Set(["ariadne.url", "ariadne.enabled"]);
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
    this.hostSettings = props.hostSettings ?? new ClaudeSettingsSource({
      cwd: props.cwd,
      env: this.env,
      ...props.home !== void 0 ? { home: props.home } : {},
      ...props.untrackedRoot !== void 0 ? { untrackedCwd: props.untrackedRoot } : {}
    });
  }
  /** The flight-rules config file path, as `flight-rules config path` reports it. */
  filePath() {
    const override = this.env["FLIGHT_RULES_CONFIG"];
    const here = resolveConfigPath(this.cwd, override, this.pathProbe);
    if (override !== void 0 || this.untrackedRoot === void 0) return here;
    const isFile = this.pathProbe?.isFile.bind(this.pathProbe) ?? existsSync4;
    return isFile(here) ? here : resolveConfigPath(this.untrackedRoot, void 0, this.pathProbe);
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
    if (result.success) return { valid: true, ...merged, values: result.data };
    const error = Object.keys(merged.values).length === 0 ? "no flight-rules config found" : result.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
    return { valid: false, error, ...merged };
  }
  /**
   * The scope a write lands in when the caller names none: wherever the key
   * is set now, else `user` for a person-level key such as `ariadne.url`,
   * else the config file when one exists, else `local`.
   */
  defaultScopeFor(key) {
    const layers = this.layers();
    const owner = [...layers].reverse().find((layer) => key in layer.values);
    if (owner !== void 0) return owner.scope;
    if (userScopedKeys.has(key)) return "user";
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
      if (!existsSync4(path)) return { scope, path, present: false, values: {} };
      return { scope, path, present: true, values: parseFrontmatter(readFileSync4(path, "utf-8")) };
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
    const contents = existsSync4(path) ? readFileSync4(path, "utf-8") : void 0;
    mkdirSync2(dirname4(path), { recursive: true });
    const values = update(contents === void 0 ? {} : parseFrontmatter(contents));
    const body = contents?.replace(/^---\n[\s\S]*?\n---\n?/, "") ?? "";
    writeFileSync2(path, `${this.toFrontmatter(values)}${body}`);
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
    const isBoolean = field.safeParse(true).success && !field.safeParse("").success;
    const joined = rawValues.join(" ");
    const value = isArray ? [...rawValues] : isBoolean && (joined === "true" || joined === "false") ? joined === "true" : joined;
    const result = field.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid value for ${key}: ${result.error.issues.map((i) => i.message).join("; ")}`);
    }
    return value;
  }
};

// src/git/worktree-locator/worktree-locator.ts
import { execFileSync } from "node:child_process";
import { basename, dirname as dirname5 } from "node:path";
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
    return dirname5(commonDir);
  }
};

// src/tasks/evidence/evidence-location.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { dirname as dirname6, join as join5 } from "node:path";
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
    const path = join5(dirname6(resolveConfigPath(this.root, void 0)), "evidence", ticket);
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
import { z as z10 } from "zod";
var EnvSchema = z10.object({
  githubToken: z10.string().optional(),
  jiraToken: z10.string().optional(),
  jiraEmail: z10.string().optional(),
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

// src/version.ts
var appVersion = false ? "0.0.0-dev" : "1.59.0";

// src/shared/ariadne/ariadne-transport.ts
var FetchAriadneTransport = class {
  async send(request) {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...request.body !== void 0 ? { body: request.body } : {},
      signal: AbortSignal.timeout(request.timeoutMs)
    });
    return { status: response.status, body: await response.text() };
  }
};

// src/shared/ariadne/ariadne-client.ts
var AriadneError = class extends Error {
  failure;
  status;
  code;
  constructor(props) {
    super(props.message, props.cause === void 0 ? void 0 : { cause: props.cause });
    this.name = "AriadneError";
    this.failure = props.failure;
    this.status = props.status;
    this.code = props.code;
  }
};
var ariadneTimeoutMs = 5e3;
var ariadneAttempts = 2;
var AriadneClient = class {
  baseUrl;
  token;
  transport;
  timeoutMs;
  constructor(props) {
    this.baseUrl = props.baseUrl.replace(/\/+$/, "");
    this.token = props.token;
    this.transport = props.transport ?? new FetchAriadneTransport();
    this.timeoutMs = props.timeoutMs ?? ariadneTimeoutMs;
  }
  /** POST /v1/agents/heartbeat: creates or updates the session. */
  async heartbeat(input) {
    const body = this.validate(HeartbeatInputSchema, input, "heartbeat");
    return this.request("POST", "/v1/agents/heartbeat", HeartbeatResponseSchema, body);
  }
  /** POST /v1/agents/items: 404 `session_not_found` until the session has a heartbeat. */
  async postItem(input) {
    const body = this.validate(ItemInputSchema, input, "item");
    return this.request("POST", "/v1/agents/items", ItemResponseSchema, body);
  }
  /** POST /v1/agents/activity: 404 `session_not_found` until the session has a heartbeat. */
  async postActivity(input) {
    const body = this.validate(ActivityInputSchema, input, "activity");
    return this.request("POST", "/v1/agents/activity", ActivityResponseSchema, body);
  }
  /** GET /v1/agents/items?session=…: every item of the session, open and resolved, oldest first. */
  async listItems(session) {
    const id = this.validate(AgentSessionIdSchema, session, "session");
    return this.request("GET", `/v1/agents/items?session=${encodeURIComponent(id)}`, ItemListResponseSchema);
  }
  validate(schema, input, what) {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    const detail = result.error.issues.map((issue) => `${issue.path.join(".") || what}: ${issue.message}`).join("; ");
    throw new AriadneError({ failure: "invalid-input", message: `invalid ${what}: ${detail}` });
  }
  async request(method, path, schema, body) {
    const request = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        Accept: "application/json",
        "User-Agent": `flight-rules/${appVersion}`,
        ...this.token !== void 0 ? { Authorization: `Bearer ${this.token}` } : {},
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      ...body !== void 0 ? { body: JSON.stringify(body) } : {},
      timeoutMs: this.timeoutMs
    };
    const response = await this.send(request);
    if (response.status < 200 || response.status > 299) throw this.httpError(response);
    let json;
    try {
      json = JSON.parse(response.body);
    } catch (err) {
      throw new AriadneError({ failure: "bad-response", message: `${method} ${path} returned a body that is not JSON`, cause: err });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AriadneError({
        failure: "bad-response",
        message: `${method} ${path} returned an unexpected shape: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`
      });
    }
    return parsed.data;
  }
  async send(request) {
    let lastError;
    for (let attempt = 1; attempt <= ariadneAttempts; attempt++) {
      try {
        const response = await this.transport.send(request);
        if (response.status < 500 || attempt === ariadneAttempts) return response;
      } catch (err) {
        lastError = err;
      }
    }
    throw new AriadneError({
      failure: "network",
      message: `no response from ${this.baseUrl} after ${ariadneAttempts} attempts (${this.describeNetworkError(lastError)})`,
      cause: lastError
    });
  }
  describeNetworkError(err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return `timed out after ${this.timeoutMs / 1e3} s`;
    }
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    return err instanceof Error ? `${err.message}${cause}` : String(err);
  }
  httpError(response) {
    let parsed;
    try {
      const result = AgentErrorBodySchema.safeParse(JSON.parse(response.body));
      parsed = result.success ? result.data : void 0;
    } catch {
      parsed = void 0;
    }
    const code = parsed?.error;
    const reason = parsed?.message ?? (code === void 0 ? "no error body" : "");
    return new AriadneError({
      failure: "http",
      status: response.status,
      ...code !== void 0 ? { code } : {},
      message: [`${response.status}`, code, reason].filter((part) => part !== void 0 && part !== "").join(" ")
    });
  }
};

// src/shared/ariadne/ariadne-board.ts
var claudeSessionEnv = "CLAUDE_CODE_SESSION_ID";
var bootstrapStep = "started";
var personalScopes = /* @__PURE__ */ new Set(["user", "local"]);
var scopeLabels = {
  user: "user settings",
  project: "project settings",
  local: "local settings",
  file: "the flight-rules config file"
};
var urlKey = "ariadne.url";
var enabledKey = "ariadne.enabled";
var AriadneBoard = class {
  readLayers;
  tokens;
  env;
  transport;
  timeoutMs;
  sessions;
  constructor(props) {
    this.readLayers = props.readLayers;
    this.tokens = props.tokens;
    this.env = props.env ?? process.env;
    this.transport = props.transport;
    this.timeoutMs = props.timeoutMs;
    this.sessions = props.sessions;
  }
  /**
   * `ariadne.url` (default: production) and `ariadne.enabled` (default:
   * true), read only from the user and local layers, local winning. Project
   * and file layers are ignored with a notice. A URL that is not https (or
   * http on localhost) leaves `url` undefined, so nothing is ever sent to it.
   */
  settings() {
    const notices = [];
    let rawUrl;
    let rawEnabled;
    for (const layer of this.readLayers()) {
      for (const key of [urlKey, enabledKey]) {
        if (!(key in layer.values)) continue;
        const value = layer.values[key];
        if (!personalScopes.has(layer.scope)) {
          notices.push(`ignored ${key} from ${scopeLabels[layer.scope]}; set it in user scope`);
          continue;
        }
        if (value === void 0 || value === null || value === "") continue;
        if (key === urlKey) rawUrl = { value, scope: layer.scope };
        else rawEnabled = { value, scope: layer.scope };
      }
    }
    let url = defaultAriadneUrl;
    if (rawUrl !== void 0) {
      const parsed = AriadneUrlSchema.safeParse(rawUrl.value);
      url = parsed.success ? parsed.data : void 0;
      if (!parsed.success) {
        notices.push(
          `ignored ${urlKey} from ${scopeLabels[rawUrl.scope]}: ${parsed.error.issues.map((i) => i.message).join("; ")}; nothing is sent until it is fixed`
        );
      }
    }
    let enabled = true;
    if (rawEnabled !== void 0) {
      const value = rawEnabled.value;
      if (value === true || value === "true") enabled = true;
      else if (value === false || value === "false") enabled = false;
      else {
        enabled = false;
        notices.push(`ignored ${enabledKey} from ${scopeLabels[rawEnabled.scope]}: expected true or false; reporting is off until it is fixed`);
      }
    }
    return { url, enabled, notices };
  }
  /** The Claude Code session id, when this process runs inside a session. */
  defaultSession() {
    const value = this.env[claudeSessionEnv]?.trim();
    return value === void 0 || value === "" ? void 0 : value;
  }
  /**
   * Posts a heartbeat and remembers it for the session, so the heartbeat
   * hook can keep the session alive with the same ticket and step.
   */
  async heartbeat(input, options = {}) {
    return this.call(
      options,
      input.session,
      async (client, session) => {
        const sent = { ...input, session };
        try {
          const response = await client.heartbeat(sent);
          this.remember(sent);
          return response;
        } catch (err) {
          if (!(err instanceof AriadneError) || err.failure !== "invalid-input") this.remember(sent);
          throw err;
        }
      },
      input.ticket
    );
  }
  /**
   * Re-sends the last heartbeat a skill posted for `session`, without
   * refreshing when it was recorded. The heartbeat hook's liveness ping.
   */
  async replay(session, options = {}) {
    const record = this.sessions?.read(session);
    if (record === void 0) return { status: "skipped", reason: "nothing-recorded" };
    return this.call(options, session, (client) => client.heartbeat(record.heartbeat), record.heartbeat.ticket);
  }
  /**
   * Posts an item. A session that has never sent a heartbeat (or has aged
   * out) gets one first, with step `started` and state `nominal`, and the item
   * is posted again. A live session's step is never overwritten this way.
   */
  async item(input, options = {}) {
    return this.call(
      options,
      input.session,
      (client, session) => this.withSession(client, session, input.ticket, () => client.postItem({ ...input, session })),
      input.ticket
    );
  }
  /** Posts one activity line, creating the session first as `item` does. */
  async activity(input, options = {}) {
    return this.call(
      options,
      input.session,
      (client, session) => this.withSession(client, session, input.ticket, () => client.postActivity({ ...input, session })),
      input.ticket
    );
  }
  /** Every item of one of the caller's sessions, open and resolved, with any chosen option. */
  async items(session, options = {}) {
    return this.call(options, session, (client, id) => client.listItems(id));
  }
  /** Remembering is best effort: a full disk must not fail a report. */
  remember(heartbeat) {
    try {
      this.sessions?.record(heartbeat);
    } catch {
      return;
    }
  }
  async withSession(client, session, ticket, post) {
    try {
      return await post();
    } catch (err) {
      if (!(err instanceof AriadneError) || err.code !== "session_not_found") throw err;
    }
    await client.heartbeat({ session, ticket, step: bootstrapStep, state: "nominal" });
    return post();
  }
  async call(options, requestedSession, run, ticket) {
    let settings;
    try {
      settings = this.settings();
    } catch (err) {
      return { status: "failed", message: err instanceof Error ? err.message : String(err) };
    }
    const noted = (outcome) => settings.notices.length > 0 ? { ...outcome, notices: settings.notices } : outcome;
    const url = settings.url;
    if (!settings.enabled) return noted({ status: "skipped", reason: "disabled" });
    if (url === void 0) return noted({ status: "skipped", reason: "invalid-url" });
    if (ticket !== void 0 && ticket !== "" && !TicketKeySchema.safeParse(ticket).success) {
      return {
        status: "skipped",
        reason: "not-jira-ticket",
        notices: [...settings.notices, `skipped: ${ticket} is not a Jira issue key, and Ariadne tracks only Jira tickets`]
      };
    }
    let token;
    try {
      token = this.tokens.resolve()?.token;
    } catch (err) {
      return noted({ status: "failed", message: err instanceof Error ? err.message : String(err) });
    }
    if (token === void 0 && options.strict !== true) return noted({ status: "skipped", reason: "no-token" });
    const session = requestedSession ?? this.defaultSession();
    if (session === void 0) {
      return noted({
        status: "failed",
        message: `no session id: pass --session, or run inside Claude Code so ${claudeSessionEnv} is set`
      });
    }
    const client = new AriadneClient({
      baseUrl: url,
      token,
      ...this.transport !== void 0 ? { transport: this.transport } : {},
      ...this.timeoutMs !== void 0 ? { timeoutMs: this.timeoutMs } : {}
    });
    try {
      return noted({ status: "posted", value: await run(client, session) });
    } catch (err) {
      return noted({ status: "failed", message: this.redact(this.describe(err, url, token !== void 0), token) });
    }
  }
  describe(err, url, hasToken) {
    if (!(err instanceof AriadneError)) return err instanceof Error ? err.message : String(err);
    if (err.status === 401 && err.code === "agent_token_expired") {
      return "Ariadne agent token expired (401 agent_token_expired) \u2014 create a new one in Ariadne \u203A Settings \u203A Connections and run `flight-rules board login`";
    }
    if (err.status === 401) {
      return hasToken ? "Ariadne agent token not recognised (401 unauthorized); it may be revoked or mistyped. Create a new one in Ariadne \u203A Settings \u203A Connections and set ARIADNE_AGENT_TOKEN or run `flight-rules board login`" : "no Ariadne token (401 unauthorized). Set ARIADNE_AGENT_TOKEN, or run `flight-rules board login` with an agent token from Ariadne \u203A Settings \u203A Connections";
    }
    if (err.code === "agents_opt_in_required") {
      return "Agents reporting is off for you (403 agents_opt_in_required). Turn on Agents in Ariadne \u203A Settings \u203A Connections";
    }
    if (err.failure === "network") return `could not reach Ariadne at ${url}: ${err.message}`;
    return `Ariadne ${err.failure === "http" ? "returned" : "request failed:"} ${err.message}`;
  }
  /** Belt and braces: no message may ever carry the token. */
  redact(message, token) {
    return token === void 0 || token === "" ? message : message.split(token).join("[redacted]");
  }
};

// src/shared/ariadne/ariadne-token-store.ts
import { chmodSync, existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync as readFileSync5, rmSync, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname7, join as join6 } from "node:path";
var agentTokenPattern = /^ariadne_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;
var ariadneTokenEnvNames = ["ARIADNE_AGENT_TOKEN", "ARIADNE_TOKEN"];
var AriadneTokenStore = class {
  env;
  home;
  constructor(props = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir2();
  }
  isAgentToken(value) {
    return agentTokenPattern.test(value);
  }
  /** `$XDG_CONFIG_HOME/flight-rules/ariadne-token`, else `~/.config/flight-rules/ariadne-token`. */
  path() {
    const configHome = this.env["XDG_CONFIG_HOME"];
    const base = configHome !== void 0 && configHome !== "" ? configHome : join6(this.home, ".config");
    return join6(base, "flight-rules", "ariadne-token");
  }
  resolve() {
    for (const name of ariadneTokenEnvNames) {
      const value2 = this.env[name]?.trim();
      if (value2 !== void 0 && value2 !== "") return { token: value2, source: name };
    }
    const path = this.path();
    if (!existsSync5(path)) return void 0;
    const value = readFileSync5(path, "utf-8").trim();
    return value === "" ? void 0 : { token: value, source: "file" };
  }
  /** The environment variable that would win over a saved file, if one is set. */
  shadowingEnv() {
    return ariadneTokenEnvNames.find((name) => (this.env[name]?.trim() ?? "") !== "");
  }
  /** Saves an agent token with mode 0600 and returns the path. Rejects anything that is not one. */
  save(token) {
    const value = token.trim();
    if (!this.isAgentToken(value)) {
      throw new Error(
        "That is not an Ariadne agent token (expected ariadne_agent_<16 hex>_<43 characters>). Create one in Ariadne \u203A Settings \u203A Connections."
      );
    }
    const path = this.path();
    mkdirSync3(dirname7(path), { recursive: true, mode: 448 });
    writeFileSync3(path, `${value}
`, { mode: 384 });
    chmodSync(path, 384);
    return path;
  }
  /** Deletes the saved token; returns whether one existed. */
  remove() {
    const path = this.path();
    if (!existsSync5(path)) return false;
    rmSync(path);
    return true;
  }
};

// src/shared/ariadne/board-session-store.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync6, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join7 } from "node:path";
import { z as z11 } from "zod";
var SessionRecordSchema = z11.object({
  heartbeat: z11.object({
    session: z11.string(),
    step: z11.string(),
    state: z11.enum(agentStates),
    ticket: z11.string().optional(),
    repo: z11.string().optional(),
    branch: z11.string().optional(),
    skill: z11.string().optional(),
    detail: z11.string().optional()
  }),
  /** When a skill last posted this heartbeat. */
  recordedAt: z11.number(),
  /** When any heartbeat for the session was last sent, by a skill or the hook. */
  sentAt: z11.number()
});
var sessionFilePattern = /^[A-Za-z0-9_-]{1,80}$/;
var BoardSessionStore = class {
  env;
  home;
  now;
  constructor(props = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir3();
    this.now = props.now ?? Date.now;
  }
  dir() {
    const stateHome = this.env["XDG_STATE_HOME"];
    const base = stateHome !== void 0 && stateHome !== "" ? stateHome : join7(this.home, ".local", "state");
    return join7(base, "flight-rules", "board");
  }
  read(session) {
    const path = this.pathFor(session);
    if (path === void 0 || !existsSync6(path)) return void 0;
    try {
      const parsed = SessionRecordSchema.safeParse(JSON.parse(readFileSync6(path, "utf-8")));
      return parsed.success ? parsed.data : void 0;
    } catch {
      return void 0;
    }
  }
  /** Remembers a heartbeat a skill just sent. */
  record(heartbeat) {
    const now = this.now();
    const { session, step, state } = heartbeat;
    const optional = Object.fromEntries(
      ["ticket", "repo", "branch", "skill", "detail"].map((key) => [key, heartbeat[key]]).filter(([, value]) => value !== void 0 && value !== "")
    );
    this.write({ heartbeat: { session, step, state, ...optional }, recordedAt: now, sentAt: now });
  }
  /**
   * Claims the next liveness heartbeat for a session: returns its record and
   * marks it sent, or returns undefined when there is nothing to keep alive.
   * That is when no skill has recorded one, the record is older than
   * `maxAgeMs`, the run aborted, or one was sent less than `intervalMs` ago.
   */
  claim(session, intervalMs, maxAgeMs) {
    const record = this.read(session);
    if (record === void 0) return void 0;
    const now = this.now();
    if (record.heartbeat.state === "abort") return void 0;
    if (now - record.recordedAt > maxAgeMs) return void 0;
    if (now - record.sentAt < intervalMs) return void 0;
    const claimed = { ...record, sentAt: now };
    this.write(claimed);
    return claimed;
  }
  write(record) {
    const path = this.pathFor(record.heartbeat.session);
    if (path === void 0) return;
    mkdirSync4(this.dir(), { recursive: true, mode: 448 });
    writeFileSync4(path, JSON.stringify(record), { mode: 384 });
  }
  pathFor(session) {
    return sessionFilePattern.test(session) ? join7(this.dir(), `${session}.json`) : void 0;
  }
};

// src/tasks/github-task-tracker/github-task-tracker.ts
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

// src/tasks/body-metadata/body-metadata.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// src/tasks/task-tracker/task-tracker.ts
import { z as z12 } from "zod";
var TrackerUserSchema = z12.object({
  accountId: z12.string(),
  displayName: z12.string()
});
var EntityMetadataSchema = z12.object({
  tddId: z12.number().optional(),
  epicId: z12.number().optional(),
  notes: z12.string().optional(),
  /** Explicit body-format override read first by BodyFormatDetector (docs/bug-report-format.md). */
  kind: z12.enum(["bug", "story"]).optional()
}).passthrough();
var CommentSchema = z12.object({
  id: z12.string(),
  body: z12.string(),
  author: z12.string(),
  createdAt: z12.string(),
  updatedAt: z12.string()
});
var AttachmentSchema = z12.object({
  id: z12.string(),
  filename: z12.string(),
  mimeType: z12.string(),
  size: z12.number().optional(),
  mediaUuid: z12.string().optional()
});
var TechnicalDesignSchema = z12.object({
  id: z12.string(),
  epicId: z12.string(),
  url: z12.string().optional(),
  body: z12.string(),
  comments: z12.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z12.string()
});
var TicketSchema = z12.object({
  id: z12.string(),
  size: z12.literal("ticket"),
  status: z12.string(),
  labels: z12.array(z12.string()),
  title: z12.string(),
  body: z12.string(),
  comments: z12.array(CommentSchema),
  assignee: z12.string().nullable(),
  attachments: z12.array(AttachmentSchema).default([]),
  reporter: z12.string().nullable().default(null),
  issueType: z12.string().default("unknown"),
  blockedBy: z12.array(z12.string()).default([]),
  blocking: z12.array(z12.string()).default([]),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z12.string()
});
var EpicSchema = z12.object({
  id: z12.string(),
  size: z12.literal("epic"),
  status: z12.string(),
  labels: z12.array(z12.string()),
  title: z12.string(),
  body: z12.string(),
  childIssues: z12.array(TicketSchema),
  comments: z12.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z12.string()
});
var CreateEpicInputSchema = z12.object({
  title: z12.string(),
  body: z12.string(),
  labels: z12.array(z12.string()).default([]),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTicketInputSchema = z12.object({
  title: z12.string(),
  body: z12.string(),
  /** Absent for a standalone ticket: a ticket-sized RFC has no epic to parent to. */
  epicId: z12.string().optional(),
  labels: z12.array(z12.string()).default([]),
  assignee: z12.string().optional(),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTechnicalDesignInputSchema = z12.object({
  title: z12.string(),
  body: z12.string(),
  epicId: z12.string(),
  metadata: EntityMetadataSchema.partial().optional()
});
var UpdateEpicInputSchema = z12.object({
  body: z12.string(),
  title: z12.string().optional(),
  labels: z12.array(z12.string()).optional()
});
var UpdateTicketInputSchema = z12.object({
  body: z12.string(),
  title: z12.string().optional(),
  labels: z12.array(z12.string()).optional()
});
var UpdateInitiativeInputSchema = z12.object({
  body: z12.string(),
  title: z12.string().optional()
});
var InitiativeSchema = z12.object({
  id: z12.string(),
  size: z12.literal("initiative"),
  title: z12.string(),
  body: z12.string(),
  epics: z12.array(z12.object({ id: z12.string(), title: z12.string() })).default([])
});
var CreateInitiativeInputSchema = z12.object({
  title: z12.string(),
  body: z12.string()
});

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
import { z as z14 } from "zod";

// src/tasks/task-tracker/unsupported-tracker-operation-error.ts
import { z as z13 } from "zod";
var UnsupportedTrackerOperationPropsSchema = z13.object({
  tracker: z13.string().min(1),
  operation: z13.string().min(1),
  remedy: z13.string().min(1).optional()
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
var IssueRefListSchema = z14.array(z14.object({ number: z14.number() }));
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
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      })
    ]);
    const issue = issueResponse.data;
    const body = issue.body ?? "";
    const metadata = this.bodyMetadata.parse(body);
    const childNumbers = IssueRefListSchema.parse(subIssuesResponse.data).map((ref) => String(ref.number));
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
    if (input.epicId !== void 0) await this.linkTicketToEpic(String(data.number), input.epicId);
    return this.mapTicket(data, [], [], [], this.bodyMetadata.parse(data.body ?? ""));
  }
  async getTicket(id) {
    const issueNumber = parseInt(id, 10);
    const [issueResponse, commentsResponse, blockedByResponse, blockingResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      }),
      this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      })
    ]);
    const body = issueResponse.data.body ?? "";
    const metadata = this.bodyMetadata.parse(body);
    const blockedBy = IssueRefListSchema.parse(blockedByResponse.data).map((ref) => String(ref.number));
    const blocking = IssueRefListSchema.parse(blockingResponse.data).map((ref) => String(ref.number));
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
    const stale = issue.labels.map((l) => this.labelName(l)).filter(
      (name) => name.startsWith("status:") && name.toLowerCase() !== label.toLowerCase()
    );
    for (const name of stale) {
      await this.octokit.rest.issues.removeLabel({ owner: this.owner, repo: this.repo, issue_number: issueNumber, name });
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
    return this.getEpic(epicId);
  }
  async updateTicketDescription(ticketId, input) {
    await this.replaceIssueBody(ticketId, "ticket", input);
    return this.getTicket(ticketId);
  }
  async updateInitiativeDescription(initiativeId, input) {
    await this.octokit.rest.issues.updateMilestone({
      owner: this.owner,
      repo: this.repo,
      milestone_number: parseInt(initiativeId, 10),
      description: input.body,
      ...input.title !== void 0 ? { title: input.title } : {}
    });
    return this.getInitiative(initiativeId);
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
      throw new Error(`No "TDDs" discussion category found. Create it in the repo's GitHub Discussions settings.`);
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
    await this.updateEpicMetadata(input.epicId, { tddId: discussion.number });
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
  async addComment(entityId, body) {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(entityId, 10),
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
  async ping() {
    await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
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
    const labels = await this.octokit.paginate(
      this.octokit.rest.issues.listLabelsForRepo,
      { owner: this.owner, repo: this.repo, per_page: 100 }
    );
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
import { z as z18 } from "zod";

// src/tasks/jira-task-tracker/jira-client.ts
import { z as z15 } from "zod";

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
var JiraErrorBodySchema = z15.object({
  errorMessages: z15.array(z15.string()).optional(),
  // Caught per-field so an off-contract `errors` map cannot discard a valid sibling `errorMessages`.
  errors: z15.record(z15.string(), z15.string()).optional().catch(void 0),
  message: z15.string().optional()
});
var JiraClient = class {
  baseUrl;
  authHeader;
  constructor(config) {
    this.baseUrl = `https://${config.host}/rest/api/3`;
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
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const parsedRetryAfter = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : defaultRetryAfterSeconds;
      const jitter = 0.7 + Math.random() * 0.6;
      const delayMs = Math.min(retryAfterSeconds * 1e3 * jitter, maxBackoffMs);
      await new Promise((resolve3) => setTimeout(resolve3, delayMs));
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
import { z as z16 } from "zod";
var maxRetries2 = 4;
var defaultRetryAfterSeconds2 = 2;
var maxBackoffMs2 = 3e4;
var ConfluenceErrorBodySchema = z16.object({
  errors: z16.array(z16.object({ title: z16.string().optional(), detail: z16.string().optional() })).optional().catch(void 0),
  message: z16.string().optional()
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
      await new Promise((resolve3) => setTimeout(resolve3, delayMs));
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
import { z as z17 } from "zod";
var MediaRefSchema = z17.object({
  mediaUuid: z17.string().min(1),
  collection: z17.string().default(""),
  width: z17.number().int().positive().optional(),
  height: z17.number().int().positive().optional()
});
var MediaLookupSchema = z17.record(z17.string(), MediaRefSchema);
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
    const basename4 = target.slice(target.lastIndexOf("/") + 1);
    return Object.hasOwn(media, basename4) ? media[basename4] : void 0;
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
var JiraUploadedAttachmentSchema = z18.object({
  id: z18.union([z18.string(), z18.number()]).transform(String),
  filename: z18.string(),
  mimeType: z18.string(),
  size: z18.number().optional()
});
var JiraUploadedAttachmentsSchema = z18.array(JiraUploadedAttachmentSchema);
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
    this.confluence = new ConfluenceClient({ host: config.host, email: config.email, token: config.token });
    this.project = config.project;
    this.jpdProject = config.jpdProject;
    this.confluenceSpaceKey = config.confluenceSpaceKey;
  }
  async createEpic(input) {
    const issuetype = await this.resolveIssueType("Epic");
    const description = this.metadata.splice(this.bodyFormat.toAdf(input.body), input.metadata ?? {});
    const created = await this.client.request("POST", "/issue", {
      fields: {
        project: { key: this.project },
        issuetype: { name: issuetype },
        summary: input.title,
        description,
        labels: input.labels
      }
    });
    return this.getEpic(created.key);
  }
  async getEpic(id) {
    const issue = await this.client.request("GET", `/issue/${id}`, void 0, { fields: issueFields });
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
    const description = this.metadata.splice(this.bodyFormat.toAdf(input.body), input.metadata ?? {});
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
    return this.getTicket(created.key);
  }
  async getTicket(id) {
    const [issue, blocksLinkType] = await Promise.all([
      this.client.request("GET", `/issue/${id}`, void 0, { fields: ticketFields }),
      this.resolveBlocksLinkType()
    ]);
    return this.mapTicket(issue, blocksLinkType);
  }
  async linkTicketToEpic(ticketId, epicId) {
    const issue = await this.client.request("GET", `/issue/${ticketId}`, void 0, { fields: "parent" });
    if (issue.fields.parent?.key === epicId) return;
    await this.client.request("PUT", `/issue/${ticketId}`, { fields: { parent: { key: epicId } } });
  }
  async blockTicket(ticketId, blockedById) {
    if (ticketId === blockedById) throw new Error("a ticket cannot block itself");
    const blocksLinkType = await this.resolveBlocksLinkType();
    const links = await this.issueLinks(ticketId);
    const alreadyBlocked = links.some(
      (link) => link.type.name === blocksLinkType && link.outwardIssue?.key === blockedById
    );
    if (alreadyBlocked) return;
    await this.client.request("POST", "/issueLink", {
      type: { name: blocksLinkType },
      inwardIssue: { key: ticketId },
      outwardIssue: { key: blockedById }
    });
  }
  async unblockTicket(ticketId, blockedById) {
    const blocksLinkType = await this.resolveBlocksLinkType();
    const links = await this.issueLinks(ticketId);
    const link = links.find(
      (candidate) => candidate.type.name === blocksLinkType && candidate.outwardIssue?.key === blockedById
    );
    if (link?.id === void 0) return;
    await this.client.request("DELETE", `/issueLink/${link.id}`);
  }
  async transitionTicket(ticketId, status) {
    const response = await this.fetchTransitions(ticketId);
    const match = response.transitions.find((transition) => transition.to.name.toLowerCase() === status.toLowerCase());
    if (match === void 0) {
      const available = response.transitions.map((transition) => transition.to.name).join(", ");
      throw new Error(
        `No transition to status "${status}" is available for ${ticketId} from its current status (available: ${available})`
      );
    }
    await this.client.request("POST", `/issue/${ticketId}/transitions`, { transition: { id: match.id } });
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
    await this.client.request("PUT", `/issue/${ticketId}`, { update: { labels: [{ add: label }] } });
  }
  async removeLabel(ticketId, label) {
    await this.client.request("PUT", `/issue/${ticketId}`, { update: { labels: [{ remove: label }] } });
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
    return this.getEpic(epicId);
  }
  async updateTicketDescription(ticketId, input) {
    await this.replaceIssueBody(ticketId, input);
    return this.getTicket(ticketId);
  }
  async updateInitiativeDescription(initiativeId, input) {
    const fields = { description: this.bodyFormat.toAdf(input.body) };
    if (input.title !== void 0) fields["summary"] = input.title;
    await this.client.request("PUT", `/issue/${initiativeId}`, { fields });
    return this.getInitiative(initiativeId);
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
    return this.getInitiative(created.key);
  }
  async getInitiative(id) {
    const idea = await this.client.request("GET", `/issue/${id}`, void 0, {
      fields: "summary,description,issuelinks"
    });
    const deliveryLinkType = await this.resolveDeliveryLinkType();
    const epicKeys = this.deliveryLinkedKeys(idea.fields.issuelinks ?? [], deliveryLinkType);
    const epics = await Promise.all(
      epicKeys.map(async (key) => {
        const epic = await this.client.request("GET", `/issue/${key}`, void 0, { fields: "summary" });
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
      body: { representation: "storage", value: input.body }
    });
    await this.confluence.request("POST", `/pages/${page.id}/properties`, {
      key: tddMetadataPropertyKey,
      value: propertyValue
    });
    await this.updateEpicMetadata(input.epicId, { tddId: Number(page.id) });
    return this.mapTechnicalDesign(page, input.body, propertyValue);
  }
  async getTechnicalDesign(id) {
    const [page, property] = await Promise.all([
      this.confluence.request("GET", `/pages/${id}`, void 0, { "body-format": "storage" }),
      this.tddMetadataProperty(id)
    ]);
    return this.mapTechnicalDesign(page, page.body?.storage?.value ?? "", property?.value ?? {});
  }
  async addComment(entityId, body) {
    const comment = await this.client.request("POST", `/issue/${entityId}/comment`, {
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
    const file = new File([readFileSync7(filePath)], filename, { type: this.mimeTypes.forFilename(filename) });
    const uploaded = JiraUploadedAttachmentsSchema.parse(
      await this.client.upload(`/issue/${ticketId}/attachments`, [file])
    );
    const attachment = uploaded[0];
    if (attachment === void 0) {
      throw new Error(`Jira accepted the upload of ${filename} to ${ticketId} but returned no attachment`);
    }
    return this.mapAttachment(attachment, await this.resolveMediaUuid(attachment.id));
  }
  async getUsers() {
    const users = await this.client.request("GET", "/user/assignable/search", void 0, {
      project: this.project,
      maxResults: 100
    });
    return users.map((user) => ({ accountId: user.accountId, displayName: user.displayName }));
  }
  async ping() {
    await this.client.request("GET", "/myself");
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
    const { blockedBy, blocking } = this.blockingLinks(issue.fields.issuelinks ?? [], blocksLinkType);
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
      if (link.outwardIssue !== void 0) blockedBy.push(link.outwardIssue.key);
      if (link.inwardIssue !== void 0) blocking.push(link.inwardIssue.key);
    });
    return { blockedBy, blocking };
  }
  async replaceIssueBody(key, input) {
    const issue = await this.client.request("GET", `/issue/${key}`, void 0, { fields: "description" });
    const description = this.metadata.splice(this.bodyFormat.toAdf(input.body), this.parseMetadata(issue));
    const fields = { description };
    if (input.title !== void 0) fields["summary"] = input.title;
    if (input.labels !== void 0) fields["labels"] = input.labels;
    await this.client.request("PUT", `/issue/${key}`, { fields });
  }
  async spliceDescriptionMetadata(key, patch) {
    const issue = await this.client.request("GET", `/issue/${key}`, void 0, { fields: "description" });
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
      const response = await this.client.request("GET", "/issueLinkType");
      const match = response.issueLinkTypes.find((type) => type.name.toLowerCase() === "blocks");
      if (match === void 0) {
        const names = response.issueLinkTypes.map((type) => type.name).join(", ");
        throw new Error(`No "Blocks" issue link type is configured in this Jira instance (found: ${names})`);
      }
      this.blocksLinkType = match.name;
    }
    return this.blocksLinkType;
  }
  async resolveDeliveryLinkType() {
    if (this.deliveryLinkType === void 0) {
      const response = await this.client.request("GET", "/issueLinkType");
      const match = response.issueLinkTypes.find((type) => type.outward.toLowerCase() === deliveryLinkOutward);
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
      throw new Error("No Confluence space is configured; set confluenceSpaceKey to create or fetch technical designs");
    }
    if (this.confluenceSpaceId === void 0) {
      const response = await this.confluence.request("GET", "/spaces", void 0, {
        keys: this.confluenceSpaceKey
      });
      const space = response.results[0];
      if (space === void 0) throw new Error(`Confluence space "${this.confluenceSpaceKey}" was not found`);
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
var minimumGhVersion = [2, 99, 0];
var ghVersionLine = /gh version (\d+)\.(\d+)\.(\d+)/;
var NodeToolProbe = class {
  execFile;
  constructor(props = {}) {
    const promisified = promisify3(execFile3);
    this.execFile = props.execFileFn ?? ((file, args) => promisified(file, [...args]));
  }
  async probe(input) {
    const qaRequired = input.qaInstructionsFound;
    const ghRequired = input.repo !== void 0;
    const [gh, ghAuth, ghPush, playwright, ffmpeg, curl] = await Promise.all([
      this.ghVersion(ghRequired),
      this.ghAuth(ghRequired),
      this.ghPush(input.repo, ghRequired),
      this.present("tools:playwright-cli", "playwright-cli", ["--version"], qaRequired),
      this.present("tools:ffmpeg", "ffmpeg", ["-version"], qaRequired),
      this.present("tools:curl", "curl", ["--version"], qaRequired)
    ]);
    return [gh, ghAuth, ghPush, playwright, ffmpeg, curl];
  }
  async ghVersion(required) {
    try {
      const { stdout } = await this.execFile("gh", ["--version"]);
      const match = ghVersionLine.exec(stdout);
      if (match === null) {
        return { name: "tools:gh", ok: false, detail: `unrecognized version output: ${stdout.trim()}`, required };
      }
      const [, major, minor, patch] = match;
      const version = [Number(major), Number(minor), Number(patch)];
      const ok = this.meetsMinimumVersion(version, minimumGhVersion);
      const found = `${version[0]}.${version[1]}.${version[2]}`;
      return {
        name: "tools:gh",
        ok,
        detail: ok ? `gh ${found}` : `gh ${found} is older than the required ${minimumGhVersion.join(".")}`,
        required
      };
    } catch (err) {
      const detail = this.isMissingBinary(err) ? "not installed" : this.stderrOf(err);
      return { name: "tools:gh", ok: false, detail, required };
    }
  }
  async ghAuth(required) {
    try {
      await this.execFile("gh", ["auth", "status"]);
      return { name: "tools:gh-auth", ok: true, detail: "authenticated", required };
    } catch (err) {
      const detail = this.isMissingBinary(err) ? "not installed" : this.stderrOf(err);
      return { name: "tools:gh-auth", ok: false, detail, required };
    }
  }
  async ghPush(repo, required) {
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
        detail: ok ? `push access to ${repo}` : `no push access to ${repo}`,
        required
      };
    } catch (err) {
      const detail = this.isMissingBinary(err) ? "not installed" : this.stderrOf(err);
      return { name: "tools:gh-push", ok: false, detail, required };
    }
  }
  async present(name, file, args, required) {
    try {
      const { stdout } = await this.execFile(file, args);
      return { name, ok: true, detail: stdout.trim().split("\n")[0] ?? "installed", required };
    } catch (err) {
      const detail = this.isMissingBinary(err) ? "not installed" : this.stderrOf(err);
      return { name, ok: false, detail, required };
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
  /** Distinguishes a missing binary (ENOENT) from a binary that ran and failed. */
  isMissingBinary(err) {
    return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
  }
  stderrOf(err) {
    if (typeof err === "object" && err !== null && "stderr" in err) {
      const stderr = err.stderr;
      if (typeof stderr === "string") return stderr.trim();
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }
};
var nodeToolProbe = new NodeToolProbe();

// src/flight-rules/flight-rules.schema.ts
import { z as z19 } from "zod";
var FlightRulesPropsSchema = z19.object({
  cwd: z19.string().optional().describe("Directory used for config discovery; defaults to process.cwd()"),
  env: z19.record(z19.string(), z19.string().optional()).optional().describe("Live environment record; defaults to process.env"),
  configPath: z19.string().optional().describe("Explicit config file, taking precedence over FLIGHT_RULES_CONFIG and discovery")
});

// src/flight-rules/flight-rules.ts
var DefaultFlightRules = class {
  cwd;
  env;
  explicitConfigPath;
  hostSettings;
  untrackedRoot;
  constructor(props = {}) {
    const parsed = FlightRulesPropsSchema.parse({ ...props, env: props.env === void 0 ? void 0 : { ...props.env } });
    this.cwd = parsed.cwd ?? process.cwd();
    this.env = props.env ?? process.env;
    this.explicitConfigPath = parsed.configPath;
    this.hostSettings = props.hostSettings;
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
      ...this.hostSettings !== void 0 ? { hostSettings: this.hostSettings } : {},
      ...untrackedRoot !== void 0 ? { untrackedRoot } : {}
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
      if (env.githubToken === void 0) throw new Error("GITHUB_TOKEN environment variable is required");
      if (config.repo === void 0) throw new Error("repo is required when tracker is github");
      const [owner, repo] = config.repo.split("/");
      if (owner === void 0 || repo === void 0) {
        throw new Error(`Invalid repo format "${config.repo}" \u2014 expected "owner/repo"`);
      }
      return new GitHubTaskTracker({ token: env.githubToken, owner, repo });
    }
    if (env.jiraToken === void 0) {
      throw new Error("JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY) environment variable is required");
    }
    const email = env.jiraEmail ?? config.jiraEmail;
    if (email === void 0) throw new Error("JIRA_EMAIL environment variable or jiraEmail config is required");
    const host = env.jiraHost ?? config.jiraHost;
    if (host === void 0) throw new Error("JIRA_HOST environment variable or jiraHost config is required");
    if (config.jiraProject === void 0) throw new Error("jiraProject is required when tracker is jira");
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
    return new GhPullRequestHost({ repo: config.repo });
  }
  git() {
    return new NodeGitExecutor();
  }
  probe() {
    return nodeToolProbe;
  }
  docs() {
    return FileDocResolver.fromInstall({ moduleUrl: import.meta.url, env: this.env });
  }
  board() {
    return new AriadneBoard({
      readLayers: () => this.configStore().layers(),
      tokens: this.ariadneTokens(),
      env: this.env,
      sessions: this.boardSessions()
    });
  }
  ariadneTokens() {
    return new AriadneTokenStore({ env: this.env });
  }
  boardSessions() {
    return new BoardSessionStore({ env: this.env });
  }
};
function createFlightRules(props = {}) {
  return new DefaultFlightRules(props);
}

// src/git/commit-message-builder/commit-message-builder.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { dirname as dirname8, join as join8 } from "node:path";

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
import { z as z20 } from "zod";
var CommitMessageInputSchema = z20.object({
  type: SemanticTypeSchema,
  // Bare issue numbers make one-character scopes legitimate; 32 clears a 10-character tracker key plus a six-digit number.
  scope: z20.string().min(1).max(32),
  description: z20.string().min(2).max(50),
  body: z20.string().optional(),
  model: z20.string().max(72).optional(),
  footers: z20.array(z20.string().regex(/^[a-zA-Z0-9-]+(: |=).*$/)).default([])
});
var CommitMessageHeaderSchema = z20.preprocess(
  (arg) => {
    return z20.string({ error: "Git Commit headers should be 72 characters or less" }).max(72).parse(arg);
  },
  z20.templateLiteral([SemanticTypeSchema, "(", z20.string(), "): ", z20.string()])
);
var CommitMessageBuilderPropsSchema = z20.object({
  binPath: z20.string().min(1),
  agentEnv: z20.string().optional()
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
      const pkgPath = join8(dirname8(binPath), "..", "package.json");
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

// src/tasks/evidence/evidence.ts
import { basename as basename3 } from "node:path/posix";
import { z as z21 } from "zod";
var mediaReference = /(!?)\[([^\]]*)\]\(\s*<?([^\s()<>]+)>?(?:\s+"[^"]*")?\s*\)/g;
var absoluteTarget = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\/|^#/;
var localPrefix = /^(?:\.\/)+/;
var fenceRun = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var AttachmentSpecSchema = z21.string().min(1).transform((spec) => {
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
var TrackerEvidenceService = class {
  tracker;
  constructor(props) {
    this.tracker = props.tracker;
  }
  async attach(input) {
    const specs = input.specs.map((spec) => AttachmentSpecSchema.parse(spec));
    this.rejectDuplicateNames(specs);
    const attachments = await Promise.all(
      specs.map(async (spec) => {
        const uploaded = await this.tracker.addAttachment(input.ticketId, spec.path);
        return { ...uploaded, path: spec.path, caption: spec.caption, referenced: false };
      })
    );
    const byName = /* @__PURE__ */ new Map();
    for (const attachment of attachments) byName.set(basename3(attachment.path), attachment);
    const rewritten = this.rewriteReferences(input.body, byName);
    return { body: this.appendUnreferenced(rewritten, attachments), attachments };
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
    const match = fenceRun.exec(line);
    if (match === null) return void 0;
    const run = match[1];
    const rest = match[2];
    if (run === void 0 || rest === void 0) return void 0;
    if (run.charAt(0) === "`" && rest.includes("`")) return void 0;
    return { char: run.charAt(0), length: run.length };
  }
  /**
   * A line closes an open fence only when it is a run of the SAME character, at
   * least as long as the opening run, with nothing but whitespace after it.
   */
  closesFence(line, fence) {
    const match = fenceRun.exec(line);
    if (match === null) return false;
    const run = match[1];
    const rest = match[2];
    if (run === void 0 || rest === void 0) return false;
    return run.charAt(0) === fence.char && run.length >= fence.length && rest.trim().length === 0;
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
    return byName.get(basename3(target.replace(localPrefix, "")));
  }
  appendUnreferenced(body, attachments) {
    let result = body;
    for (const attachment of attachments) {
      if (!attachment.referenced) result += `

![${attachment.caption}](attachment:${attachment.filename})`;
    }
    return result;
  }
};

// src/shared/host-settings/host-settings-source.ts
var settingsScopes = ["user", "project", "local"];

// src/agents/agent-frontmatter/agent-frontmatter.schema.ts
import { z as z22 } from "zod";
var agentCapabilities = ["read", "edit", "shell", "web", "spawn", "ask"];
var modelTiers = ["standard", "escalated", "expert"];
var reasoningLevels = ["low", "medium", "high"];
var claudeAgentColors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
var AgentCapabilitySchema = z22.enum(agentCapabilities);
var ModelTierSchema = z22.enum(modelTiers);
var AgentFrontmatterSchema = z22.strictObject({
  name: z22.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z22.string().min(1),
  capabilities: z22.array(AgentCapabilitySchema).min(1).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    { message: "duplicate capability" }
  ),
  model: ModelTierSchema,
  reasoning: z22.enum(reasoningLevels).optional(),
  sandbox: z22.strictObject({
    fs: z22.enum(["read-only", "workspace-write"]),
    network: z22.enum(["none", "enabled"])
  }).optional(),
  dispatch: z22.strictObject({
    maxConcurrent: z22.int().positive(),
    maxDepth: z22.int().positive()
  }).optional(),
  "x-claude": z22.strictObject({ color: z22.enum(claudeAgentColors).optional() }).optional()
});

// src/agents/agent-frontmatter/agent-frontmatter.ts
import { parse as parseYaml3 } from "yaml";
var MissingFrontmatterError = class extends Error {
  name = "MissingFrontmatterError";
};
var YamlAgentFrontmatterParser = class {
  parse(markdown) {
    const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(markdown);
    if (match === null || match.index !== 0 || match[1] === void 0) {
      throw new MissingFrontmatterError("agent file has no leading --- frontmatter block");
    }
    const raw = parseYaml3(match[1]);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new MissingFrontmatterError("frontmatter is not a YAML mapping");
    }
    return AgentFrontmatterSchema.parse(raw);
  }
};
var agentFrontmatterParser = new YamlAgentFrontmatterParser();
export {
  AgentCapabilitySchema,
  AgentFrontmatterSchema,
  AttachmentSchema,
  AttachmentSpecSchema,
  BlobSectionSource,
  BodyMetadataService,
  BodySectionSelector,
  ClaudeSettingsSource,
  CommentSchema,
  CommitMessageInputSchema,
  ConfigSchema,
  ConfigStore,
  CreateEpicInputSchema,
  CreateInitiativeInputSchema,
  CreateTechnicalDesignInputSchema,
  CreateTicketInputSchema,
  DefaultCommitMessageBuilder,
  DefaultFlightRules,
  DefaultPullRequestBuilder,
  DependencyPlannerService,
  DocIdSchema,
  DuplicateEvidenceNameError,
  EntityMetadataSchema,
  EnvLoader,
  EpicSchema,
  FileDocResolver,
  GhOutputParseError,
  GhPullRequestHost,
  GitHubTaskTracker,
  InitiativeSchema,
  JiraTaskTracker,
  LayeredBodyAdfConverter,
  MediaLookupSchema,
  MediaRefSchema,
  ModelTierSchema,
  NodeGitExecutor,
  NodeToolProbe,
  PrecedenceBodyFormatDetector,
  PullRequestTemplateSchema,
  PushSpecSchema,
  SemanticTypeSchema,
  TechnicalDesignSchema,
  TicketSchema,
  TrackerEvidenceService,
  TrackerUserSchema,
  UnsupportedTrackerOperationError,
  UpdateEpicInputSchema,
  UpdateInitiativeInputSchema,
  UpdateTicketInputSchema,
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
