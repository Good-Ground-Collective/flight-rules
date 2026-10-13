// src/code-review/review.schema.ts
import { z } from "zod";
var reviewContractVersion = 1;
var reviewSchemaRevision = 1;
var ReviewOutcomeSchema = z.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]);
var FindingIdSchema = z.string().regex(/^f-[a-f0-9]{10}$/);
var HeadShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
var ReviewPathSchema = z.string().max(400).regex(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\p{Cc}]*$/u);
var TextSchema = z.string().min(1).max(16e3);
var LineTextSchema = z.string().min(1).max(400).regex(/^[^\r\n]+$/);
var PositiveIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
var HttpsUrlSchema = z.url().regex(/^https:\/\//);
var CategorySchema = z.enum([
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
var ActionLabelSchema = z.enum([
  "issue",
  "todo",
  "suggestion",
  "question",
  "chore",
  "nitpick",
  "typo",
  "polish"
]);
var InformationLabelSchema = z.enum(["praise", "note", "thought"]);
var SeveritySchema = z.enum(["critical", "major", "minor", "trivial"]);
var DecisionOptionsSchema = z.array(
  z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), description: TextSchema })
).min(2);
var findingFields = {
  path: ReviewPathSchema,
  line: z.number().int().nonnegative(),
  start_line: z.number().int().positive().optional(),
  category: CategorySchema.optional(),
  subject: LineTextSchema,
  discussion: TextSchema,
  related_finding_id: FindingIdSchema.optional()
};
var actionFields = {
  ...findingFields,
  label: ActionLabelSchema,
  type: z.enum(["fix", "clarify"]),
  blocking: z.boolean(),
  severity: SeveritySchema,
  details: TextSchema,
  resolved_when: TextSchema
};
var decisionFields = {
  ...actionFields,
  type: z.literal("decide"),
  decision_owner: LineTextSchema,
  decision_options: DecisionOptionsSchema
};
var informationFields = {
  ...findingFields,
  label: InformationLabelSchema,
  blocking: z.literal(false),
  details: TextSchema.optional()
};
var NewFindingSchema = z.union([
  z.strictObject(actionFields),
  z.strictObject(decisionFields),
  z.strictObject(informationFields)
]);
var ActionableFindingSchema = z.union([
  z.strictObject({ ...actionFields, id: FindingIdSchema }),
  z.strictObject({ ...decisionFields, id: FindingIdSchema })
]);
var StoredFindingSchema = z.union([
  ...ActionableFindingSchema.options,
  z.strictObject({ ...informationFields, id: FindingIdSchema })
]);
var ReviewEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("github_comment"),
    comment_id: PositiveIdSchema,
    url: HttpsUrlSchema
  }),
  z.strictObject({
    kind: z.literal("code"),
    commit_sha: HeadShaSchema,
    path: ReviewPathSchema.min(1),
    line: z.number().int().positive()
  }),
  z.strictObject({ kind: z.literal("commit"), sha: HeadShaSchema }),
  z.strictObject({
    kind: z.literal("check_run"),
    check_run_id: PositiveIdSchema,
    commit_sha: HeadShaSchema
  }),
  z.strictObject({ kind: z.literal("document"), url: HttpsUrlSchema }),
  z.strictObject({
    kind: z.literal("verification"),
    commit_sha: HeadShaSchema,
    command: TextSchema,
    result: z.literal("passed"),
    report_url: HttpsUrlSchema
  }),
  z.strictObject({
    kind: z.literal("thread_resolution"),
    thread_id: z.string().min(1),
    author_id: PositiveIdSchema
  })
]);
var DecisionAnswerSchema = z.strictObject({
  comment_id: PositiveIdSchema,
  author_id: PositiveIdSchema,
  option_id: z.string().min(1)
});
var transitionFields = {
  id: FindingIdSchema,
  reason: TextSchema,
  reply: TextSchema.optional(),
  decision: DecisionAnswerSchema.optional()
};
var PriorFindingSchema = z.union([
  z.strictObject({
    ...transitionFields,
    status: z.literal("resolved"),
    evidence: z.array(ReviewEvidenceSchema).min(1)
  }),
  z.strictObject({
    ...transitionFields,
    status: z.literal("withdrawn"),
    evidence: z.array(ReviewEvidenceSchema).min(1),
    withdrawal_basis: z.enum(["incorrect", "no_longer_applicable", "dismissed"])
  }),
  z.strictObject({
    ...transitionFields,
    status: z.literal("still_open"),
    evidence: z.array(ReviewEvidenceSchema).optional(),
    updated_finding: ActionableFindingSchema.optional()
  })
]);
var reviewFields = {
  contract_version: z.literal(reviewContractVersion),
  schema_revision: z.literal(reviewSchemaRevision),
  head_sha: HeadShaSchema,
  review_complete: z.boolean(),
  incomplete_reason: z.string().max(16e3).optional(),
  summary: TextSchema,
  outcome: ReviewOutcomeSchema,
  outcome_reason: TextSchema,
  remaining_risk: TextSchema,
  extensions: z.record(z.string(), z.json()).optional()
};
var ReviewSchema = z.strictObject({
  ...reviewFields,
  findings: z.array(NewFindingSchema),
  prior_findings: z.array(PriorFindingSchema)
});
var FindingRecordSchema = z.strictObject({
  v: z.literal(reviewContractVersion),
  schema_revision: z.literal(reviewSchemaRevision),
  finding: ActionableFindingSchema,
  status: z.enum(["open", "resolved", "withdrawn"]),
  evidence: z.array(ReviewEvidenceSchema),
  decision: DecisionAnswerSchema.optional()
});
var ReviewStateSchema = z.strictObject({
  v: z.literal(reviewContractVersion),
  schema_revision: z.literal(reviewSchemaRevision),
  sha: HeadShaSchema,
  outcome: ReviewOutcomeSchema,
  records: z.array(
    z.union([
      z.strictObject({
        id: FindingIdSchema,
        status: z.enum(["open", "resolved", "withdrawn"]),
        location: z.union([
          z.strictObject({ kind: z.literal("review_comment"), comment_id: PositiveIdSchema }),
          z.strictObject({ kind: z.literal("review_body"), review_id: PositiveIdSchema })
        ])
      }),
      z.strictObject({
        id: FindingIdSchema,
        status: z.literal("informational"),
        fingerprint: z.string().min(1),
        finding: z.strictObject({ ...informationFields, id: FindingIdSchema }).optional()
      })
    ])
  )
});
var TransportReviewSchema = z.strictObject({
  ...reviewFields,
  findings: z.array(
    z.strictObject({
      ...actionFields,
      type: z.enum(["fix", "clarify", "decide"]).optional(),
      label: z.enum([...ActionLabelSchema.options, ...InformationLabelSchema.options]),
      severity: SeveritySchema.optional(),
      details: TextSchema.optional(),
      resolved_when: TextSchema.optional(),
      decision_owner: LineTextSchema.optional(),
      decision_options: DecisionOptionsSchema.optional()
    })
  ),
  prior_findings: z.array(
    z.strictObject({
      ...transitionFields,
      status: z.enum(["resolved", "still_open", "withdrawn"]),
      evidence: z.array(ReviewEvidenceSchema).optional(),
      withdrawal_basis: z.enum(["incorrect", "no_longer_applicable", "dismissed"]).optional(),
      updated_finding: StoredFindingSchema.optional()
    })
  )
});

// src/code-review/review-contract.ts
import { z as z2 } from "zod";
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
      full: z2.toJSONSchema(ReviewSchema, { target: "draft-07" }),
      transport: z2.toJSONSchema(TransportReviewSchema, { target: "draft-07" })
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

// src/code-review/review-planner.ts
import { randomBytes } from "node:crypto";
import { z as z3 } from "zod";
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
var ValidatedEvidencePropsSchema = z3.strictObject({
  verified: z3.array(z3.string()),
  authorizedDecisions: z3.array(z3.string()),
  dismissals: z3.array(z3.string())
});
var ValidatedReviewVerifier = class {
  props;
  constructor(props) {
    this.props = ValidatedEvidencePropsSchema.parse(props);
  }
  async verify(evidence) {
    return evidence.kind === "document" || this.props.verified.includes(JSON.stringify(evidence));
  }
  async authorize(answer, finding) {
    if (finding.type !== "decide" || !finding.decision_options.some((option) => option.id === answer.option_id))
      return false;
    return this.props.authorizedDecisions.includes(`${finding.id}:${JSON.stringify(answer)}`);
  }
  async dismissal(evidence) {
    return evidence.kind === "thread_resolution" && this.props.dismissals.includes(JSON.stringify(evidence));
  }
};

// src/code-review/review-codec.ts
import { createHash } from "node:crypto";
import { z as z4 } from "zod";
var MarkerInputSchema = z4.strictObject({
  body: z4.string(),
  authorId: z4.number().int().positive(),
  trustedAuthorIds: z4.array(z4.number().int().positive())
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

// src/code-review/review-policy.ts
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z as z5 } from "zod";
var ReviewPolicyPropsSchema = z5.strictObject({ home: z5.string().min(1).optional() });
var RepositoryContextPropsSchema = z5.strictObject({
  cwd: z5.string().min(1),
  trustedRef: HeadShaSchema,
  contextPath: ReviewPathSchema.min(1).default("CODE-REVIEW.md")
});
var FileReviewPolicy = class {
  home;
  constructor(props = {}) {
    const parsed = ReviewPolicyPropsSchema.parse(props);
    this.home = parsed.home ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  }
  load() {
    const docs = realpathSync(join(this.home, "docs"));
    const read = (id) => {
      const path = realpathSync(join(docs, `${id}.md`));
      if (relative(docs, path).startsWith(".."))
        throw new ReviewPolicyError("review policy path leaves the installed docs directory");
      return readFileSync(path, "utf8");
    };
    return {
      method: read("autonomous-review-method"),
      charter: read("coding-charter"),
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
      const tree = execFileSync("git", ["ls-tree", "-z", props.trustedRef, "--", path], {
        cwd: props.cwd,
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
        contents: execFileSync("git", ["show", `${props.trustedRef}:${path}`], {
          cwd: props.cwd,
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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z as z6 } from "zod";
var GhReviewGitHubApi = class {
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
    const { stdout } = await promisify(execFile)("gh", args, { maxBuffer: 2e7 });
    return JSON.parse(stdout);
  }
};
var GitHubReviewVerifierPropsSchema = z6.strictObject({
  repo: z6.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  prNumber: z6.number().int().positive(),
  prAuthorId: z6.number().int().positive(),
  owners: z6.record(z6.string(), z6.array(z6.string().min(1))).default({}),
  requireMapping: z6.boolean().default(false)
});
var UserSchema = z6.looseObject({ id: z6.number(), login: z6.string(), type: z6.string() });
var CommentSchema = z6.looseObject({
  id: z6.number(),
  user: UserSchema,
  issue_url: z6.string().optional(),
  pull_request_url: z6.string().optional(),
  body: z6.string()
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
    if (evidence.kind === "commit") {
      const comparison = z6.looseObject({ status: z6.string() }).parse(
        await this.api.get(`/repos/${this.props.repo}/compare/${evidence.sha}...${headSha}`)
      );
      return ["ahead", "identical"].includes(comparison.status);
    }
    if (evidence.commit_sha !== headSha) return false;
    if (evidence.kind === "check_run") {
      const check = z6.looseObject({
        head_sha: z6.string(),
        status: z6.string(),
        conclusion: z6.string().nullable()
      }).parse(await this.api.get(`/repos/${this.props.repo}/check-runs/${evidence.check_run_id}`));
      return check.head_sha === headSha && check.status === "completed" && check.conclusion === "success";
    }
    const file = z6.looseObject({ type: z6.string(), encoding: z6.string(), content: z6.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/contents/${evidence.path.split("/").map(encodeURIComponent).join("/")}?ref=${headSha}`
      )
    );
    return file.type === "file" && file.encoding === "base64" && evidence.line <= Buffer.from(file.content, "base64").toString("utf8").split("\n").length;
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
    const permission = z6.looseObject({ permission: z6.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/collaborators/${encodeURIComponent(comment.user.login)}/permission`
      )
    );
    return ["write", "maintain", "admin"].includes(permission.permission);
  }
  async dismissal(evidence) {
    if (evidence.kind !== "thread_resolution" || evidence.author_id === this.props.prAuthorId)
      return false;
    const result = z6.looseObject({
      data: z6.looseObject({
        node: z6.looseObject({
          isResolved: z6.boolean(),
          resolvedBy: z6.looseObject({ databaseId: z6.number(), actorType: z6.string() }).nullable(),
          pullRequest: z6.looseObject({
            number: z6.number(),
            repository: z6.looseObject({ nameWithOwner: z6.string() })
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
  async comment(id, url) {
    if (url !== void 0 && !url.toLowerCase().startsWith(
      `https://github.com/${this.props.repo.toLowerCase()}/pull/${this.props.prNumber}#`
    ))
      return void 0;
    const endpoints = url?.includes("#discussion_r") ? ["pulls/comments"] : url?.includes("#issuecomment-") ? ["issues/comments"] : ["issues/comments", "pulls/comments"];
    for (const endpoint of endpoints) {
      try {
        const comment = CommentSchema.parse(
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
export {
  ActionableFindingSchema,
  DecisionAnswerSchema,
  EvidenceReviewPlanner,
  FileReviewPolicy,
  FindingRecordSchema,
  GhReviewGitHubApi,
  GitHubReviewVerifier,
  InvalidReviewError,
  JsonReviewCodec,
  NewFindingSchema,
  PriorFindingSchema,
  ReviewEvidenceSchema,
  ReviewPolicyError,
  ReviewSchema,
  ReviewStateSchema,
  StoredFindingSchema,
  TransportReviewSchema,
  ValidatedReviewVerifier,
  ZodReviewContract,
  reviewContract,
  reviewContractVersion,
  reviewSchemaRevision
};
