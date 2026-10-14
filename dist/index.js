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
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync6, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname6 } from "node:path";

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

// src/shared/host-settings/neutral-settings-source.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname4, join as join5 } from "node:path";
import { z as z10 } from "zod";
var PropsSchema = z10.object({
  cwd: z10.string().min(1),
  home: z10.string().min(1).default(homedir2),
  untrackedCwd: z10.string().min(1).optional()
});
var SettingsSchema2 = z10.record(z10.string(), z10.unknown());
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
import { createHash } from "node:crypto";
import { existsSync as existsSync5, lstatSync, mkdirSync as mkdirSync3, readFileSync as readFileSync5, realpathSync as realpathSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname5, join as join6, resolve as resolve3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { z as z12 } from "zod";

// src/agents/agent-frontmatter/agent-frontmatter.schema.ts
import { z as z11 } from "zod";
var agentCapabilities = ["read", "edit", "shell", "web", "spawn", "ask"];
var modelTiers = ["standard", "escalated", "expert"];
var reasoningLevels = ["low", "medium", "high"];
var claudeAgentColors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
var AgentCapabilitySchema = z11.enum(agentCapabilities);
var ModelTierSchema = z11.enum(modelTiers);
var AgentFrontmatterSchema = z11.strictObject({
  name: z11.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z11.string().min(1),
  capabilities: z11.array(AgentCapabilitySchema).min(1).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    { message: "duplicate capability" }
  ),
  model: ModelTierSchema,
  modelReason: z11.string().trim().min(1).optional(),
  reasoning: z11.enum(reasoningLevels).optional(),
  sandbox: z11.strictObject({
    fs: z11.enum(["read-only", "workspace-write"]),
    network: z11.enum(["none", "enabled"])
  }).optional(),
  dispatch: z11.strictObject({
    maxConcurrent: z11.int().positive(),
    maxDepth: z11.int().positive()
  }).optional(),
  "x-claude": z11.strictObject({ color: z11.enum(claudeAgentColors).optional() }).optional()
});
var AgentRegistrationSchema = AgentFrontmatterSchema.refine(
  (agent) => agent.model !== "expert" || agent.modelReason !== void 0,
  { message: "expert tier requires modelReason", path: ["modelReason"] }
);

// src/plugins/native-installation/native-installation.ts
var NativeHostSchema = z12.enum(["claude", "codex"]);
var AgentInstallScopeSchema = z12.enum(["project", "user"]);
var InstallationManifestSchema = z12.strictObject({
  host: NativeHostSchema,
  agents: z12.array(z12.strictObject({
    name: z12.string().regex(/^[a-z][a-z0-9-]*$/),
    sha256: z12.string().regex(/^[a-f0-9]{64}$/),
    registration: AgentRegistrationSchema
  })).min(1)
}).refine((value) => new Set(value.agents.map((agent) => agent.name)).size === value.agents.length, "Duplicate agent names").refine((value) => value.agents.every((agent) => agent.name === agent.registration.name), "Registration name mismatch");
var PropsSchema2 = z12.object({
  root: z12.string().min(1),
  cwd: z12.string().min(1),
  home: z12.string().min(1).default(homedir3),
  env: z12.record(z12.string(), z12.string().optional()).default({})
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
    return createHash("sha256").update(contents).digest("hex");
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
import { z as z13 } from "zod";
var EnvSchema = z13.object({
  githubToken: z13.string().optional(),
  jiraToken: z13.string().optional(),
  jiraEmail: z13.string().optional(),
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
var appVersion = false ? "0.0.0-dev" : "1.82.0";

// src/shared/ariadne/review-packet.schema.ts
import { z as z14 } from "zod";
var packetLimits = {
  title: 200,
  objective: 600,
  highlight: 200,
  highlights: 5,
  prs: 30,
  focusAreas: 10,
  rationale: 2e3,
  anchors: 10,
  path: 400,
  reviewers: 10,
  ticket: 100
};
var focusAreaKinds = ["design-pattern", "business-logic", "data-schema", "other"];
var anchorSides = ["LEFT", "RIGHT"];
var textSchema = (max) => z14.string().min(1, "must not be blank").max(max, `must be at most ${max} characters`);
var oneLineTextSchema = (max) => textSchema(max).refine((value) => !/[\r\n]/.test(value), "must be one line");
var PositiveIntSchema = z14.number().int().positive();
var PacketIdSchema = AgentRecordIdSchema;
var OperationIdSchema = z14.string().regex(/^[A-Za-z0-9_-]{16,80}$/, "must be 16\u201380 letters, digits, underscores or hyphens");
var HeadShaSchema = z14.string().regex(/^[0-9a-f]{40}$/, "must be a 40-character lowercase hex commit sha");
var GithubLoginSchema = z14.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "must be a GitHub login");
var PacketAnchorSchema = z14.strictObject({
  path: textSchema(packetLimits.path),
  line: PositiveIntSchema,
  startLine: optionalSchema(PositiveIntSchema),
  side: z14.enum(anchorSides)
}).refine((anchor) => anchor.startLine === void 0 || anchor.startLine < anchor.line, {
  path: ["startLine"],
  message: "must be before line"
});
var SignOffTimeSchema = z14.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/, "must be an ISO 8601 UTC time ending in Z").refine((value) => {
  const [year = 0, month = 0, day = 0] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "must be a real calendar date");
var FocusAreaSchema = z14.strictObject({
  id: AgentRecordIdSchema,
  kind: z14.enum(focusAreaKinds),
  title: oneLineTextSchema(packetLimits.title),
  rationale: textSchema(packetLimits.rationale),
  anchors: z14.array(PacketAnchorSchema).max(packetLimits.anchors, `up to ${packetLimits.anchors} anchors`)
});
var PacketPrSchema = z14.strictObject({
  repo: z14.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/, "must be owner/name"),
  number: PositiveIntSchema,
  headSha: HeadShaSchema,
  title: oneLineTextSchema(packetLimits.title),
  ticket: optionalSchema(oneLineTextSchema(packetLimits.ticket)),
  signOff: z14.strictObject({ at: SignOffTimeSchema, headSha: HeadShaSchema }).nullable().optional(),
  focusAreas: z14.array(FocusAreaSchema).max(packetLimits.focusAreas, `up to ${packetLimits.focusAreas} focus areas per PR`)
});
var PacketInputSchema = z14.strictObject({
  id: PacketIdSchema,
  title: oneLineTextSchema(packetLimits.title),
  overview: z14.strictObject({
    objective: textSchema(packetLimits.objective),
    highlights: z14.array(oneLineTextSchema(packetLimits.highlight)).min(1, "at least 1 highlight").max(packetLimits.highlights, `up to ${packetLimits.highlights} highlights`)
  }),
  prs: z14.array(PacketPrSchema).min(1, "at least 1 PR").max(packetLimits.prs, `up to ${packetLimits.prs} PRs`),
  reviewers: z14.array(GithubLoginSchema).min(1, "at least 1 reviewer").max(packetLimits.reviewers, `up to ${packetLimits.reviewers} reviewers`)
});
var PacketUpdateSchema = z14.strictObject({
  expectedRevision: z14.number().int().nonnegative(),
  operationId: OperationIdSchema,
  packet: PacketInputSchema.omit({ id: true })
});
var GithubSnapshotSchema = z14.looseObject({ id: z14.union([z14.string(), z14.number()]), login: z14.string() });
var PacketSchema = z14.looseObject({
  id: z14.string(),
  authorId: z14.string(),
  title: z14.string(),
  overview: z14.looseObject({ objective: z14.string(), highlights: z14.array(z14.string()) }),
  prs: z14.array(z14.looseObject({ repo: z14.string(), number: z14.number() })),
  reviewers: z14.array(z14.looseObject({ id: z14.string(), github: GithubSnapshotSchema })),
  status: z14.enum(["open", "closed"]),
  revision: z14.number().int(),
  createdAt: z14.string(),
  updatedAt: z14.string()
});
var ReviewerSchema = z14.looseObject({ id: z14.string(), name: z14.string(), github: GithubSnapshotSchema });
var PacketResponseSchema = z14.looseObject({ packet: PacketSchema }).transform((response) => response.packet);
var ReviewerListResponseSchema = z14.looseObject({ reviewers: z14.array(ReviewerSchema) });

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
  /** POST /v1/review-packets: ids are global; replaying an id and body is idempotent, a different body is 409 `packet_exists`, another author's id is 409 `packet_id_taken`. */
  async createPacket(input) {
    const body = this.validate(PacketInputSchema, input, "packet");
    return this.request("POST", "/v1/review-packets", PacketResponseSchema, body);
  }
  /** PUT /v1/review-packets/{id}: a stale `expectedRevision` is 409 `revision_conflict`; a repeated `operationId` is replayed. */
  async updatePacket(id, input) {
    const packetId = this.validate(PacketIdSchema, id, "packet id");
    const body = this.validate(PacketUpdateSchema, input, "packet update");
    return this.request("PUT", `/v1/review-packets/${encodeURIComponent(packetId)}`, PacketResponseSchema, body);
  }
  /** GET /v1/review-packets/{id}. */
  async getPacket(id) {
    const packetId = this.validate(PacketIdSchema, id, "packet id");
    return this.request("GET", `/v1/review-packets/${encodeURIComponent(packetId)}`, PacketResponseSchema);
  }
  /** GET /v1/review-packets/reviewers: active members with a linked GitHub login. */
  async listReviewers() {
    return this.request("GET", "/v1/review-packets/reviewers", ReviewerListResponseSchema);
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

// src/shared/ariadne/board-session-store.ts
import { z as z15 } from "zod";

// src/shared/ariadne/board-state-files.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync5, readFileSync as readFileSync7, readdirSync as readdirSync2, rmSync, statSync as statSync3, writeFileSync as writeFileSync5 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { join as join8 } from "node:path";
var stateIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
var BoardStateFiles = class {
  now;
  env;
  home;
  constructor(props = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir4();
    this.now = props.now ?? Date.now;
  }
  root() {
    const stateHome = this.env["XDG_STATE_HOME"];
    const base = stateHome !== void 0 && stateHome !== "" ? stateHome : join8(this.home, ".local", "state");
    return join8(base, "flight-rules", "board");
  }
  read(folder, id, schema) {
    const path = this.pathFor(folder, id);
    if (path === void 0 || !existsSync7(path)) return void 0;
    try {
      const parsed = schema.safeParse(JSON.parse(readFileSync7(path, "utf-8")));
      return parsed.success ? parsed.data : void 0;
    } catch {
      return void 0;
    }
  }
  write(folder, id, value) {
    const path = this.pathFor(folder, id);
    if (path === void 0) return;
    mkdirSync5(this.folder(folder), { recursive: true, mode: 448 });
    writeFileSync5(path, JSON.stringify(value), { mode: 384 });
  }
  /** Writes a file only if none exists, atomically; returns whether it wrote. */
  create(folder, id, value) {
    const path = this.pathFor(folder, id);
    if (path === void 0) return false;
    mkdirSync5(this.folder(folder), { recursive: true, mode: 448 });
    try {
      writeFileSync5(path, JSON.stringify(value), { mode: 384, flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
  remove(folder, id) {
    const path = this.pathFor(folder, id);
    if (path !== void 0) rmSync(path, { force: true });
  }
  /** Deletes a folder's files last written more than `maxAgeMs` ago. */
  prune(folder, maxAgeMs) {
    const dir = this.folder(folder);
    if (!existsSync7(dir)) return;
    const cutoff = this.now() - maxAgeMs;
    for (const name of readdirSync2(dir)) {
      const path = join8(dir, name);
      try {
        if (statSync3(path).mtimeMs < cutoff) rmSync(path, { force: true });
      } catch {
        continue;
      }
    }
  }
  folder(folder) {
    return folder === void 0 ? this.root() : join8(this.root(), folder);
  }
  pathFor(folder, id) {
    return stateIdPattern.test(id) ? join8(this.folder(folder), `${id}.json`) : void 0;
  }
};

// src/shared/ariadne/board-session-store.ts
var HeartbeatRecordSchema = z15.object({
  session: z15.string(),
  step: z15.string(),
  state: z15.enum(agentStates),
  ticket: z15.string().optional(),
  repo: z15.string().optional(),
  branch: z15.string().optional(),
  skill: z15.string().optional(),
  detail: z15.string().optional()
});
var SessionRecordSchema = z15.object({
  heartbeat: HeartbeatRecordSchema,
  /** When a skill last posted this heartbeat. */
  recordedAt: z15.number(),
  /** When any heartbeat for the session was last sent, by a skill or the hook. */
  sentAt: z15.number()
});
var InferredRecordSchema = z15.object({
  heartbeat: HeartbeatRecordSchema,
  /** When the hook last sent this inferred heartbeat. */
  sentAt: z15.number()
});
var ThreadRecordSchema = z15.object({
  /** The board session a skill last posted to by default from this Claude Code session. */
  board: z15.string().optional(),
  /** When the hook last spawned a branch lookup for this Claude Code session's main thread. */
  branchCheckedAt: z15.number().optional()
});
var ThreadSkillRecordSchema = z15.object({ skill: z15.string() });
var inferredFolder = "inferred";
var threadsFolder = "threads";
var threadSkillsFolder = "thread-skills";
var unsafeSessionCharacters = /[^A-Za-z0-9_-]/g;
var maxSessionLength = 80;
var TicketSessionKey = class {
  key(claudeSession, ticket) {
    const prefix = claudeSession.trim().replace(unsafeSessionCharacters, "_");
    if (prefix === "" || ticket === "") return void 0;
    return `${prefix.slice(0, Math.max(0, maxSessionLength - ticket.length - 1))}-${ticket}`;
  }
};
var ticketSessionKey = new TicketSessionKey();
var BoardSessionStore = class {
  files;
  now;
  constructor(props = {}) {
    this.files = new BoardStateFiles(props);
    this.now = this.files.now;
  }
  dir() {
    return this.files.root();
  }
  read(session) {
    return this.files.read(void 0, session, SessionRecordSchema);
  }
  /** Remembers a heartbeat a skill just sent. */
  record(heartbeat) {
    const now = this.now();
    this.files.write(void 0, heartbeat.session, { heartbeat: this.compact(heartbeat), recordedAt: now, sentAt: now });
  }
  /**
   * The skill heartbeat a skill recorded for the session within `maxAgeMs`,
   * whatever its state; an older record counts as none.
   */
  recent(session, maxAgeMs) {
    const record = this.read(session);
    return record !== void 0 && this.now() - record.recordedAt <= maxAgeMs ? record.heartbeat : void 0;
  }
  /**
   * Remembers a placeholder heartbeat only where no skill has recorded a
   * recent one: a fresh record is never replaced, and a missing file is
   * created atomically, so a skill's own heartbeat landing at the same
   * moment from another process wins. Returns whether it was remembered.
   */
  recordIfAbsent(heartbeat, maxAgeMs) {
    if (this.recent(heartbeat.session, maxAgeMs) !== void 0) return false;
    const now = this.now();
    const record = { heartbeat: this.compact(heartbeat), recordedAt: now, sentAt: now };
    if (this.read(heartbeat.session) === void 0) return this.files.create(void 0, heartbeat.session, record);
    this.files.write(void 0, heartbeat.session, record);
    return true;
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
    this.files.write(void 0, session, claimed);
    return claimed;
  }
  /** Whether a skill has posted to this session within `maxAgeMs`, whatever its state. */
  hasSkillRecord(session, maxAgeMs) {
    const record = this.read(session);
    return record !== void 0 && this.now() - record.recordedAt <= maxAgeMs;
  }
  /** Whether a skill record is one the hook keeps alive: not aborted and within `maxAgeMs`. */
  isLive(session, maxAgeMs) {
    const record = this.read(session);
    return record !== void 0 && record.heartbeat.state !== "abort" && this.now() - record.recordedAt <= maxAgeMs;
  }
  readInferred(session) {
    return this.files.read(inferredFolder, session, InferredRecordSchema);
  }
  /**
   * Claims a liveness heartbeat the hook inferred: stores it and returns true,
   * or returns false when one was sent for the session less than `intervalMs` ago.
   */
  claimInferred(heartbeat, intervalMs) {
    const now = this.now();
    const previous = this.readInferred(heartbeat.session);
    if (previous !== void 0 && now - previous.sentAt < intervalMs) return false;
    this.files.write(inferredFolder, heartbeat.session, { heartbeat: this.compact(heartbeat), sentAt: now });
    return true;
  }
  /** Remembers that a skill posted to `board` by default from this Claude Code session. */
  pointThread(claudeSession, board) {
    this.files.write(threadsFolder, claudeSession, { ...this.thread(claudeSession), board });
  }
  /** The board session a skill last posted to by default from this Claude Code session. */
  threadSession(claudeSession) {
    return this.thread(claudeSession)?.board;
  }
  /** At most one main-thread branch lookup per `intervalMs` per Claude Code session. */
  claimBranchCheck(claudeSession, intervalMs) {
    const now = this.now();
    const thread = this.thread(claudeSession);
    if (thread?.branchCheckedAt !== void 0 && now - thread.branchCheckedAt < intervalMs) return false;
    this.files.write(threadsFolder, claudeSession, { ...thread, branchCheckedAt: now });
    return true;
  }
  /** Remembers the skill this Claude Code session's main thread just loaded. */
  recordThreadSkill(claudeSession, skill) {
    if (this.threadSkill(claudeSession) === skill) return;
    this.files.write(threadSkillsFolder, claudeSession, { skill });
  }
  /** The skill this Claude Code session's main thread last loaded, if any. */
  threadSkill(claudeSession) {
    return this.files.read(threadSkillsFolder, claudeSession, ThreadSkillRecordSchema)?.skill;
  }
  /** Deletes inferred heartbeats and thread records untouched for `maxAgeMs`. */
  prune(maxAgeMs) {
    this.files.prune(inferredFolder, maxAgeMs);
    this.files.prune(threadsFolder, maxAgeMs);
    this.files.prune(threadSkillsFolder, maxAgeMs);
  }
  thread(claudeSession) {
    return this.files.read(threadsFolder, claudeSession, ThreadRecordSchema);
  }
  compact(heartbeat) {
    const { session, step, state } = heartbeat;
    const optional = Object.fromEntries(
      ["ticket", "repo", "branch", "skill", "detail"].map((key) => [key, heartbeat[key]]).filter(([, value]) => value !== void 0 && value !== "")
    );
    return { session, step, state, ...optional };
  }
};

// src/shared/ariadne/ariadne-board.ts
var claudeSessionEnv = "CLAUDE_CODE_SESSION_ID";
var bootstrapStep = "started";
var bootstrapRecoveryMs = 60 * 6e4;
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
  /**
   * The session a call reports to without `--session`: with a Jira ticket,
   * `<Claude Code session id>-<TICKET>`, the same row the heartbeat hook
   * keeps alive for a sub-agent on that ticket; without one, the Claude Code
   * session id. Undefined outside a Claude Code session.
   */
  defaultSession(ticket) {
    const value = this.env[claudeSessionEnv]?.trim();
    if (value === void 0 || value === "") return void 0;
    const key = ticket !== void 0 ? TicketKeySchema.safeParse(ticket) : void 0;
    return key?.success === true ? ticketSessionKey.key(value, key.data) : value;
  }
  /**
   * Whether a post would be sent: a token, enabled and a valid URL. Read by
   * the hooks before they start a child process; never touches the network.
   * The token is checked first because it is cheap, and reading the config
   * layers is not, so a machine without a token pays for neither.
   */
  reportable() {
    try {
      if (this.tokens.resolve() === void 0) return false;
      const settings = this.settings();
      return settings.enabled && settings.url !== void 0;
    } catch {
      return false;
    }
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
          this.remember(sent, input.session === void 0);
          return response;
        } catch (err) {
          if (!(err instanceof AriadneError) || err.failure !== "invalid-input") this.remember(sent, input.session === void 0);
          throw err;
        }
      },
      input.ticket
    );
  }
  /**
   * Re-sends the last heartbeat a skill posted for `session`, without
   * refreshing when it was recorded, or else the one the heartbeat hook
   * inferred for it. The heartbeat hook's liveness ping; a skill's heartbeat
   * always wins, so its step is never overwritten.
   */
  async replay(session, options = {}) {
    const record = this.sessions?.read(session) ?? this.sessions?.readInferred(session);
    if (record === void 0) return { status: "skipped", reason: "nothing-recorded" };
    return this.call(options, session, (client) => client.heartbeat(record.heartbeat), record.heartbeat.ticket);
  }
  /**
   * Posts an item. A session that has never sent a heartbeat (or has aged
   * out) gets one first, with step `started`, state `nominal` and the
   * reporting skill when one is named, and the item is posted again. A live
   * session's step is never overwritten this way.
   */
  async item(input, options = {}) {
    return this.call(
      options,
      input.session,
      (client, session) => this.withSession(
        client,
        { session, ticket: input.ticket, skill: options.skill, defaulted: input.session === void 0 },
        () => client.postItem({ ...input, session })
      ),
      input.ticket
    );
  }
  /** Posts one activity line, creating the session first as `item` does. */
  async activity(input, options = {}) {
    return this.call(
      options,
      input.session,
      (client, session) => this.withSession(
        client,
        { session, ticket: input.ticket, skill: options.skill, defaulted: input.session === void 0 },
        () => client.postActivity({ ...input, session })
      ),
      input.ticket
    );
  }
  /**
   * Every item of one of the caller's sessions, open and resolved, with any
   * chosen option. Without `session`, `ticket` picks the default session a
   * post on that ticket uses.
   */
  async items(session, options = {}, ticket) {
    return this.call(options, session, (client, id) => client.listItems(id), ticket);
  }
  /**
   * Remembering is best effort: a full disk must not fail a report. A
   * heartbeat sent to the default session also becomes the Claude Code
   * session's current skill session, which the heartbeat hook keeps alive.
   */
  remember(heartbeat, defaulted) {
    try {
      this.sessions?.record(heartbeat);
      const claudeSession = this.defaultSession();
      if (defaulted && claudeSession !== void 0 && claudeSession !== heartbeat.session) {
        this.sessions?.pointThread(claudeSession, heartbeat.session);
      }
    } catch {
      return;
    }
  }
  /**
   * Runs `post`, first creating the session when the API has none. A skill
   * heartbeat recorded for the session in the last hour, such as one that
   * failed in transit, creates it with its own step and state. Otherwise the
   * session starts as `started`, and when a skill is named that placeholder
   * is remembered as the skill's heartbeat, so the heartbeat hook keeps it
   * alive and never replaces its skill with an agent type it infers. The
   * placeholder never replaces a heartbeat a skill recorded meanwhile.
   */
  async withSession(client, target, post) {
    try {
      return await post();
    } catch (err) {
      if (!(err instanceof AriadneError) || err.code !== "session_not_found") throw err;
    }
    const { session, ticket, skill, defaulted } = target;
    const recorded = this.bestEffort(() => this.sessions?.recent(session, bootstrapRecoveryMs));
    if (recorded !== void 0) {
      await client.heartbeat(recorded);
      return post();
    }
    const named = skill !== void 0 && skill !== "";
    const heartbeat = { session, ticket, step: bootstrapStep, state: "nominal", ...named ? { skill } : {} };
    await client.heartbeat(heartbeat);
    if (named) this.rememberPlaceholder(heartbeat, defaulted);
    return post();
  }
  rememberPlaceholder(heartbeat, defaulted) {
    const remembered = this.bestEffort(() => this.sessions?.recordIfAbsent(heartbeat, bootstrapRecoveryMs));
    const claudeSession = this.defaultSession();
    if (remembered === true && defaulted && claudeSession !== void 0 && claudeSession !== heartbeat.session) {
      this.bestEffort(() => this.sessions?.pointThread(claudeSession, heartbeat.session));
    }
  }
  /** Local state is best effort: a full or unreadable disk must not fail a report. */
  bestEffort(run) {
    try {
      return run();
    } catch {
      return void 0;
    }
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
    const session = requestedSession ?? this.defaultSession(ticket);
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

// src/shared/ariadne/ariadne-packets.ts
import { randomUUID } from "node:crypto";

// src/shared/ariadne/packet-id-generator.ts
import { randomBytes } from "node:crypto";
var maxSlugLength = 60;
var fallbackSlug = "packet";
var suffixPattern = /-[0-9a-f]{8}$/;
var RandomPacketIdGenerator = class {
  generate(title) {
    return `${this.slug(title)}-${this.suffix()}`;
  }
  regenerate(id) {
    const slug = this.trim(id.replace(suffixPattern, ""));
    const previous = id.slice(-8);
    let suffix = this.suffix();
    while (suffix === previous) suffix = this.suffix();
    return `${slug === "" ? fallbackSlug : slug}-${suffix}`;
  }
  slug(title) {
    const kebab = this.trim(title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    return kebab === "" ? fallbackSlug : kebab;
  }
  trim(text) {
    return text.slice(0, maxSlugLength).replace(/^-+|-+$/g, "");
  }
  suffix() {
    return randomBytes(4).toString("hex");
  }
};
var packetIdGenerator = new RandomPacketIdGenerator();

// src/shared/ariadne/ariadne-packets.ts
var AriadnePacketError = class extends Error {
  name = "AriadnePacketError";
};
var personalScopes2 = /* @__PURE__ */ new Set(["user", "local"]);
var urlKey2 = "ariadne.url";
var AriadnePackets = class {
  readLayers;
  tokens;
  transport;
  timeoutMs;
  constructor(props) {
    this.readLayers = props.readLayers;
    this.tokens = props.tokens;
    this.transport = props.transport;
    this.timeoutMs = props.timeoutMs;
  }
  /**
   * Publishes a packet, generating its id from the title when the file has none.
   * When another author already holds the id (409 `packet_id_taken`) the random
   * suffix is regenerated and the create is retried once.
   */
  async create(packet) {
    const first = this.withId(packet);
    return this.call(async (client) => {
      try {
        return await client.createPacket(first.packet);
      } catch (err) {
        if (!(err instanceof AriadneError) || err.code !== "packet_id_taken") throw err;
      }
      const retryId = packetIdGenerator.regenerate(first.id);
      try {
        return await client.createPacket(Object.assign({}, first.packet, { id: retryId }));
      } catch (err) {
        if (err instanceof AriadneError && err.code === "packet_id_taken") {
          throw new AriadnePacketError(
            `the packet id is taken by another author (409 packet_id_taken; tried ${first.id} and ${retryId}); change the title in the packet file or run \`flight-rules packet new-id --title <title>\` and set its id, then retry`,
            { cause: err }
          );
        }
        throw err;
      }
    });
  }
  async update(id, input) {
    const operationId = input.operationId ?? randomUUID().replaceAll("-", "");
    return this.call(
      (client) => client.updatePacket(id, { expectedRevision: input.expectedRevision, operationId, packet: input.packet })
    );
  }
  async get(id) {
    return this.call((client) => client.getPacket(id));
  }
  async reviewers() {
    return this.call((client) => client.listReviewers());
  }
  /** The packet carrying an id: the file's own, or one generated from its title. Anything else is left for validation to reject. */
  withId(packet) {
    if (typeof packet !== "object" || packet === null || Array.isArray(packet)) return { packet, id: "" };
    const fields = { ...packet };
    if (typeof fields["id"] === "string") return { packet: fields, id: fields["id"] };
    if (fields["id"] === void 0 && typeof fields["title"] === "string") {
      const id = packetIdGenerator.generate(fields["title"]);
      return { packet: { ...fields, id }, id };
    }
    return { packet: fields, id: "" };
  }
  /**
   * `ariadne.url` (default: production) read only from the user and local
   * layers, local winning. A URL that is not https (or http on localhost)
   * throws, so the token never goes to it.
   */
  url() {
    let raw;
    for (const layer of this.readLayers()) {
      if (!personalScopes2.has(layer.scope)) continue;
      const value = layer.values[urlKey2];
      if (value !== void 0 && value !== null && value !== "") raw = value;
    }
    if (raw === void 0) return defaultAriadneUrl;
    const parsed = AriadneUrlSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new AriadnePacketError(
      `ariadne.url is invalid (${parsed.error.issues.map((i) => i.message).join("; ")}); fix it with \`flight-rules config set ariadne.url <https url> --scope user\``
    );
  }
  token() {
    const resolved = this.tokens.resolve();
    if (resolved !== void 0) return resolved.token;
    throw new AriadnePacketError(
      "no Ariadne token; set ARIADNE_AGENT_TOKEN, or run `flight-rules board login` with an agent token from Ariadne \u203A Settings \u203A Connections"
    );
  }
  async call(run) {
    const url = this.url();
    const token = this.token();
    const client = new AriadneClient({
      baseUrl: url,
      token,
      ...this.transport !== void 0 ? { transport: this.transport } : {},
      ...this.timeoutMs !== void 0 ? { timeoutMs: this.timeoutMs } : {}
    });
    try {
      return await run(client);
    } catch (err) {
      throw new AriadnePacketError(this.redact(this.describe(err, url), token), { cause: err });
    }
  }
  describe(err, url) {
    if (!(err instanceof AriadneError)) return err instanceof Error ? err.message : String(err);
    if (err.failure === "invalid-input") return `${err.message}; fix the packet file and retry, nothing was sent`;
    if (err.failure === "network") {
      return `could not reach Ariadne at ${url}: ${err.message}; check the network and \`ariadne.url\`, then retry`;
    }
    if (err.status === 401 && err.code === "agent_token_expired") {
      return "Ariadne agent token expired (401 agent_token_expired); create a new one in Ariadne \u203A Settings \u203A Connections and run `flight-rules board login`";
    }
    if (err.status === 401) {
      return "Ariadne did not accept the token (401 unauthorized); it may be revoked or mistyped. Create a new one in Ariadne \u203A Settings \u203A Connections and set ARIADNE_AGENT_TOKEN or run `flight-rules board login`";
    }
    if (err.code === "agents_opt_in_required") {
      return "Agents access is off for you (403 agents_opt_in_required); turn on Agents in Ariadne \u203A Settings \u203A Connections and retry";
    }
    if (err.code === "revision_conflict") {
      return "the packet changed since you read it (409 revision_conflict); re-read with `flight-rules packet get <id>` and retry";
    }
    if (err.code === "packet_exists") {
      return "a packet with this id already exists with different content (409 packet_exists); use `flight-rules packet update <id>` to revise it, or choose a new id";
    }
    if (err.code === "packet_id_taken") {
      return "the packet id is taken by another author (409 packet_id_taken); choose a different id, or get one with `flight-rules packet new-id --title <title>`";
    }
    if (err.code === "reviewer_not_found") {
      return `a reviewer is not an active Ariadne member with a linked GitHub login (422 reviewer_not_found): ${err.message}; list valid logins with \`flight-rules packet reviewers\``;
    }
    if (err.failure === "http") return `Ariadne returned ${err.message}; check the packet and retry`;
    return `Ariadne request failed: ${err.message}`;
  }
  /** Belt and braces: no message may ever carry the token. */
  redact(message, token) {
    return token === "" ? message : message.split(token).join("[redacted]");
  }
};

// src/shared/ariadne/ariadne-token-store.ts
import { chmodSync, existsSync as existsSync8, mkdirSync as mkdirSync6, readFileSync as readFileSync8, rmSync as rmSync2, writeFileSync as writeFileSync6 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { dirname as dirname9, join as join9 } from "node:path";
var agentTokenPattern = /^ariadne_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;
var ariadneTokenEnvNames = ["ARIADNE_AGENT_TOKEN", "ARIADNE_TOKEN"];
var AriadneTokenStore = class {
  env;
  home;
  constructor(props = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir5();
  }
  isAgentToken(value) {
    return agentTokenPattern.test(value);
  }
  /** `$XDG_CONFIG_HOME/flight-rules/ariadne-token`, else `~/.config/flight-rules/ariadne-token`. */
  path() {
    const configHome = this.env["XDG_CONFIG_HOME"];
    const base = configHome !== void 0 && configHome !== "" ? configHome : join9(this.home, ".config");
    return join9(base, "flight-rules", "ariadne-token");
  }
  resolve() {
    for (const name of ariadneTokenEnvNames) {
      const value2 = this.env[name]?.trim();
      if (value2 !== void 0 && value2 !== "") return { token: value2, source: name };
    }
    const path = this.path();
    if (!existsSync8(path)) return void 0;
    const value = readFileSync8(path, "utf-8").trim();
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
    mkdirSync6(dirname9(path), { recursive: true, mode: 448 });
    writeFileSync6(path, `${value}
`, { mode: 384 });
    chmodSync(path, 384);
    return path;
  }
  /** Deletes the saved token; returns whether one existed. */
  remove() {
    const path = this.path();
    if (!existsSync8(path)) return false;
    rmSync2(path);
    return true;
  }
};

// src/shared/ariadne/board-agent-store.ts
import { existsSync as existsSync9, readdirSync as readdirSync3 } from "node:fs";
import { join as join10 } from "node:path";
import { z as z16 } from "zod";
var DispatchRecordSchema = z16.object({
  /** The Jira key the dispatch named, or null when it named none. */
  ticket: z16.string().nullable(),
  description: z16.string(),
  /** The dispatching Claude Code session. */
  session: z16.string(),
  /** A digest of the prompt, so a sub-agent found only through its transcript still finds its dispatch. */
  promptDigest: z16.string().optional(),
  at: z16.number()
});
var AgentRecordSchema = z16.object({
  /** The Jira key the sub-agent works on, or null once resolved to none. */
  ticket: z16.string().nullable(),
  description: z16.string().optional(),
  agentType: z16.string().optional(),
  toolUseId: z16.string().optional(),
  /** The Claude Code session the sub-agent runs in. */
  session: z16.string(),
  at: z16.number()
});
var AgentSkillRecordSchema = z16.object({ skill: z16.string() });
var dispatchFolder = "dispatch";
var agentsFolder = "agents";
var agentSkillsFolder = "agent-skills";
var BoardAgentStore = class {
  files;
  constructor(props = {}) {
    this.files = new BoardStateFiles(props);
  }
  now() {
    return this.files.now();
  }
  recordDispatch(toolUseId, record) {
    this.files.write(dispatchFolder, toolUseId, record);
  }
  readDispatch(toolUseId) {
    return this.files.read(dispatchFolder, toolUseId, DispatchRecordSchema);
  }
  /** The dispatch in `session` whose prompt has this digest; reads every dispatch file, so only a fallback uses it. */
  findDispatchByPrompt(session, promptDigest) {
    const dir = join10(this.files.root(), dispatchFolder);
    if (!existsSync9(dir)) return void 0;
    for (const name of readdirSync3(dir)) {
      if (!name.endsWith(".json")) continue;
      const record = this.readDispatch(name.slice(0, -".json".length));
      if (record?.session === session && record.promptDigest === promptDigest) return record;
    }
    return void 0;
  }
  removeDispatch(toolUseId) {
    this.files.remove(dispatchFolder, toolUseId);
  }
  recordAgent(agentId, record) {
    this.files.write(agentsFolder, agentId, record);
  }
  readAgent(agentId) {
    return this.files.read(agentsFolder, agentId, AgentRecordSchema);
  }
  removeAgent(agentId) {
    this.files.remove(agentsFolder, agentId);
    this.files.remove(agentSkillsFolder, agentId);
  }
  /** Remembers the skill a sub-agent just loaded; rewrites nothing when it is unchanged. */
  recordAgentSkill(agentId, skill) {
    if (this.readAgentSkill(agentId) === skill) return;
    this.files.write(agentSkillsFolder, agentId, { skill });
  }
  readAgentSkill(agentId) {
    return this.files.read(agentSkillsFolder, agentId, AgentSkillRecordSchema)?.skill;
  }
  /** Deletes dispatch and sub-agent records untouched for `maxAgeMs`. */
  prune(maxAgeMs) {
    this.files.prune(dispatchFolder, maxAgeMs);
    this.files.prune(agentsFolder, maxAgeMs);
    this.files.prune(agentSkillsFolder, maxAgeMs);
  }
};

// src/tasks/github-task-tracker/github-task-tracker.ts
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

// src/tasks/body-metadata/body-metadata.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// src/tasks/task-tracker/task-tracker.ts
import { z as z17 } from "zod";
var TrackerUserSchema = z17.object({
  accountId: z17.string(),
  displayName: z17.string()
});
var EntityMetadataSchema = z17.object({
  tddId: z17.number().optional(),
  epicId: z17.number().optional(),
  notes: z17.string().optional(),
  /** Explicit body-format override read first by BodyFormatDetector (docs/bug-report-format.md). */
  kind: z17.enum(["bug", "story"]).optional(),
  /** Why a blocked-by edge leaves this ticket's epic, keyed by blocker id (docs/epic-boundaries.md). */
  crossEpicReasons: z17.record(z17.string(), z17.string()).optional()
}).passthrough();
var CommentSchema = z17.object({
  id: z17.string(),
  body: z17.string(),
  author: z17.string(),
  createdAt: z17.string(),
  updatedAt: z17.string()
});
var AttachmentSchema = z17.object({
  id: z17.string(),
  filename: z17.string(),
  mimeType: z17.string(),
  size: z17.number().optional(),
  mediaUuid: z17.string().optional()
});
var TechnicalDesignSchema = z17.object({
  id: z17.string(),
  epicId: z17.string(),
  url: z17.string().optional(),
  body: z17.string(),
  comments: z17.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z17.string()
});
var TicketSchema = z17.object({
  id: z17.string(),
  size: z17.literal("ticket"),
  status: z17.string(),
  labels: z17.array(z17.string()),
  title: z17.string(),
  body: z17.string(),
  comments: z17.array(CommentSchema),
  assignee: z17.string().nullable(),
  attachments: z17.array(AttachmentSchema).default([]),
  reporter: z17.string().nullable().default(null),
  issueType: z17.string().default("unknown"),
  blockedBy: z17.array(z17.string()).default([]),
  blocking: z17.array(z17.string()).default([]),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z17.string()
});
var EpicSchema = z17.object({
  id: z17.string(),
  size: z17.literal("epic"),
  status: z17.string(),
  labels: z17.array(z17.string()),
  title: z17.string(),
  body: z17.string(),
  childIssues: z17.array(TicketSchema),
  comments: z17.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z17.string()
});
var CreateEpicInputSchema = z17.object({
  title: z17.string(),
  body: z17.string(),
  labels: z17.array(z17.string()).default([]),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTicketInputSchema = z17.object({
  title: z17.string(),
  body: z17.string(),
  /** Absent for a standalone ticket: a ticket-sized RFC has no epic to parent to. */
  epicId: z17.string().optional(),
  labels: z17.array(z17.string()).default([]),
  assignee: z17.string().optional(),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTechnicalDesignInputSchema = z17.object({
  title: z17.string(),
  body: z17.string(),
  epicId: z17.string(),
  metadata: EntityMetadataSchema.partial().optional()
});
var UpdateEpicInputSchema = z17.object({
  body: z17.string(),
  title: z17.string().optional(),
  labels: z17.array(z17.string()).optional()
});
var UpdateTicketInputSchema = z17.object({
  body: z17.string(),
  title: z17.string().optional(),
  labels: z17.array(z17.string()).optional()
});
var UpdateInitiativeInputSchema = z17.object({
  body: z17.string(),
  title: z17.string().optional()
});
var InitiativeSchema = z17.object({
  id: z17.string(),
  size: z17.literal("initiative"),
  title: z17.string(),
  body: z17.string(),
  epics: z17.array(z17.object({ id: z17.string(), title: z17.string() })).default([])
});
var CreateInitiativeInputSchema = z17.object({
  title: z17.string(),
  body: z17.string()
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
import { z as z19 } from "zod";

// src/tasks/task-tracker/unsupported-tracker-operation-error.ts
import { z as z18 } from "zod";
var UnsupportedTrackerOperationPropsSchema = z18.object({
  tracker: z18.string().min(1),
  operation: z18.string().min(1),
  remedy: z18.string().min(1).optional()
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
var IssueRefSchema = z19.object({ number: z19.number() });
var IssueRefListSchema = z19.array(IssueRefSchema);
var ParentNotFoundSchema = z19.object({ status: z19.literal(404) });
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
  async getTicketEpicId(ticketId) {
    try {
      const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/parent", {
        owner: this.owner,
        repo: this.repo,
        issue_number: parseInt(ticketId, 10)
      });
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
  async ping(options) {
    await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo, ...options?.signal === void 0 ? {} : { request: { signal: options.signal } } });
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
import { readFileSync as readFileSync9 } from "node:fs";
import { basename as basename2 } from "node:path";
import { z as z23 } from "zod";

// src/tasks/jira-task-tracker/jira-client.ts
import { z as z20 } from "zod";

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
var JiraErrorBodySchema = z20.object({
  errorMessages: z20.array(z20.string()).optional(),
  // Caught per-field so an off-contract `errors` map cannot discard a valid sibling `errorMessages`.
  errors: z20.record(z20.string(), z20.string()).optional().catch(void 0),
  message: z20.string().optional()
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
      await new Promise((resolve6) => setTimeout(resolve6, delayMs));
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
import { z as z21 } from "zod";
var maxRetries2 = 4;
var defaultRetryAfterSeconds2 = 2;
var maxBackoffMs2 = 3e4;
var ConfluenceErrorBodySchema = z21.object({
  errors: z21.array(z21.object({ title: z21.string().optional(), detail: z21.string().optional() })).optional().catch(void 0),
  message: z21.string().optional()
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
      await new Promise((resolve6) => setTimeout(resolve6, delayMs));
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
import { z as z22 } from "zod";
var MediaRefSchema = z22.object({
  mediaUuid: z22.string().min(1),
  collection: z22.string().default(""),
  width: z22.number().int().positive().optional(),
  height: z22.number().int().positive().optional()
});
var MediaLookupSchema = z22.record(z22.string(), MediaRefSchema);
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
var JiraUploadedAttachmentSchema = z23.object({
  id: z23.union([z23.string(), z23.number()]).transform(String),
  filename: z23.string(),
  mimeType: z23.string(),
  size: z23.number().optional()
});
var JiraUploadedAttachmentsSchema = z23.array(JiraUploadedAttachmentSchema);
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
  async getTicketEpicId(ticketId) {
    const issue = await this.client.request("GET", `/issue/${ticketId}`, void 0, { fields: "parent" });
    return issue.fields.parent?.key ?? null;
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
    const file = new File([readFileSync9(filePath)], filename, { type: this.mimeTypes.forFilename(filename) });
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
import { z as z25 } from "zod";

// src/tasks/readiness/probe-diagnostics.ts
import { z as z24 } from "zod";
var ProbeDiagnosticsPropsSchema = z24.object({ env: z24.record(z24.string(), z24.string().optional()) });
var ErrorFactsSchema = z24.object({
  code: z24.union([z24.string(), z24.number()]).nullable().optional(),
  status: z24.number().optional(),
  statusCode: z24.number().optional(),
  killed: z24.boolean().optional(),
  name: z24.string().optional(),
  message: z24.string().optional(),
  stderr: z24.string().optional(),
  cause: z24.unknown().optional()
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
var NodeToolProbePropsSchema = z25.object({ cwd: z25.string().optional(), env: z25.record(z25.string(), z25.string().optional()).optional(), timeoutMs: z25.int().positive().max(6e4).default(1e4) });
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
import { z as z31 } from "zod";

// src/tasks/readiness/workflow-preflight.ts
import { execFile as execFile4 } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve as resolve4 } from "node:path";
import { promisify as promisify4 } from "node:util";
import { z as z30 } from "zod";

// src/orchestration/orchestration-policy.ts
import { isDeepStrictEqual } from "node:util";
import { z as z28 } from "zod";

// src/agents/agent-emitter/agent-emitter.schema.ts
import { z as z26 } from "zod";
var ModelBindingsSchema = z26.strictObject({
  standard: z26.string().trim().min(1),
  escalated: z26.string().trim().min(1),
  expert: z26.string().trim().min(1)
});
var AgentDefinitionSchema = z26.strictObject({
  frontmatter: AgentRegistrationSchema,
  body: z26.string().refine((body) => body.trim() !== "", "agent prompt must not be empty")
});

// src/orchestration/orchestration.schema.ts
import { isAbsolute as isAbsolute2, relative, sep as sep2 } from "node:path";
import { z as z27 } from "zod";
var OrchestrationTextSchema = z27.string().refine((value) => value.trim().length > 0, "must not be blank");
var AbsolutePathSchema = OrchestrationTextSchema.refine(
  isAbsolute2,
  "must be an absolute path on this host"
);
var CapabilityNameSchema = z27.string().regex(/^[a-z][a-zA-Z0-9:.-]*$/);
var RunContextObjectSchema = z27.strictObject({
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
var CallerContextSchema = RunContextSchema.safeExtend({ attempt: z27.int().positive() });
var CapabilityEvidenceSchema = z27.discriminatedUnion("state", [
  z27.strictObject({ state: z27.literal("available"), evidence: OrchestrationTextSchema }),
  z27.strictObject({
    state: z27.enum(["denied", "unknown"]),
    evidence: OrchestrationTextSchema,
    remedy: OrchestrationTextSchema
  })
]);
var AdapterLimitsSchema = z27.strictObject({
  maxConcurrent: z27.int().nonnegative().nullable(),
  activeWorkers: z27.int().nonnegative(),
  currentDepth: z27.int().nonnegative(),
  maxDepth: z27.int().nonnegative().nullable(),
  source: OrchestrationTextSchema
});
var RuntimeSnapshotSchema = z27.strictObject({
  context: CallerContextSchema,
  host: z27.strictObject({ name: OrchestrationTextSchema, version: OrchestrationTextSchema }),
  observedAt: z27.iso.datetime(),
  agent: AgentFrontmatterSchema.shape.name.nullable(),
  spawn: CapabilityEvidenceSchema,
  ask: CapabilityEvidenceSchema,
  permissions: z27.record(CapabilityNameSchema, CapabilityEvidenceSchema),
  limits: AdapterLimitsSchema
});
var DispatchRequestSchema = z27.strictObject({
  id: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema,
  input: z27.record(z27.string(), z27.json()),
  requiredCapabilities: z27.array(CapabilityNameSchema).optional()
});
var OrchestrationFailureSchema = z27.strictObject({
  code: z27.enum([
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
var OutcomeIdentitySchema = z27.strictObject({
  dispatchId: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema
});
var DispatchOutcomeSchema = z27.discriminatedUnion("status", [
  OutcomeIdentitySchema.extend({
    status: z27.literal("completed"),
    report: z27.record(z27.string(), z27.json())
  }),
  OutcomeIdentitySchema.extend({
    status: z27.enum(["failed", "unavailable"]),
    failure: OrchestrationFailureSchema
  })
]);
var QuestionRequestSchema = z27.strictObject({
  context: CallerContextSchema,
  question: OrchestrationTextSchema,
  allowHumanQuestions: z27.boolean()
});
var SiblingSkillRequestSchema = z27.strictObject({
  context: CallerContextSchema,
  skill: OrchestrationTextSchema,
  input: z27.record(z27.string(), z27.json())
});

// src/orchestration/orchestration-policy.ts
var RegistryOrchestrationPolicyPropsSchema = z28.strictObject({
  agents: z28.array(AgentDefinitionSchema).min(1).refine(
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
import { z as z29 } from "zod";
var WorkflowSchema = z29.enum([
  "execute-work",
  "execute-wave",
  "break-down-work",
  "reproduce-bug",
  "verify-ticket"
]);
var WorkflowEvidenceSchema = z29.strictObject({
  context: CallerContextSchema,
  callerCapabilities: z29.record(z29.string(), CapabilityEvidenceSchema),
  workers: z29.array(
    z29.strictObject({ registration: AgentRegistrationSchema, runtime: RuntimeSnapshotSchema })
  ).refine(
    (workers) => new Set(workers.map((worker) => worker.registration.name)).size === workers.length,
    "duplicate worker evidence"
  )
});
var ReadinessOptionsSchema = z29.strictObject({
  workflow: WorkflowSchema.optional(),
  evidence: WorkflowEvidenceSchema.optional()
}).refine(
  (value) => value.evidence === void 0 || value.workflow !== void 0,
  "workflow is required with capability evidence"
);

// src/tasks/readiness/workflow-preflight.ts
var WorkflowPreflightPropsSchema = z30.object({
  cwd: z30.string(),
  env: z30.record(z30.string(), z30.string().optional()),
  timeoutMs: z30.int().positive().max(6e4).default(1e4)
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
    const requiredAgents = codeWorkflow ? ["code-implementation", "code-implementation-escalated", "code-verifier", "tech-writer"] : selected === "break-down-work" ? ["research-agent"] : [selected === "reproduce-bug" ? "qa-engineer" : "qa-engineer-verify"];
    const checks = [];
    const contextMatches = parsed !== void 0 && resolve4(parsed.context.cwd) === resolve4(this.cwd);
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
      const observed = contextMatches ? parsed?.callerCapabilities[capability] : void 0;
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
    const policy = parsed?.workers.length ? new RegistryOrchestrationPolicy({
      agents: parsed.workers.map((worker) => ({
        frontmatter: worker.registration,
        body: "Preflight registration requirements; this check does not dispatch."
      }))
    }) : void 0;
    for (const agent of requiredAgents) {
      const worker = contextMatches ? parsed?.workers.find((item) => item.registration.name === agent) : void 0;
      if (worker === void 0 || parsed === void 0 || policy === void 0) {
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
    if (codeWorkflow) {
      checks.push(await this.checkoutContext(parsed, diagnostics));
      checks.push(await this.remoteRead(diagnostics));
      checks.push(await this.localWrite("local:workspace-write", this.cwd, diagnostics));
      checks.push(await this.gitWrite(diagnostics));
    }
    return checks;
  }
  async command(args) {
    const run = promisify4(execFile4);
    const { stdout } = await run("git", args, {
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
    if (evidence === void 0)
      return {
        name: "git:context",
        ok: false,
        required: true,
        code: "CONTEXT_MISMATCH",
        detail: "No repository/base context supplied",
        remedy: "Identify the active checkout and fixed comparison base before starting the workflow."
      };
    try {
      const root = await this.command(["rev-parse", "--show-toplevel"]);
      if (await realpath(root) !== await realpath(evidence.context.repositoryRoot)) {
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
        `${evidence.context.baseRef}^{commit}`
      ]);
      return {
        name: "git:context",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail: "Active checkout matches and the fixed base resolves to a commit"
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
        detail: "Filesystem access check permits directory writes; no file was created and host authorization is checked separately"
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
var RepositoryReadinessPropsSchema = z31.object({
  cwd: z31.string().optional(),
  env: z31.record(z31.string(), z31.string().optional()).optional(),
  timeoutMs: z31.int().positive().max(6e4).default(1e4)
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
            remedy: "Supply a valid WorkflowEvidence document for the selected workflow; do not fill unknown capabilities with available."
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
        qaInstructionsFound: options.workflow === "break-down-work" ? false : qa.found || qaWorkflow,
        ...options.workflow === void 0 ? {} : {
          githubRequired: codeWorkflow || config.tracker === "github",
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
import { z as z32 } from "zod";
var FlightRulesPropsSchema = z32.object({
  cwd: z32.string().optional().describe("Directory used for config discovery; defaults to process.cwd()"),
  env: z32.record(z32.string(), z32.string().optional()).optional().describe("Live environment record; defaults to process.env"),
  configPath: z32.string().optional().describe("Explicit config file, taking precedence over FLIGHT_RULES_CONFIG and discovery"),
  host: NativeHostSchema.optional().describe("Explicit configuration host; otherwise FLIGHT_RULES_HOST, the native package host, or Claude for compatibility")
});

// src/flight-rules/flight-rules.ts
var DefaultFlightRules = class {
  cwd;
  env;
  explicitConfigPath;
  hostSettings;
  host;
  untrackedRoot;
  constructor(props = {}) {
    const parsed = FlightRulesPropsSchema.parse({ ...props, env: props.env === void 0 ? void 0 : { ...props.env } });
    this.cwd = parsed.cwd ?? process.cwd();
    this.env = props.env ?? process.env;
    this.explicitConfigPath = parsed.configPath;
    this.hostSettings = props.hostSettings;
    this.host = parsed.host;
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
      host: NativeHostSchema.parse(this.host ?? env["FLIGHT_RULES_HOST"] ?? this.installation().host() ?? "claude"),
      ...this.hostSettings !== void 0 ? { hostSettings: this.hostSettings } : {},
      ...untrackedRoot !== void 0 ? { untrackedRoot } : {}
    });
  }
  installation() {
    return FileNativeInstallation.fromInstall({ moduleUrl: import.meta.url, cwd: this.cwd, env: this.env });
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
    return new NodeToolProbe({ cwd: this.cwd, env: this.env });
  }
  readiness() {
    return new NodeRepositoryReadiness({ cwd: this.cwd, env: this.env });
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
  packets() {
    return new AriadnePackets({
      readLayers: () => this.configStore().layers(),
      tokens: this.ariadneTokens()
    });
  }
  ariadneTokens() {
    return new AriadneTokenStore({ env: this.env });
  }
  boardSessions() {
    return new BoardSessionStore({ env: this.env });
  }
  boardAgents() {
    return new BoardAgentStore({ env: this.env });
  }
};
function createFlightRules(props = {}) {
  return new DefaultFlightRules(props);
}

// src/git/commit-message-builder/commit-message-builder.ts
import { readFileSync as readFileSync10 } from "node:fs";
import { dirname as dirname10, join as join11 } from "node:path";

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
import { z as z33 } from "zod";
var CommitMessageInputSchema = z33.object({
  type: SemanticTypeSchema,
  // Bare issue numbers make one-character scopes legitimate; 32 clears a 10-character tracker key plus a six-digit number.
  scope: z33.string().min(1).max(32),
  description: z33.string().min(2).max(50),
  body: z33.string().optional(),
  model: z33.string().max(72).optional(),
  footers: z33.array(z33.string().regex(/^[a-zA-Z0-9-]+(: |=).*$/)).default([])
});
var CommitMessageHeaderSchema = z33.preprocess(
  (arg) => {
    return z33.string({ error: "Git Commit headers should be 72 characters or less" }).max(72).parse(arg);
  },
  z33.templateLiteral([SemanticTypeSchema, "(", z33.string(), "): ", z33.string()])
);
var CommitMessageBuilderPropsSchema = z33.object({
  binPath: z33.string().min(1),
  agentEnv: z33.string().optional()
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
      const pkgPath = join11(dirname10(binPath), "..", "package.json");
      const parsed = JSON.parse(readFileSync10(pkgPath, "utf-8"));
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
import { z as z34 } from "zod";
var mediaReference = /(!?)\[([^\]]*)\]\(\s*<?([^\s()<>]+)>?(?:\s+"[^"]*")?\s*\)/g;
var absoluteTarget = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\/|^#/;
var localPrefix = /^(?:\.\/)+/;
var fenceRun = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var AttachmentSpecSchema = z34.string().min(1).transform((spec) => {
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
import { readFileSync as readFileSync11, readdirSync as readdirSync4 } from "node:fs";
import { basename as basename4, join as join12 } from "node:path";
import { z as z36 } from "zod";
var AgentNameSchema = AgentFrontmatterSchema.shape.name;
var AgentVariantSchema = z36.strictObject({
  name: AgentNameSchema,
  extends: AgentNameSchema,
  description: AgentFrontmatterSchema.shape.description,
  model: ModelTierSchema,
  modelReason: z36.string().trim().min(1).optional()
});
var AgentVariantsSchema = z36.array(AgentVariantSchema);
var InvalidAgentDefinitionError = class extends Error {
  name = "InvalidAgentDefinitionError";
};
var FileAgentRegistry = class {
  load(directory) {
    const agents = readdirSync4(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
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
import { z as z37 } from "zod";

// src/agents/agent-emitter/agent-emitter.ts
var UnsupportedAgentSettingError = class extends Error {
  name = "UnsupportedAgentSettingError";
};

// src/agents/agent-emitter/claude-agent-emitter.ts
var ClaudeAgentEmitterPropsSchema = z37.strictObject({ models: ModelBindingsSchema });
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
    if (capability === "read") return ["Glob", "Grep", "Read"];
    if (capability === "edit") return ["Write", "Edit"];
    if (capability === "shell") return ["Bash"];
    if (capability === "web") return ["WebSearch", "WebFetch"];
    throw new UnsupportedAgentSettingError(`Worker agent capability ${capability} needs an orchestration adapter`);
  }
};

// src/agents/agent-emitter/codex-agent-emitter.ts
import { z as z38 } from "zod";
var ReasoningBindingsSchema = z38.strictObject({
  standard: z38.enum(reasoningLevels),
  escalated: z38.enum(reasoningLevels),
  expert: z38.enum(reasoningLevels)
});
var CodexAgentEmitterPropsSchema = z38.strictObject({
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
  chmodSync as chmodSync2,
  copyFileSync,
  existsSync as existsSync10,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync7,
  readFileSync as readFileSync12,
  readdirSync as readdirSync5,
  realpathSync as realpathSync3,
  rmSync as rmSync3,
  writeFileSync as writeFileSync7
} from "node:fs";
import { join as join13, resolve as resolve5 } from "node:path";
import { createHash as createHash2 } from "node:crypto";
import { z as z39 } from "zod";
var NativePluginCompilerPropsSchema = z39.strictObject({ sourceDir: z39.string().min(1) });
var PluginHostSchema = z39.enum(["claude", "codex"]);
var PackageVersionSchema = z39.object({ version: z39.string().min(1) });
var PluginIdentitySchema = z39.strictObject({
  name: z39.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z39.string().min(1),
  repository: z39.url(),
  author: z39.strictObject({ name: z39.string().min(1) }),
  license: z39.string().min(1)
});
var InvalidPluginSourceError = class extends Error {
  name = "InvalidPluginSourceError";
};
var NativePluginCompiler = class {
  sourceDir;
  constructor(props) {
    this.sourceDir = realpathSync3(resolve5(NativePluginCompilerPropsSchema.parse(props).sourceDir));
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
        "Claude commit and Ariadne hooks are omitted; this target emits no Codex hooks."
      );
    for (const executable of ["flight-rules", "flight-rules.mjs"]) {
      if (!existsSync10(join13(this.sourceDir, "bin", executable))) {
        throw new InvalidPluginSourceError(
          `Build the CLI before native assembly: missing bin/${executable}`
        );
      }
    }
    const directory = join13(this.sourceDir, "dist", target);
    if (existsSync10(join13(this.sourceDir, "dist")) && lstatSync2(join13(this.sourceDir, "dist")).isSymbolicLink()) {
      throw new InvalidPluginSourceError("Native output cannot use a symlinked dist directory");
    }
    rmSync3(directory, { recursive: true, force: true });
    mkdirSync7(directory, { recursive: true });
    const resources = target === "claude" ? ["skills", "docs", "hooks", "bin"] : ["skills", "docs", "bin"];
    for (const resource of resources)
      this.copyDirectory(join13(this.sourceDir, resource), join13(directory, resource));
    this.copyDirectory(
      join13(this.sourceDir, "agents"),
      join13(directory, "bin", "resources", "agents")
    );
    const agentDirectory = target === "claude" ? join13(directory, "agents") : join13(directory, ".codex", "agents");
    mkdirSync7(agentDirectory, { recursive: true });
    const extension = target === "claude" ? "md" : "toml";
    for (const agent of agents)
      writeFileSync7(join13(agentDirectory, `${agent.name}.${extension}`), agent.contents);
    writeFileSync7(
      join13(directory, "flight-rules-install.json"),
      JSON.stringify(
        {
          host: target,
          agents: agents.map((agent) => ({
            name: agent.name,
            sha256: createHash2("sha256").update(agent.contents).digest("hex"),
            registration: agent.registration
          }))
        },
        null,
        2
      ) + "\n"
    );
    mkdirSync7(join13(directory, "adapters", target), { recursive: true });
    copyFileSync(
      join13(this.sourceDir, "adapters", target, "model-tiers.json"),
      join13(directory, "adapters", target, "model-tiers.json")
    );
    if (target === "codex")
      copyFileSync(
        join13(this.sourceDir, "adapters/codex/reasoning-tiers.json"),
        join13(directory, "adapters/codex/reasoning-tiers.json")
      );
    for (const executable of ["flight-rules", "flight-rules.mjs"])
      chmodSync2(join13(directory, "bin", executable), 493);
    const manifestDirectory = join13(
      directory,
      target === "claude" ? ".claude-plugin" : ".codex-plugin"
    );
    mkdirSync7(manifestDirectory);
    const manifest = target === "claude" ? {
      ...identity,
      version,
      skills: "./skills/",
      agents: agents.map((agent) => `./agents/${agent.name}.md`)
    } : { ...identity, version, skills: "./skills/" };
    writeFileSync7(join13(manifestDirectory, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
    if (target === "codex") {
      writeFileSync7(
        join13(directory, "plugin.json"),
        JSON.stringify(
          {
            $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
            ...identity,
            version
          },
          null,
          2
        ) + "\n"
      );
      writeFileSync7(join13(directory, ".codex", "config.toml"), "[agents]\nenabled = true\n");
      writeFileSync7(
        join13(directory, "diagnostics.json"),
        JSON.stringify(diagnostics, null, 2) + "\n"
      );
    }
    return { directory, agents: agents.map((agent) => agent.name), diagnostics };
  }
  validateSource(path) {
    const stat = lstatSync2(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) {
      throw new InvalidPluginSourceError(
        `Native resources must be regular files/directories: ${path}`
      );
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync5(path)) this.validateSource(join13(path, entry));
    }
  }
  copyDirectory(source, destination) {
    mkdirSync7(destination, { recursive: true });
    for (const entry of readdirSync5(source, { withFileTypes: true })) {
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
import { z as z40 } from "zod";
var ImplementationReportSchema = z40.strictObject({
  summary: OrchestrationTextSchema,
  filesChanged: z40.array(
    z40.strictObject({ path: OrchestrationTextSchema, why: OrchestrationTextSchema })
  ),
  testsRun: z40.array(
    z40.strictObject({ command: OrchestrationTextSchema, result: OrchestrationTextSchema })
  ),
  approach: OrchestrationTextSchema,
  openQuestions: z40.array(OrchestrationTextSchema).optional()
});
var CriterionResultSchema = z40.strictObject({
  criterion: OrchestrationTextSchema,
  verdict: z40.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
  evidence: OrchestrationTextSchema
});
var VerificationReportSchema = z40.strictObject({
  summary: OrchestrationTextSchema,
  criteria: z40.array(CriterionResultSchema).min(1),
  charterConcerns: z40.array(OrchestrationTextSchema).optional(),
  openQuestions: z40.array(OrchestrationTextSchema).optional(),
  verified: z40.boolean()
}).refine(
  (report) => report.verified === report.criteria.every((criterion) => criterion.verdict === "PASS"),
  "verified must agree with every itemized verdict"
);
var HandoffRecordSchema = z40.strictObject({
  request: DispatchRequestSchema,
  outcome: z40.unknown()
});
var ImplementationRunSchema = z40.strictObject({
  context: RunContextSchema,
  criteria: z40.array(OrchestrationTextSchema).min(1).refine((criteria) => new Set(criteria).size === criteria.length, "criteria must be distinct"),
  implementationInput: z40.record(z40.string(), z40.json()).refine(
    (input) => !Object.hasOwn(input, "verifierFailures"),
    "verifierFailures is reserved for validated retry evidence"
  ),
  history: z40.array(
    z40.strictObject({ implementation: HandoffRecordSchema, verification: HandoffRecordSchema })
  ).max(3)
});

// src/orchestration/implementation-loop.ts
import { isDeepStrictEqual as isDeepStrictEqual3 } from "node:util";
var VerifiedImplementationLoop = class {
  reports = new ValidatedReportHandoff();
  next(run) {
    const parsed = ImplementationRunSchema.safeParse(run);
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
  verify(run, implementation) {
    const decision = this.next(run);
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
      request: this.verificationRequest(run, decision.request.context.attempt, filesChanged)
    };
  }
  implementationRequest(run, attempt, failures) {
    return {
      id: `${run.context.runId}:implementation:${attempt}`,
      agent: attempt === 3 ? "code-implementation-escalated" : "code-implementation",
      context: { ...run.context, attempt },
      input: {
        ...run.implementationInput,
        criteria: [...run.criteria],
        ...failures.length ? { verifierFailures: failures } : {}
      }
    };
  }
  verificationRequest(run, attempt, filesChanged) {
    return {
      id: `${run.context.runId}:verification:${attempt}`,
      agent: "code-verifier",
      context: { ...run.context, attempt },
      input: { criteria: [...run.criteria], filesChanged: filesChanged.map((path) => ({ path })) }
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

// src/orchestration/dispatch-queue.ts
import { z as z41 } from "zod";
var DispatchQueuePropsSchema = z41.strictObject({
  agents: z41.array(AgentDefinitionSchema).min(1),
  requests: z41.array(DispatchRequestSchema).refine(
    (requests) => new Set(requests.map((request) => request.id)).size === requests.length,
    "dispatch IDs must be unique"
  ),
  maxConcurrent: z41.int().positive()
});
var ObservedDispatchIdsSchema = z41.array(z41.string().min(1)).refine((ids) => new Set(ids).size === ids.length, "observed dispatch IDs must be unique");
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
  ConfigStore,
  CreateEpicInputSchema,
  CreateInitiativeInputSchema,
  CreateTechnicalDesignInputSchema,
  CreateTicketInputSchema,
  CriterionResultSchema,
  DefaultCommitMessageBuilder,
  DefaultFlightRules,
  DefaultPullRequestBuilder,
  DependencyPlannerService,
  DispatchOutcomeSchema,
  DispatchRequestSchema,
  DocCharterCatalog,
  DocIdSchema,
  DuplicateEvidenceNameError,
  EntityMetadataSchema,
  EnvLoader,
  EpicSchema,
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
