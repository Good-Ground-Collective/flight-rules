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

// src/code-review/review-policy.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync2, realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname2, join as join2, relative } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { z as z7 } from "zod";

// src/bundled-docs/charter-catalog/charter-catalog.ts
import { matchesGlob } from "node:path";
import { parse as parseYaml } from "yaml";
import { z as z5 } from "zod";
var coreCharterId = "coding-charter";
var languageCharterPrefix = `${coreCharterId}-`;
var LanguageFrontmatterSchema = z5.strictObject({
  language: z5.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  "applies-to": z5.array(z5.string().min(1)).min(1)
}).transform(({ language, "applies-to": appliesTo }) => ({ language, appliesTo }));
var FrontmatterSchema = z5.string().transform((contents, ctx) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(contents)?.[1];
  if (block === void 0) {
    ctx.addIssue({ code: "custom", message: "missing YAML frontmatter" });
    return z5.NEVER;
  }
  return parseYaml(block);
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
      throw new CharterFormatError(`Charter "${doc.id}" has invalid frontmatter: ${z5.prettifyError(parsed.error)}`);
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

// src/bundled-docs/doc-resolver/doc-resolver.ts
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z as z6 } from "zod";
var DocIdSchema = z6.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var FileDocResolverPropsSchema = z6.object({ docsDir: z6.string().min(1) });
var InstallDocsPropsSchema = z6.object({
  moduleUrl: z6.url().refine((value) => value.startsWith("file:")),
  env: z6.record(z6.string(), z6.string().optional())
});
var DocNotFoundPropsSchema = z6.object({ id: z6.string(), available: z6.array(z6.string()) });
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

// src/code-review/review-policy.ts
var ReviewPolicyPropsSchema = z7.strictObject({
  home: z7.string().min(1).optional(),
  env: z7.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional()
});
var LoadPolicyPropsSchema = z7.strictObject({ paths: z7.array(z7.string()).optional() });
var RepositoryContextPropsSchema = z7.strictObject({
  cwd: z7.string().min(1),
  trustedRef: HeadShaSchema,
  contextPath: ReviewPathSchema.min(1).default("CODE-REVIEW.md")
});
var FileReviewPolicy = class {
  home;
  env;
  constructor(props = {}) {
    const parsed = ReviewPolicyPropsSchema.parse(props);
    this.home = parsed.home ?? join2(dirname2(fileURLToPath2(import.meta.url)), "..");
    this.env = props.env ?? process.env;
  }
  load(input = {}) {
    const { paths } = LoadPolicyPropsSchema.parse(input);
    const docs = realpathSync2(join2(this.home, "docs"));
    const read = (id) => {
      const path = realpathSync2(join2(docs, `${id}.md`));
      if (relative(docs, path).startsWith(".."))
        throw new ReviewPolicyError("review policy path leaves the installed docs directory");
      return readFileSync2(path, "utf8");
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
      const tree = execFileSync("git", ["ls-tree", "-z", props.trustedRef, "--", path], {
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
        contents: execFileSync("git", ["show", `${props.trustedRef}:${path}`], {
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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z as z8 } from "zod";
var GhReviewGitHubApiPropsSchema = z8.strictObject({
  cwd: z8.string().min(1).optional(),
  env: z8.custom(
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
    const { stdout } = await promisify(execFile)("gh", args, {
      maxBuffer: 2e7,
      cwd: this.cwd,
      env: this.env
    });
    return JSON.parse(stdout);
  }
};
var GitHubReviewVerifierPropsSchema = z8.strictObject({
  repo: z8.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  prNumber: z8.number().int().positive(),
  prAuthorId: z8.number().int().positive(),
  owners: z8.record(z8.string(), z8.array(z8.string().min(1))).default({}),
  requireMapping: z8.boolean().default(false)
});
var UserSchema = z8.looseObject({ id: z8.number(), login: z8.string(), type: z8.string() });
var CommentSchema = z8.looseObject({
  id: z8.number(),
  user: UserSchema,
  issue_url: z8.string().optional(),
  pull_request_url: z8.string().optional(),
  body: z8.string()
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
      const check = z8.looseObject({
        head_sha: z8.string(),
        status: z8.string(),
        conclusion: z8.string().nullable()
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
    const permission = z8.looseObject({ permission: z8.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/collaborators/${encodeURIComponent(comment.user.login)}/permission`
      )
    );
    return ["write", "maintain", "admin"].includes(permission.permission);
  }
  async dismissal(evidence) {
    if (evidence.kind !== "thread_resolution" || evidence.author_id === this.props.prAuthorId)
      return false;
    const result = z8.looseObject({
      data: z8.looseObject({
        node: z8.looseObject({
          isResolved: z8.boolean(),
          resolvedBy: z8.looseObject({ databaseId: z8.number(), actorType: z8.string() }).nullable(),
          pullRequest: z8.looseObject({
            number: z8.number(),
            repository: z8.looseObject({ nameWithOwner: z8.string() })
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
    const comparison = z8.looseObject({ status: z8.string() }).parse(await this.api.get(`/repos/${this.props.repo}/compare/${sha}...${headSha}`));
    return ["ahead", "identical"].includes(comparison.status);
  }
  /** True when `ref` has `path` as a file with at least `line` lines. */
  async hasLine(path, line, ref) {
    const file = z8.looseObject({ type: z8.string(), encoding: z8.string(), content: z8.string() }).parse(
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

// src/code-review/diff-changes.ts
import { z as z9 } from "zod";

// src/code-review/diff-hunks.ts
var hunkHeader = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
var DiffHunks = class {
  /** True when the line opens a hunk. */
  static isHeader(line) {
    return hunkHeader.test(line);
  }
  /**
   * Consumes the hunk that starts at `lines[from]` and adds its changed new-side
   * lines to `into`. Only `+` lines count as added, so context lines are safe.
   * Removed lines mark the new-side lines on either side of the removal, which
   * is `c` and `c+1` for a `-U0` header `+c,0`. Returns the index after the hunk.
   */
  static collect(lines, from, into) {
    const header = hunkHeader.exec(lines[from] ?? "");
    if (!header) {
      return from + 1;
    }
    let newLine = header[3] === "0" ? Number(header[2]) + 1 : Number(header[2]);
    let oldRemaining = header[1] === void 0 ? 1 : Number(header[1]);
    let newRemaining = header[3] === void 0 ? 1 : Number(header[3]);
    let removalPending = false;
    let at = from + 1;
    while (at < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
      const line = lines[at] ?? "";
      at++;
      if (line.startsWith("\\")) {
        continue;
      }
      if (line.startsWith("+")) {
        into.add(newLine);
        newLine++;
        newRemaining--;
        removalPending = false;
      } else if (line.startsWith("-")) {
        oldRemaining--;
        removalPending = true;
      } else {
        if (removalPending) {
          into.add(newLine - 1);
          into.add(newLine);
          removalPending = false;
        }
        newLine++;
        oldRemaining--;
        newRemaining--;
      }
    }
    if (removalPending) {
      into.add(newLine - 1);
      into.add(newLine);
    }
    while (at < lines.length && (lines[at] ?? "").startsWith("\\")) {
      at++;
    }
    return at;
  }
};

// src/code-review/git-path.ts
var simpleEscapes = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92
};
var GitPath = class _GitPath {
  /** Decodes a path token, unquoting and unescaping it when git quoted it. */
  static decode(token) {
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
      return _GitPath.unescape(token.slice(1, -1));
    }
    return token;
  }
  /** Removes the single-letter `a/` or `b/` side prefix git adds to diff paths. */
  static stripSidePrefix(path) {
    return /^[ab]\//.test(path) ? path.slice(2) : path;
  }
  /** Reads the path from a `---` or `+++` line, dropping the tab git appends after unquoted paths. */
  static fromFileMarker(rest) {
    const unquoted = rest.startsWith('"') ? rest : rest.split("	")[0] ?? rest;
    return _GitPath.decode(unquoted);
  }
  /** Reads the new-side path from the arguments of a `diff --git` line. */
  static fromDiffHeader(rest) {
    if (rest.startsWith('"')) {
      const end = _GitPath.closingQuote(rest);
      const remainder = rest.slice(end + 1).trimStart();
      return remainder === "" ? void 0 : _GitPath.stripSidePrefix(_GitPath.decode(remainder));
    }
    const quotedSplit = rest.indexOf(' "b/');
    if (quotedSplit !== -1) {
      return _GitPath.stripSidePrefix(_GitPath.decode(rest.slice(quotedSplit + 1)));
    }
    const splits = [];
    for (let at = rest.indexOf(" b/"); at !== -1; at = rest.indexOf(" b/", at + 1)) {
      splits.push(at);
    }
    const symmetric = splits.find((at) => rest.slice(2, at) === rest.slice(at + 3));
    const chosen = symmetric ?? splits[splits.length - 1];
    return chosen === void 0 ? void 0 : rest.slice(chosen + 3);
  }
  static closingQuote(text) {
    for (let i = 1; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
      } else if (text[i] === '"') {
        return i;
      }
    }
    return text.length - 1;
  }
  static unescape(body) {
    const bytes = [];
    for (let i = 0; i < body.length; i++) {
      const char = body[i] ?? "";
      const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
      const simple = simpleEscapes[body[i + 1] ?? ""];
      if (char !== "\\") {
        bytes.push(...Buffer.from(char, "utf8"));
      } else if (octal) {
        bytes.push(parseInt(octal[0], 8) & 255);
        i += octal[0].length;
      } else if (simple !== void 0) {
        bytes.push(simple);
        i++;
      } else {
        bytes.push(92);
      }
    }
    return Buffer.from(bytes).toString("utf8");
  }
};

// src/code-review/diff-changes.ts
var UnifiedDiffChangesPropsSchema = z9.strictObject({
  entries: z9.map(z9.string(), z9.union([z9.literal("all"), z9.set(z9.number().int())]))
});
var FilePatchesSchema = z9.array(
  z9.object({
    filename: z9.string(),
    previous_filename: z9.string().optional(),
    status: z9.string(),
    patch: z9.string().optional(),
    changes: z9.number().int().nonnegative().optional()
  })
);
var UnifiedDiffChanges = class _UnifiedDiffChanges {
  entries;
  constructor(props) {
    this.entries = UnifiedDiffChangesPropsSchema.parse(props).entries;
  }
  /**
   * True when any line in the inclusive range `startLine..line` is changed, or
   * the file is wholly changed. Line 0 (a PR-wide finding) and an inverted
   * range are treated as changed; a path absent from the diff is unchanged.
   */
  touches(path, line, startLine) {
    const first = startLine ?? line;
    if (line <= 0 || first > line) {
      return true;
    }
    const entry = this.entries.get(path);
    if (entry === void 0) {
      return false;
    }
    if (entry === "all") {
      return true;
    }
    return [...entry].some((changed) => changed >= first && changed <= line);
  }
  /** Builds the index from the text of a `git diff` (typically `-U0`). */
  static parse(diff) {
    const text = z9.string().parse(diff);
    const lines = text.split(/\r?\n/);
    const entries = /* @__PURE__ */ new Map();
    let block;
    let at = 0;
    while (at < lines.length) {
      const line = lines[at] ?? "";
      if (line.startsWith("diff --git ")) {
        _UnifiedDiffChanges.finish(entries, block);
        block = _UnifiedDiffChanges.openBlock(GitPath.fromDiffHeader(line.slice(11)));
        at++;
      } else if (DiffHunks.isHeader(line)) {
        block ??= _UnifiedDiffChanges.openBlock(void 0);
        at = DiffHunks.collect(lines, at, block.lines);
      } else {
        if (line.startsWith("--- ") && (lines[at + 1] ?? "").startsWith("+++ ") && (!block || block.sawTarget)) {
          _UnifiedDiffChanges.finish(entries, block);
          block = _UnifiedDiffChanges.openBlock(void 0);
        }
        if (block) {
          _UnifiedDiffChanges.readMetadata(block, line);
        }
        at++;
      }
    }
    _UnifiedDiffChanges.finish(entries, block);
    return new _UnifiedDiffChanges({ entries });
  }
  /** Builds the index from GitHub compare-API file entries. */
  static fromFilePatches(files) {
    const entries = /* @__PURE__ */ new Map();
    for (const file of FilePatchesSchema.parse(files)) {
      const pureRename = file.status === "renamed" && file.patch === void 0 && file.changes === 0;
      if (file.status === "removed") {
        continue;
      }
      if (pureRename) {
        _UnifiedDiffChanges.merge(entries, file.filename, /* @__PURE__ */ new Set());
      } else if (file.status === "added" || file.patch === void 0) {
        _UnifiedDiffChanges.merge(entries, file.filename, "all");
      } else {
        const changed = /* @__PURE__ */ new Set();
        const lines = file.patch.split(/\r?\n/);
        for (let at = 0; at < lines.length; ) {
          at = DiffHunks.isHeader(lines[at] ?? "") ? DiffHunks.collect(lines, at, changed) : at + 1;
        }
        _UnifiedDiffChanges.merge(entries, file.filename, changed);
      }
    }
    return new _UnifiedDiffChanges({ entries });
  }
  static openBlock(path) {
    return { path, wholeFile: false, deleted: false, sawTarget: false, lines: /* @__PURE__ */ new Set() };
  }
  static readMetadata(block, line) {
    if (line.startsWith("new file mode ")) {
      block.wholeFile = true;
    } else if (line.startsWith("deleted file mode ")) {
      block.deleted = true;
    } else if (line.startsWith("rename to ")) {
      block.path = GitPath.fromFileMarker(line.slice(10));
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      block.wholeFile = true;
    } else if (line.startsWith("--- ")) {
      if (GitPath.fromFileMarker(line.slice(4)) === "/dev/null") {
        block.wholeFile = true;
      }
    } else if (line.startsWith("+++ ")) {
      const target = GitPath.fromFileMarker(line.slice(4));
      block.sawTarget = true;
      if (target === "/dev/null") {
        block.deleted = true;
      } else {
        block.path = GitPath.stripSidePrefix(target);
      }
    }
  }
  static finish(entries, block) {
    if (!block || block.path === void 0 || block.deleted) {
      return;
    }
    _UnifiedDiffChanges.merge(entries, block.path, block.wholeFile ? "all" : block.lines);
  }
  static merge(entries, path, change) {
    const existing = entries.get(path);
    if (existing === "all" || change === "all") {
      entries.set(path, "all");
    } else {
      entries.set(path, /* @__PURE__ */ new Set([...existing ?? [], ...change]));
    }
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
  UnifiedDiffChanges,
  ValidatedReviewVerifier,
  ZodReviewContract,
  reviewContract,
  reviewContractVersion,
  reviewSchemaRevision
};
