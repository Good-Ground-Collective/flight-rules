// src/sdk/instruction-catalog-core.ts
import { existsSync, readFileSync as readFileSync2, readdirSync as readdirSync2, realpathSync, statSync } from "node:fs";
import { basename as basename2, dirname, isAbsolute, join as join2, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z as z3 } from "zod";

// src/agents/agent-registry/agent-registry.ts
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z as z2 } from "zod";

// src/agents/agent-frontmatter/agent-frontmatter.ts
import { parse as parseYaml } from "yaml";

// src/agents/agent-frontmatter/agent-frontmatter.schema.ts
import { z } from "zod";
var agentCapabilities = ["read", "edit", "shell", "web", "spawn", "ask"];
var modelTiers = ["standard", "escalated", "expert"];
var reasoningLevels = ["low", "medium", "high"];
var claudeAgentColors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
var AgentCapabilitySchema = z.enum(agentCapabilities);
var ModelTierSchema = z.enum(modelTiers);
var AgentFrontmatterSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  capabilities: z.array(AgentCapabilitySchema).min(1).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    { message: "duplicate capability" }
  ),
  model: ModelTierSchema,
  modelReason: z.string().trim().min(1).optional(),
  reasoning: z.enum(reasoningLevels).optional(),
  sandbox: z.strictObject({
    fs: z.enum(["read-only", "workspace-write"]),
    network: z.enum(["none", "enabled"])
  }).optional(),
  dispatch: z.strictObject({
    maxConcurrent: z.int().positive(),
    maxDepth: z.int().positive()
  }).optional(),
  "x-claude": z.strictObject({ color: z.enum(claudeAgentColors).optional() }).optional()
});
var AgentRegistrationSchema = AgentFrontmatterSchema.refine(
  (agent) => agent.model !== "expert" || agent.modelReason !== void 0,
  { message: "expert tier requires modelReason", path: ["modelReason"] }
);

// src/agents/agent-frontmatter/agent-frontmatter.ts
var MissingFrontmatterError = class extends Error {
  name = "MissingFrontmatterError";
};
var YamlAgentFrontmatterParser = class {
  parse(markdown) {
    const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(markdown);
    if (match === null || match.index !== 0 || match[1] === void 0) {
      throw new MissingFrontmatterError("agent file has no leading --- frontmatter block");
    }
    const raw = parseYaml(match[1]);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new MissingFrontmatterError("frontmatter is not a YAML mapping");
    }
    return AgentFrontmatterSchema.parse(raw);
  }
};
var agentFrontmatterParser = new YamlAgentFrontmatterParser();

// src/agents/agent-registry/agent-registry.ts
var AgentNameSchema = AgentFrontmatterSchema.shape.name;
var AgentVariantSchema = z2.strictObject({
  name: AgentNameSchema,
  extends: AgentNameSchema,
  description: AgentFrontmatterSchema.shape.description,
  model: ModelTierSchema,
  modelReason: z2.string().trim().min(1).optional()
});
var AgentVariantsSchema = z2.array(AgentVariantSchema);
var InvalidAgentDefinitionError = class extends Error {
  name = "InvalidAgentDefinitionError";
};
var FileAgentRegistry = class {
  load(directory) {
    const agents = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
      const markdown = readFileSync(join(directory, entry.name), "utf8");
      const frontmatter = AgentRegistrationSchema.parse(agentFrontmatterParser.parse(markdown));
      const body = markdown.replace(/^---\r?\n[\s\S]*?^---(?:\r?\n|$)/m, "");
      if (frontmatter.name !== basename(entry.name, ".md") || body.trim() === "") {
        throw new InvalidAgentDefinitionError(`Agent ${entry.name} needs a matching name and a nonempty prompt`);
      }
      return { frontmatter, body };
    });
    const canonical = new Map(agents.map((agent) => [agent.frontmatter.name, agent]));
    const names = new Set(canonical.keys());
    const variants = AgentVariantsSchema.parse(JSON.parse(readFileSync(join(directory, "variants.json"), "utf8")));
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

// src/sdk/instruction-catalog-core.ts
var CatalogPropsSchema = z3.strictObject({
  moduleUrl: z3.string().min(1),
  env: z3.record(z3.string(), z3.string().optional())
});
var ResourceNameSchema = z3.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var UnknownInstructionError = class extends Error {
  name = "UnknownInstructionError";
};
var InstructionsUnavailableError = class extends Error {
  name = "InstructionsUnavailableError";
};
var UnsafeInstructionPathError = class extends Error {
  name = "UnsafeInstructionPathError";
};
var FileInstructionCatalog = class {
  skillDir;
  agentDir;
  agents;
  constructor(props) {
    const parsed = CatalogPropsSchema.parse({ ...props, env: { ...props.env } });
    const override = parsed.env["FLIGHT_RULES_HOME"]?.trim();
    const moduleDirectory = dirname(fileURLToPath(parsed.moduleUrl));
    const home = override || resolve(moduleDirectory, basename2(moduleDirectory) === "sdk" ? "../.." : "..");
    this.skillDir = this.findResourceDirectory(home, ["skills"]);
    this.agentDir = this.findResourceDirectory(home, [
      "bin/resources/agents",
      "agents",
      "resources/agents"
    ]);
    this.safePath(join2(this.agentDir, "variants.json"), this.agentDir);
    this.agents = new Map(
      new FileAgentRegistry().load(this.agentDir).map((agent) => [agent.frontmatter.name, agent])
    );
  }
  listSkills() {
    return readdirSync2(this.skillDir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name === "SKILL.md").map((entry) => relative(this.skillDir, join2(entry.parentPath, entry.name)).split(sep)[0]).filter((name) => name !== void 0).sort();
  }
  loadSkill(name) {
    const parsed = ResourceNameSchema.safeParse(name);
    if (!parsed.success) throw new UnsafeInstructionPathError(`Invalid skill name: ${name}`);
    const path = join2(this.skillDir, parsed.data, "SKILL.md");
    return {
      name: parsed.data,
      path: this.safePath(path, this.skillDir),
      contents: readFileSync2(this.safePath(path, this.skillDir), "utf8")
    };
  }
  listAgents() {
    return [...this.agents.keys()].sort();
  }
  loadAgent(name) {
    const parsed = ResourceNameSchema.safeParse(name);
    if (!parsed.success) throw new UnsafeInstructionPathError(`Invalid agent name: ${name}`);
    const agent = this.agents.get(parsed.data);
    if (agent === void 0) throw new UnknownInstructionError(`Unknown agent "${name}"`);
    return agent;
  }
  findResourceDirectory(home, candidates) {
    if (!existsSync(home) || !statSync(home).isDirectory()) {
      throw new InstructionsUnavailableError(
        `The flight-rules installation directory is unavailable: ${home}`
      );
    }
    const installationRoot = realpathSync(home);
    for (const candidate of candidates) {
      const path = resolve(installationRoot, candidate);
      if (!existsSync(path) || !statSync(path).isDirectory()) continue;
      const realPath = realpathSync(path);
      const relativePath = relative(installationRoot, realPath);
      if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new UnsafeInstructionPathError(
          `Instruction directory escapes its installation home: ${path}`
        );
      }
      return realPath;
    }
    throw new InstructionsUnavailableError(`Canonical resources are unavailable under ${home}`);
  }
  safePath(path, root) {
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isFile())
      throw new UnknownInstructionError(`Unknown instruction resource: ${path}`);
    const realPath = realpathSync(path);
    const relativePath = relative(root, realPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new UnsafeInstructionPathError(
        `Instruction resource escapes its installation directory: ${path}`
      );
    }
    return realPath;
  }
};

// src/sdk/instruction-catalog.ts
var instructionCatalog = new FileInstructionCatalog({
  moduleUrl: import.meta.url,
  env: process.env
});

// src/sdk/report-codec.ts
import { z as z6 } from "zod";
import { parse as parseYaml2 } from "yaml";

// src/orchestration/implementation-loop.schema.ts
import { z as z5 } from "zod";

// src/orchestration/orchestration.schema.ts
import { isAbsolute as isAbsolute2, relative as relative2, sep as sep2 } from "node:path";
import { z as z4 } from "zod";
var OrchestrationTextSchema = z4.string().refine((value) => value.trim().length > 0, "must not be blank");
var AbsolutePathSchema = OrchestrationTextSchema.refine(
  isAbsolute2,
  "must be an absolute path on this host"
);
var CapabilityNameSchema = z4.string().regex(/^[a-z][a-zA-Z0-9:.-]*$/);
var RunContextObjectSchema = z4.strictObject({
  runId: OrchestrationTextSchema,
  taskId: OrchestrationTextSchema,
  cwd: AbsolutePathSchema,
  repositoryRoot: AbsolutePathSchema,
  baseRef: OrchestrationTextSchema,
  skill: OrchestrationTextSchema
});
var RunContextSchema = RunContextObjectSchema.refine((value) => {
  const path = relative2(value.repositoryRoot, value.cwd);
  return path !== ".." && !path.startsWith(`..${sep2}`) && !isAbsolute2(path);
}, "working directory must be inside the active repository root");
var CallerContextSchema = RunContextSchema.safeExtend({ attempt: z4.int().positive() });
var CapabilityEvidenceSchema = z4.discriminatedUnion("state", [
  z4.strictObject({ state: z4.literal("available"), evidence: OrchestrationTextSchema }),
  z4.strictObject({
    state: z4.enum(["denied", "unknown"]),
    evidence: OrchestrationTextSchema,
    remedy: OrchestrationTextSchema
  })
]);
var AdapterLimitsSchema = z4.strictObject({
  maxConcurrent: z4.int().nonnegative().nullable(),
  activeWorkers: z4.int().nonnegative(),
  currentDepth: z4.int().nonnegative(),
  maxDepth: z4.int().nonnegative().nullable(),
  source: OrchestrationTextSchema
});
var RuntimeSnapshotSchema = z4.strictObject({
  context: CallerContextSchema,
  host: z4.strictObject({ name: OrchestrationTextSchema, version: OrchestrationTextSchema }),
  observedAt: z4.iso.datetime(),
  agent: AgentFrontmatterSchema.shape.name.nullable(),
  spawn: CapabilityEvidenceSchema,
  ask: CapabilityEvidenceSchema,
  permissions: z4.record(CapabilityNameSchema, CapabilityEvidenceSchema),
  limits: AdapterLimitsSchema
});
var DispatchRequestSchema = z4.strictObject({
  id: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema,
  input: z4.record(z4.string(), z4.json()),
  requiredCapabilities: z4.array(CapabilityNameSchema).optional()
});
var OrchestrationFailureSchema = z4.strictObject({
  code: z4.enum([
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
var OutcomeIdentitySchema = z4.strictObject({
  dispatchId: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema
});
var DispatchOutcomeSchema = z4.discriminatedUnion("status", [
  OutcomeIdentitySchema.extend({
    status: z4.literal("completed"),
    report: z4.record(z4.string(), z4.json())
  }),
  OutcomeIdentitySchema.extend({
    status: z4.enum(["failed", "unavailable"]),
    failure: OrchestrationFailureSchema
  })
]);
var QuestionRequestSchema = z4.strictObject({
  context: CallerContextSchema,
  question: OrchestrationTextSchema,
  allowHumanQuestions: z4.boolean()
});
var SiblingSkillRequestSchema = z4.strictObject({
  context: CallerContextSchema,
  skill: OrchestrationTextSchema,
  input: z4.record(z4.string(), z4.json())
});

// src/orchestration/implementation-loop.schema.ts
var ImplementationReportSchema = z5.strictObject({
  summary: OrchestrationTextSchema,
  filesChanged: z5.array(
    z5.strictObject({ path: OrchestrationTextSchema, why: OrchestrationTextSchema })
  ),
  testsRun: z5.array(
    z5.strictObject({ command: OrchestrationTextSchema, result: OrchestrationTextSchema })
  ),
  approach: OrchestrationTextSchema,
  openQuestions: z5.array(OrchestrationTextSchema).optional()
});
var CriterionResultSchema = z5.strictObject({
  criterion: OrchestrationTextSchema,
  verdict: z5.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
  evidence: OrchestrationTextSchema
});
var VerificationReportSchema = z5.strictObject({
  summary: OrchestrationTextSchema,
  criteria: z5.array(CriterionResultSchema).min(1),
  charterConcerns: z5.array(OrchestrationTextSchema).optional(),
  openQuestions: z5.array(OrchestrationTextSchema).optional(),
  verified: z5.boolean()
}).refine(
  (report) => report.verified === report.criteria.every((criterion) => criterion.verdict === "PASS"),
  "verified must agree with every itemized verdict"
);
var HandoffRecordSchema = z5.strictObject({
  request: DispatchRequestSchema,
  outcome: z5.unknown()
});
var ImplementationRunSchema = z5.strictObject({
  context: RunContextSchema,
  criteria: z5.array(OrchestrationTextSchema).min(1).refine((criteria) => new Set(criteria).size === criteria.length, "criteria must be distinct"),
  implementationInput: z5.record(z5.string(), z5.json()).refine(
    (input) => !Object.hasOwn(input, "verifierFailures"),
    "verifierFailures is reserved for validated retry evidence"
  ),
  history: z5.array(
    z5.strictObject({ implementation: HandoffRecordSchema, verification: HandoffRecordSchema })
  ).max(3)
});

// src/sdk/report-codec.ts
var reportText = OrchestrationTextSchema;
var JsonReportValueSchema = z6.json();
var InternalResearchSchema = z6.strictObject({
  files: z6.array(z6.strictObject({ path: reportText, why: reportText })),
  patterns: z6.array(reportText),
  integrationPoints: z6.array(reportText),
  risks: z6.array(reportText)
});
var ExternalResearchSchema = z6.strictObject({
  answer: reportText,
  sources: z6.array(z6.strictObject({ url: z6.url(), title: reportText })),
  exampleUsage: reportText.nullable(),
  caveats: z6.array(reportText)
});
var ResearchReportSchema = z6.strictObject({
  summary: reportText,
  confidence: z6.enum(["low", "med", "high"]),
  internal: InternalResearchSchema.optional(),
  external: ExternalResearchSchema.optional()
});
var EvidenceSchema = z6.strictObject({
  dir: reportText,
  items: z6.array(
    z6.strictObject({
      path: reportText,
      kind: z6.enum(["image", "video", "text"]),
      phase: z6.enum(["before", "after"]),
      caption: reportText
    })
  )
});
var QaReproduceSchema = z6.discriminatedUnion("reproduced", [
  z6.strictObject({
    summary: reportText,
    reproduced: z6.literal(true),
    needs: z6.array(reportText).optional(),
    steps: z6.array(reportText),
    after: z6.array(reportText),
    rootCause: reportText,
    trapForQA: reportText,
    fixedWhen: z6.array(reportText),
    evidence: EvidenceSchema,
    openQuestions: z6.array(reportText).optional()
  }),
  z6.strictObject({
    summary: reportText,
    reproduced: z6.literal(false),
    reason: reportText,
    needs: z6.array(reportText).optional(),
    evidence: EvidenceSchema,
    openQuestions: z6.array(reportText).optional()
  })
]);
var QaVerifySchema = z6.strictObject({
  summary: reportText,
  items: z6.array(
    z6.strictObject({
      item: reportText,
      verdict: z6.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
      evidence: reportText
    })
  ),
  evidence: EvidenceSchema,
  verified: z6.boolean(),
  needs: z6.array(reportText).optional(),
  openQuestions: z6.array(reportText).optional()
}).refine(
  (report) => report.verified === report.items.every((item) => item.verdict === "PASS"),
  "verified must agree with every item verdict"
);
var WriterFindingSchema = z6.strictObject({
  excerpt: reportText,
  location: reportText,
  mandate: reportText,
  problem: reportText,
  suggestion: reportText
});
var WriterFeedbackSchema = z6.strictObject({
  summary: reportText,
  verdict: z6.enum(["CLEAN", "MINOR", "HEAVY"]),
  findings: z6.array(WriterFindingSchema),
  strengths: z6.array(reportText),
  openQuestions: z6.array(reportText).optional()
});
var WriterChangeSchema = z6.strictObject({
  before: reportText,
  after: reportText,
  mandate: reportText,
  why: reportText
});
var WriterRewriteSchema = z6.strictObject({
  summary: reportText,
  verdict: z6.enum(["CLEAN", "MINOR", "HEAVY"]),
  changes: z6.array(WriterChangeSchema).optional(),
  rewritten: reportText.optional(),
  preserved: z6.array(reportText),
  openQuestions: z6.array(reportText).optional()
}).refine(
  (report) => report.changes === void 0 !== (report.rewritten === void 0),
  "rewrite reports must contain either file changes or inline rewritten text"
);
var WriterAuthorSchema = z6.strictObject({
  summary: reportText,
  whatWasChanged: z6.array(reportText.max(256)).min(1).max(5),
  whyWasItChanged: reportText,
  otsMaterials: reportText,
  openQuestions: z6.array(reportText).optional()
});
var ReportModeSchema = z6.union([
  z6.strictObject({ agent: z6.literal("code-implementation"), mode: z6.literal("implement") }),
  z6.strictObject({
    agent: z6.literal("code-implementation-escalated"),
    mode: z6.literal("implement")
  }),
  z6.strictObject({ agent: z6.literal("code-verifier"), mode: z6.literal("verify") }),
  z6.strictObject({
    agent: z6.literal("research-agent"),
    mode: z6.enum(["internal", "external", "mixed"])
  }),
  z6.strictObject({ agent: z6.literal("qa-engineer"), mode: z6.literal("reproduce") }),
  z6.strictObject({ agent: z6.literal("qa-engineer"), mode: z6.literal("verify") }),
  z6.strictObject({ agent: z6.literal("qa-engineer-verify"), mode: z6.literal("verify") }),
  z6.strictObject({ agent: z6.literal("tech-writer"), mode: z6.literal("feedback") }),
  z6.strictObject({ agent: z6.literal("tech-writer"), mode: z6.literal("rewrite") }),
  z6.strictObject({ agent: z6.literal("tech-writer"), mode: z6.literal("author") })
]);
var InvalidWorkerReportError = class extends Error {
  name = "InvalidWorkerReportError";
};
var WorkerReportCodec = class {
  parse(input, requested) {
    let mode;
    try {
      mode = ReportModeSchema.parse(requested);
    } catch (cause) {
      throw new InvalidWorkerReportError(cause instanceof Error ? cause.message : String(cause));
    }
    const report = this.pipelineFor(mode).safeParse(input);
    if (!report.success) throw new InvalidWorkerReportError(report.error.message);
    return report.data;
  }
  pipelineFor(mode) {
    return z6.string().transform((input, context) => {
      const blocks = [...input.matchAll(/```yaml\s*\r?\n([\s\S]*?)\r?\n```/gi)];
      const block = blocks.at(0);
      const before = block === void 0 ? "" : input.slice(0, block.index);
      const after = block === void 0 ? input : input.slice(block.index + block[0].length);
      if (blocks.length !== 1 || block === void 0 || after.trim() !== "" || before.trim() !== "" && mode.agent !== "research-agent" || before.includes("```")) {
        context.addIssue({
          code: "custom",
          message: "Return one final fenced YAML report; only research reports may have prose before it"
        });
        return z6.NEVER;
      }
      return block[1] ?? "";
    }).transform((yaml, context) => {
      try {
        return parseYaml2(yaml);
      } catch (cause) {
        context.addIssue({
          code: "custom",
          message: `Malformed YAML report: ${cause instanceof Error ? cause.message : String(cause)}`
        });
        return z6.NEVER;
      }
    }).pipe(JsonReportValueSchema).pipe(z6.preprocess((report) => report, this.schemaFor(mode)));
  }
  schemaFor(mode) {
    if (mode.agent === "code-implementation" || mode.agent === "code-implementation-escalated")
      return ImplementationReportSchema;
    if (mode.agent === "code-verifier") return VerificationReportSchema;
    if (mode.agent === "research-agent")
      return ResearchReportSchema.refine(
        (report) => (mode.mode === "external" || report.internal !== void 0) && (mode.mode === "internal" || report.external !== void 0),
        `research report must include the ${mode.mode} findings slots`
      );
    if (mode.agent === "qa-engineer" || mode.agent === "qa-engineer-verify")
      return mode.mode === "reproduce" ? QaReproduceSchema : QaVerifySchema;
    if (mode.mode === "feedback") return WriterFeedbackSchema;
    if (mode.mode === "rewrite") return WriterRewriteSchema;
    return WriterAuthorSchema;
  }
};
var workerReportCodec = new WorkerReportCodec();

// src/orchestration/implementation-loop.ts
import { isDeepStrictEqual as isDeepStrictEqual2 } from "node:util";

// src/orchestration/report-handoff.ts
import { isDeepStrictEqual } from "node:util";
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
    if (value.dispatchId !== expected.id || value.agent !== expected.agent || !isDeepStrictEqual(value.context, expected.context)) {
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

// src/orchestration/implementation-loop.ts
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
      if (!isDeepStrictEqual2(
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
        mode: "implement",
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
      input: {
        mode: "verify",
        criteria: [...run.criteria],
        filesChanged: filesChanged.map((path) => ({ path }))
      }
    };
  }
  readReport(expected, record, schema) {
    if (!isDeepStrictEqual2(expected, record.request)) {
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

// src/operations/operation-registry.ts
import { z as z8 } from "zod";

// src/operations/operation.schema.ts
import { z as z7 } from "zod";
var OperationEffectSchema = z7.enum(["read", "write", "network", "process"]);
var OperationIdSchema = z7.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var CliRouteSchema = z7.object({
  path: z7.array(z7.string().min(1)).min(1),
  aliases: z7.array(z7.string().min(1)).default([])
});
var OperationErrorSchema = z7.object({
  name: z7.string().min(1),
  message: z7.string()
});
var OperationEnvelopeSchema = z7.discriminatedUnion("status", [
  z7.object({ status: z7.literal("success"), data: z7.unknown() }),
  z7.object({ status: z7.literal("error"), error: OperationErrorSchema }),
  z7.object({ status: z7.literal("partial"), data: z7.unknown(), error: OperationErrorSchema })
]);

// src/operations/operation-registry.ts
var OperationDescriptorSchema = z8.object({
  id: OperationIdSchema,
  description: z8.string().min(1),
  inputSchema: z8.custom((value) => value instanceof z8.ZodType),
  outputSchema: z8.custom((value) => value instanceof z8.ZodType),
  effects: z8.array(OperationEffectSchema),
  cli: CliRouteSchema,
  handler: z8.custom((value) => typeof value === "function")
});
var OperationRegistryPropsSchema = z8.object({
  operations: z8.array(z8.custom()),
  policy: z8.custom().optional()
});
var AccessPolicyPropsSchema = z8.object({
  allowedOperationIds: z8.array(OperationIdSchema).default([]),
  allowedEffects: z8.array(OperationEffectSchema).default([])
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
var OperationInputError = class extends Error {
  name = "OperationInputError";
};
var OperationOutputError = class extends Error {
  name = "OperationOutputError";
};
var OperationAccessDeniedError = class extends Error {
  name = "OperationAccessDeniedError";
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
var OperationCliError = class extends Error {
  name = "OperationCliError";
  operationId;
  operationErrorName;
  partialData;
  constructor(props) {
    super(props.message);
    this.operationId = props.operationId;
    this.operationErrorName = props.errorName;
    this.partialData = props.partialData;
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
      const partial = z8.object({
        status: z8.literal("partial"),
        data: z8.unknown(),
        error: z8.object({ name: z8.string().min(1), message: z8.string() })
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

// src/operations/doc-operation.ts
import { z as z10 } from "zod";

// src/bundled-docs/doc-resolver/doc-resolver.ts
import { existsSync as existsSync2, readFileSync as readFileSync3, readdirSync as readdirSync3, realpathSync as realpathSync2, statSync as statSync2 } from "node:fs";
import { dirname as dirname2, join as join3, resolve as resolve2, sep as sep3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { z as z9 } from "zod";
var DocIdSchema = z9.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var FileDocResolverPropsSchema = z9.object({ docsDir: z9.string().min(1) });
var InstallDocsPropsSchema = z9.object({
  moduleUrl: z9.url().refine((value) => value.startsWith("file:")),
  env: z9.record(z9.string(), z9.string().optional())
});
var DocNotFoundPropsSchema = z9.object({ id: z9.string(), available: z9.array(z9.string()) });
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
    this.docsDir = resolve2(FileDocResolverPropsSchema.parse(props).docsDir);
  }
  list() {
    return readdirSync3(this.docsDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name.slice(0, -3)).sort();
  }
  resolve(id) {
    if (!DocIdSchema.safeParse(id).success) {
      throw new InvalidDocIdError("Invalid doc id \u2014 use lowercase letters, digits, and single hyphens");
    }
    const path = join3(this.docsDir, `${id}.md`);
    if (!existsSync2(path) || !statSync2(path).isFile()) {
      throw new DocNotFoundError({ id, available: this.list() });
    }
    const realPath = realpathSync2(path);
    if (!realPath.startsWith(`${realpathSync2(this.docsDir)}${sep3}`)) {
      throw new DocNotFoundError({ id, available: this.list() });
    }
    return { id, path: realPath, contents: readFileSync3(realPath, "utf8") };
  }
  static fromInstall(props) {
    const { moduleUrl, env } = InstallDocsPropsSchema.parse({ ...props, env: { ...props.env } });
    const override = env["FLIGHT_RULES_HOME"]?.trim();
    const home = override || join3(dirname2(fileURLToPath2(moduleUrl)), "..");
    const docsDir = resolve2(home, "docs");
    if (!existsSync2(docsDir) || !statSync2(docsDir).isDirectory()) {
      const source = override ? `FLIGHT_RULES_HOME is set to ${override} but` : "Bundled docs directory";
      throw new DocsUnavailableError(`${source} ${docsDir} does not exist or is not a directory \u2014 point FLIGHT_RULES_HOME at the flight-rules install root`);
    }
    return new _FileDocResolver({ docsDir });
  }
};

// src/operations/doc-operation.ts
var DocOperationInputSchema = z10.object({ id: DocIdSchema });
var DocOperationOutputSchema = z10.object({ id: DocIdSchema, path: z10.string().min(1), contents: z10.string() });
var DocOperationPropsSchema = z10.object({
  getResolver: z10.custom((value) => typeof value === "function")
});
var DocOperation = class {
  id = "doc";
  description = "Read a bundled flight-rules document by its document ID.";
  inputSchema = DocOperationInputSchema;
  outputSchema = DocOperationOutputSchema;
  effects = ["read"];
  cli = { path: ["doc"], aliases: [] };
  getResolver;
  constructor(props) {
    this.getResolver = DocOperationPropsSchema.parse(props).getResolver;
  }
  handler({ id }) {
    return this.getResolver().resolve(id);
  }
};

// src/operations/local-discovery-operations.ts
import { readdirSync as readdirSync4 } from "node:fs";
import { resolve as resolve5 } from "node:path";
import { z as z15 } from "zod";

// src/shared/config.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { dirname as dirname3, isAbsolute as isAbsolute3, join as join4, resolve as resolve3 } from "node:path";
import { z as z13 } from "zod";

// src/tasks/jira-task-tracker/jira-host.ts
import { z as z11 } from "zod";
var JiraHostSchema = z11.string().transform((host) => host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, ""));

// src/shared/ariadne/ariadne.schema.ts
import { z as z12 } from "zod";
var loopbackHosts = /* @__PURE__ */ new Set(["localhost", "127.0.0.1"]);
var AriadneUrlSchema = z12.url().refine((value) => {
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
var oneLineSchema = (max) => z12.string().transform((value) => normalizer.oneLine(value, max)).pipe(z12.string().min(1, "must not be blank"));
var multiLineSchema = (max) => z12.string().transform((value) => normalizer.multiLine(value, max)).pipe(z12.string().min(1, "must not be blank"));
var optionalSchema = (schema) => z12.preprocess((value) => value === "" || value === null ? void 0 : value, schema.optional());
var AgentSessionIdSchema = z12.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "must be 1\u201380 letters, digits, underscores or hyphens");
var AgentRecordIdSchema = AgentSessionIdSchema;
var TicketKeySchema = z12.string().transform((value) => value.trim().toUpperCase()).pipe(z12.string().regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$/, "must be a Jira issue key: project key, hyphen, number"));
var RepoSchema = z12.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/)?[A-Za-z0-9_.-]{1,100}$/, "must be owner/name or name").refine((value) => !value.includes(".."), "must not contain ..");
var BranchSchema = z12.string().regex(/^[A-Za-z0-9_+@][A-Za-z0-9._/+@-]{0,254}$/, "must be a branch name as git prints it").refine((value) => !value.includes(".."), "must not contain ..");
var SkillSchema = z12.string().regex(/^[A-Za-z0-9:._-]{1,80}$/, "must be up to 80 of A-Z a-z 0-9 : . _ -");
var HeartbeatInputSchema = z12.strictObject({
  session: AgentSessionIdSchema,
  step: oneLineSchema(agentLimits.step),
  state: z12.enum(agentStates),
  ticket: optionalSchema(TicketKeySchema),
  repo: optionalSchema(RepoSchema),
  branch: optionalSchema(BranchSchema),
  skill: optionalSchema(SkillSchema),
  detail: optionalSchema(oneLineSchema(agentLimits.heartbeatDetail))
});
var ItemInputSchema = z12.strictObject({
  session: AgentSessionIdSchema,
  kind: z12.enum(agentItemKinds),
  title: oneLineSchema(agentLimits.title),
  ticket: optionalSchema(TicketKeySchema),
  detail: optionalSchema(multiLineSchema(agentLimits.itemDetail)),
  options: z12.array(oneLineSchema(agentLimits.option)).max(agentLimits.options, `up to ${agentLimits.options} options`).refine((labels) => new Set(labels).size === labels.length, "options must be distinct").optional(),
  id: optionalSchema(AgentRecordIdSchema)
});
var ActivityInputSchema = z12.strictObject({
  session: AgentSessionIdSchema,
  text: oneLineSchema(agentLimits.text),
  level: optionalSchema(z12.enum(agentActivityLevels)),
  ticket: optionalSchema(TicketKeySchema),
  id: optionalSchema(AgentRecordIdSchema)
});
var AgentSessionSchema = z12.looseObject({
  id: z12.string(),
  ownerId: z12.string(),
  ticket: z12.string().nullable(),
  step: z12.string(),
  state: z12.string(),
  lastHeartbeat: z12.string(),
  running: z12.boolean()
});
var AgentItemSchema = z12.looseObject({
  id: z12.string(),
  session: z12.string(),
  kind: z12.string(),
  ticket: z12.string().nullable(),
  title: z12.string(),
  detail: z12.string().nullable(),
  options: z12.array(z12.string()),
  status: z12.string(),
  chosenOption: z12.string().nullable(),
  createdAt: z12.string(),
  resolvedAt: z12.string().nullable(),
  resolvedBy: z12.string().nullable()
});
var AgentActivitySchema = z12.looseObject({
  id: z12.string(),
  at: z12.string(),
  session: z12.string(),
  ticket: z12.string().nullable(),
  level: z12.string(),
  text: z12.string()
});
var HeartbeatResponseSchema = z12.looseObject({ session: AgentSessionSchema });
var ItemResponseSchema = z12.looseObject({ item: AgentItemSchema, created: z12.boolean() });
var ActivityResponseSchema = z12.looseObject({ activity: AgentActivitySchema, created: z12.boolean() });
var ItemListResponseSchema = z12.looseObject({ items: z12.array(AgentItemSchema) });
var AgentErrorBodySchema = z12.looseObject({ error: z12.string(), message: z12.string().optional() });

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
var ConfigSchema = z13.object({
  tracker: z13.enum(["github", "jira"]),
  repo: z13.string().optional().describe("GitHub owner/repo; required when tracker is github"),
  jiraHost: JiraHostSchema.optional().describe(
    "Atlassian Cloud host, e.g. acme.atlassian.net"
  ),
  jiraEmail: z13.string().optional().describe("Atlassian account email for Basic auth"),
  jiraProject: z13.string().optional().describe("Jira project key holding epics and tickets"),
  jpdProject: z13.string().optional().describe("Jira Product Discovery project key holding initiatives"),
  confluenceSpaceKey: z13.string().optional().describe("Confluence space key holding technical design docs"),
  inProgressStatus: z13.string().optional().describe(
    "Tracker status meaning work has started; discovered and stored on first run"
  ),
  inReviewStatus: z13.string().optional().describe(
    "Tracker status meaning a PR is open; discovered and stored on first run"
  ),
  defaultLabels: z13.array(z13.string()).default([]),
  rfcStorage: z13.enum(["local", "global"]).default("local"),
  rfcStoragePath: z13.string().optional(),
  qaRecipe: z13.string().optional().describe(
    "Deprecated: path to a legacy QA recipe, read only when no QA.md or AGENTS.md QA section exists; relative paths resolve against the directory holding this config file; defaults to flight-rules.qa.md beside it"
  ),
  competencies: z13.array(z13.string()).default([...seedCompetencies]),
  "ariadne.url": AriadneUrlSchema.optional().describe(
    "Ariadne API base URL for `flight-rules board`; https only (http for localhost); read only from user or local scope; defaults to the production Ariadne API"
  ),
  "ariadne.enabled": z13.boolean().optional().describe(
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
function getRfcDir(config, cwd) {
  if (config.rfcStorage === "global") {
    if (config.rfcStoragePath === void 0) {
      throw new Error("rfcStoragePath is required when rfcStorage is global");
    }
    return config.rfcStoragePath;
  }
  return join4(cwd, "rfcs");
}
var NodePathProbe = class {
  isFile(path) {
    return existsSync3(path) && statSync3(path, { throwIfNoEntry: false })?.isFile() === true;
  }
  isDirectory(path) {
    return existsSync3(path) && statSync3(path, { throwIfNoEntry: false })?.isDirectory() === true;
  }
};
var nodePathProbe = new NodePathProbe();
function getQaRecipePath(config, configPath) {
  const recipe = config.qaRecipe ?? "flight-rules.qa.md";
  if (isAbsolute3(recipe)) return recipe;
  return resolve3(dirname3(configPath), recipe);
}

// src/tasks/qa-instructions/qa-instructions.ts
import { existsSync as existsSync4, readFileSync as readFileSync5, statSync as statSync4 } from "node:fs";
import { dirname as dirname4, join as join5, resolve as resolve4 } from "node:path";
var atxHeading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
var fenceRun = /^ {0,3}(`{3,}|~{3,})/;
var legacyHint = 'Legacy QA recipe in use. Move its content into a QA.md at the repo root (or a "QA" section of AGENTS.md); see docs/qa-instructions.md.';
var nodeFileSystem = {
  isFile: (path) => existsSync4(path) && statSync4(path).isFile(),
  exists: (path) => existsSync4(path),
  readFile: (path) => readFileSync5(path, "utf8")
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
    const absolute = resolve4(from);
    const start = this.fs.isFile(absolute) ? dirname4(absolute) : absolute;
    const levels = [];
    let current = start;
    for (; ; ) {
      levels.push(current);
      if (this.fs.exists(join5(current, ".git"))) return levels;
      const parent = dirname4(current);
      if (parent === current) return [start];
      current = parent;
    }
  }
  sourceAt(dir) {
    const agentsMd = join5(dir, "AGENTS.md");
    if (this.fs.isFile(agentsMd)) {
      const section = this.extractQaSection(this.fs.readFile(agentsMd));
      if (section !== void 0)
        return { path: agentsMd, kind: "agents-md-section", dir, content: section };
    }
    return this.fileSource(join5(dir, "QA.md"), "qa-md", dir) ?? this.fileSource(join5(dir, ".agents", "QA.md"), "agents-dir-qa-md", dir);
  }
  fileSource(path, kind, dir) {
    if (!this.fs.isFile(path)) return void 0;
    const content = this.fs.readFile(path).trim();
    return content.length > 0 ? { path, kind, dir, content } : void 0;
  }
  legacySource(path) {
    if (path === void 0) return void 0;
    const source = this.fileSource(path, "legacy-recipe", dirname4(path));
    return source === void 0 ? void 0 : { ...source, legacy: true, hint: legacyHint };
  }
};

// src/tasks/readiness/readiness.schema.ts
import { z as z14 } from "zod";
var WorkflowSchema = z14.enum([
  "execute-work",
  "execute-wave",
  "break-down-work",
  "reproduce-bug",
  "verify-ticket"
]);
var WorkflowEvidenceSchema = z14.strictObject({
  context: CallerContextSchema,
  callerCapabilities: z14.record(z14.string(), CapabilityEvidenceSchema),
  workers: z14.array(
    z14.strictObject({ registration: AgentRegistrationSchema, runtime: RuntimeSnapshotSchema })
  ).refine(
    (workers) => new Set(workers.map((worker) => worker.registration.name)).size === workers.length,
    "duplicate worker evidence"
  )
});
var ReadinessOptionsSchema = z14.strictObject({
  workflow: WorkflowSchema.optional(),
  /** Supplying evidence opts into host checks in addition to environment probes. */
  evidence: WorkflowEvidenceSchema.optional()
}).refine(
  (value) => value.evidence === void 0 || value.workflow !== void 0,
  "workflow is required with capability evidence"
);

// src/operations/local-discovery-operations.ts
var QaSourceSchema = z15.object({
  path: z15.string(),
  kind: z15.enum(["agents-md-section", "qa-md", "agents-dir-qa-md", "legacy-recipe"]),
  dir: z15.string(),
  content: z15.string(),
  legacy: z15.literal(true).optional(),
  hint: z15.string().optional()
});
var QaInstructionsSchema = z15.object({ found: z15.boolean(), sources: z15.array(QaSourceSchema) });
var ReadinessCheckSchema = z15.object({
  name: z15.string(),
  ok: z15.boolean(),
  detail: z15.string(),
  required: z15.boolean().optional(),
  code: z15.string().optional(),
  remedy: z15.string().optional()
});
var ReadinessReportSchema = z15.object({
  tracker: z15.string().nullable(),
  repo: z15.string().nullable().optional(),
  checks: z15.array(ReadinessCheckSchema),
  ok: z15.boolean(),
  workflow: WorkflowSchema.optional(),
  scope: z15.enum(["environment", "workflow"])
});
var ConfigInspectionSchema = z15.object({
  host: z15.string(),
  valid: z15.boolean(),
  error: z15.string().optional(),
  values: z15.record(z15.string(), z15.unknown()),
  sources: z15.record(
    z15.string(),
    z15.object({ scope: z15.enum(["user", "project", "local", "file"]), path: z15.string() })
  ),
  layers: z15.array(
    z15.object({
      scope: z15.enum(["user", "project", "local", "file"]),
      path: z15.string(),
      present: z15.boolean()
    })
  )
});
var CharterInputSchema = z15.object({
  paths: z15.array(z15.string()).optional(),
  diff: z15.string().optional(),
  repository: z15.boolean().default(false),
  pathOutput: z15.boolean().default(false)
}).strict().refine(
  (input) => Number(input.paths !== void 0 && input.paths.length > 0) + Number(input.diff !== void 0) + Number(input.repository) <= 1,
  "Choose one charter selection source"
);
var QaInstructionsInputSchema = z15.object({ from: z15.string().optional() }).strict();
var RfcDirectoryOutputSchema = z15.object({ path: z15.string() });
var RfcNextIdOutputSchema = z15.object({
  id: z15.string().regex(/^RFC-\d+$/),
  directory: z15.string()
});
var QaRecipeOutputSchema = z15.object({ path: z15.string() });
var EvidenceDirectoryOutputSchema = z15.object({
  path: z15.string(),
  gitignored: z15.boolean().nullable()
});
var rfcIdPattern = /^RFC-(\d+)\.md$/;
var LocalDiscoveryPropsSchema = z15.object({
  cwd: z15.string().min(1),
  getConfig: z15.custom((value) => typeof value === "function"),
  getConfigStore: z15.custom((value) => typeof value === "function"),
  getCharters: z15.custom((value) => typeof value === "function"),
  getRepositoryPaths: z15.custom((value) => typeof value === "function"),
  getEvidence: z15.custom((value) => typeof value === "function"),
  getReadiness: z15.custom((value) => typeof value === "function"),
  getProbe: z15.custom((value) => typeof value === "function"),
  getTracker: z15.custom((value) => typeof value === "function"),
  getConfigPath: z15.custom((value) => typeof value === "function"),
  getQaFinder: z15.custom((value) => typeof value === "function").optional()
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
        z15.object({
          charters: z15.array(
            z15.object({ path: z15.string(), contents: z15.string(), language: z15.string().nullable() })
          ),
          unmatched: z15.boolean()
        }),
        (input) => this.charter(input)
      ),
      this.descriptor(
        "competencies",
        "Read the configured worker competencies.",
        ["read", "process"],
        ["competencies"],
        z15.object({}),
        z15.array(z15.string()),
        () => this.props.getConfig().competencies
      ),
      this.descriptor(
        "rfc-dir",
        "Resolve the RFC directory for this checkout.",
        ["read", "process"],
        ["rfc", "dir"],
        z15.object({}),
        RfcDirectoryOutputSchema,
        () => ({ path: getRfcDir(this.props.getConfig(), this.props.cwd) })
      ),
      this.descriptor(
        "rfc-next-id",
        "Find the next RFC number in the configured RFC directory.",
        ["read", "process"],
        ["rfc", "next-id"],
        z15.object({}),
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
        z15.object({ ticket: z15.string().min(1) }),
        EvidenceDirectoryOutputSchema,
        (input) => this.props.getEvidence().dirFor(input.ticket)
      ),
      this.descriptor(
        "qa-recipe",
        "Resolve the nearest QA instruction path (deprecated CLI route).",
        ["read", "process"],
        ["qa", "recipe"],
        z15.object({}),
        QaRecipeOutputSchema,
        () => this.qaRecipe()
      ),
      this.descriptor(
        "config-path",
        "Resolve the config file path for this checkout.",
        ["read", "process"],
        ["config", "path"],
        z15.object({}),
        z15.object({ path: z15.string() }),
        () => ({ path: this.props.getConfigStore().filePath() })
      ),
      this.descriptor(
        "config-show",
        "Inspect merged configuration and its sources.",
        ["read", "process"],
        ["config", "show"],
        z15.object({}),
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
      files = readdirSync4(directory);
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
      from: input.from === void 0 ? this.props.cwd : resolve5(this.props.cwd, input.from),
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

// src/operations/local-discovery-cli.ts
import { text } from "node:stream/consumers";
import { Option as Option2 } from "commander";
import { z as z25 } from "zod";

// src/shared/host-settings/claude-settings-source.ts
import { z as z16 } from "zod";
var SettingsSchema = z16.looseObject({
  pluginConfigs: z16.record(z16.string(), z16.looseObject({ options: z16.record(z16.string(), z16.unknown()).optional() })).optional()
});

// src/shared/host-settings/neutral-settings-source.ts
import { homedir } from "node:os";
import { z as z17 } from "zod";
var PropsSchema = z17.object({
  cwd: z17.string().min(1),
  home: z17.string().min(1).default(homedir),
  untrackedCwd: z17.string().min(1).optional()
});
var SettingsSchema2 = z17.record(z17.string(), z17.unknown());

// src/plugins/native-installation/native-installation.ts
import { homedir as homedir2 } from "node:os";
import { z as z18 } from "zod";
var NativeHostSchema = z18.enum(["claude", "codex"]);
var AgentInstallScopeSchema = z18.enum(["project", "user"]);
var InstallationManifestSchema = z18.strictObject({
  host: NativeHostSchema,
  agents: z18.array(z18.strictObject({
    name: z18.string().regex(/^[a-z][a-z0-9-]*$/),
    sha256: z18.string().regex(/^[a-f0-9]{64}$/),
    registration: AgentRegistrationSchema
  })).min(1)
}).refine((value) => new Set(value.agents.map((agent) => agent.name)).size === value.agents.length, "Duplicate agent names").refine((value) => value.agents.every((agent) => agent.name === agent.registration.name), "Registration name mismatch");
var PropsSchema2 = z18.object({
  root: z18.string().min(1),
  cwd: z18.string().min(1),
  home: z18.string().min(1).default(homedir2),
  env: z18.record(z18.string(), z18.string().optional()).default({})
});

// src/shared/config-store.ts
var configScopes = ["user", "project", "local", "file"];

// src/tasks/commands/check/command.ts
import { Command, Option } from "commander";

// src/tasks/readiness/repository-readiness.ts
import { z as z24 } from "zod";

// src/shared/env.ts
import { z as z19 } from "zod";
var EnvSchema = z19.object({
  githubToken: z19.string().optional(),
  jiraToken: z19.string().optional(),
  jiraEmail: z19.string().optional(),
  jiraHost: JiraHostSchema.optional()
});

// src/tasks/readiness/probe-diagnostics.ts
import { z as z20 } from "zod";
var ProbeDiagnosticsPropsSchema = z20.object({ env: z20.record(z20.string(), z20.string().optional()) });
var ErrorFactsSchema = z20.object({
  code: z20.union([z20.string(), z20.number()]).nullable().optional(),
  status: z20.number().optional(),
  statusCode: z20.number().optional(),
  killed: z20.boolean().optional(),
  name: z20.string().optional(),
  message: z20.string().optional(),
  stderr: z20.string().optional(),
  cause: z20.unknown().optional()
});

// src/tasks/readiness/workflow-preflight.ts
import { z as z23 } from "zod";

// src/orchestration/orchestration-policy.ts
import { z as z22 } from "zod";

// src/agents/agent-emitter/agent-emitter.schema.ts
import { z as z21 } from "zod";
var ModelBindingsSchema = z21.strictObject({
  standard: z21.string().trim().min(1),
  escalated: z21.string().trim().min(1),
  expert: z21.string().trim().min(1)
});
var AgentDefinitionSchema = z21.strictObject({
  frontmatter: AgentRegistrationSchema,
  body: z21.string().refine((body) => body.trim() !== "", "agent prompt must not be empty")
});

// src/orchestration/orchestration-policy.ts
var RegistryOrchestrationPolicyPropsSchema = z22.strictObject({
  agents: z22.array(AgentDefinitionSchema).min(1).refine(
    (agents) => new Set(agents.map((agent) => agent.frontmatter.name)).size === agents.length,
    "duplicate agent name"
  )
});

// src/tasks/readiness/workflow-preflight.ts
var WorkflowPreflightPropsSchema = z23.object({
  cwd: z23.string(),
  env: z23.record(z23.string(), z23.string().optional()),
  timeoutMs: z23.int().positive().max(6e4).default(1e4)
});

// src/tasks/readiness/repository-readiness.ts
var RepositoryReadinessPropsSchema = z24.object({
  cwd: z24.string().optional(),
  env: z24.record(z24.string(), z24.string().optional()).optional(),
  timeoutMs: z24.int().positive().max(6e4).default(1e4)
});

// src/tasks/commands/check/command.ts
var ReadinessFailedError = class extends Error {
  name = "ReadinessFailedError";
};

// src/operations/local-discovery-cli.ts
var CharterResultSchema = z25.object({
  charters: z25.array(
    z25.object({ path: z25.string(), contents: z25.string(), language: z25.string().nullable() })
  ),
  unmatched: z25.boolean()
});
var ConfigPathResultSchema = z25.object({ path: z25.string() });
var RfcIdResultSchema = z25.object({ id: z25.string() });
var CompetenciesResultSchema = z25.array(z25.string());
var ConfigInspectionResultSchema = z25.object({
  host: z25.string(),
  valid: z25.boolean(),
  values: z25.record(z25.string(), z25.unknown()),
  sources: z25.record(z25.string(), z25.unknown()),
  layers: z25.array(z25.unknown()),
  error: z25.string().optional()
});
var ReadinessResultSchema = z25.object({
  tracker: z25.string().nullable(),
  repo: z25.string().nullable().optional(),
  checks: z25.array(z25.unknown()),
  ok: z25.boolean(),
  workflow: WorkflowSchema.optional(),
  scope: z25.enum(["environment", "workflow"])
});
var LocalDiscoveryCliPropsSchema = z25.object({
  registry: z25.custom(
    (value) => typeof value === "object" && value !== null && "invoke" in value
  ),
  readStdin: z25.custom((value) => typeof value === "function").optional()
});
var CommanderLocalDiscoveryCli = class {
  registry;
  readStdin;
  constructor(props) {
    const parsed = LocalDiscoveryCliPropsSchema.parse(props);
    this.registry = parsed.registry;
    this.readStdin = parsed.readStdin ?? (() => text(process.stdin));
  }
  addTo(program) {
    this.addCharter(program);
    this.addCompetencies(program);
    this.addRfc(program);
    this.addQa(program);
    this.addConfig(program);
    this.addCheck(program);
  }
  addCharter(program) {
    program.command("charter").description("print the core coding charter and language charters for selected files").argument("[paths...]").option("--stdin").option("--diff <base>").option("--repo").option("--path").exitOverride().action(
      async (paths, opts) => {
        const selectedSources = [
          paths.length > 0,
          opts.stdin === true,
          opts.diff !== void 0,
          opts.repo === true
        ];
        if (selectedSources.filter(Boolean).length > 1)
          throw new CharterSelectionError("Choose one of: paths, --stdin, --diff <base>, --repo");
        const selectedPaths = opts.stdin ? (await this.readStdin()).split("\n") : paths;
        const input = {
          ...opts.stdin || paths.length > 0 ? { paths: selectedPaths } : {},
          ...opts.diff === void 0 ? {} : { diff: opts.diff },
          repository: opts.repo ?? false,
          pathOutput: opts.path ?? false
        };
        const result = await this.invoke("charter", input, CharterResultSchema);
        if (result.unmatched)
          process.stderr.write(
            "No language charter matched these files; printing the core charter only.\n"
          );
        const output = opts.path ? result.charters.map((charter) => `${charter.path}
`).join("") : result.charters.map(
          (charter) => charter.contents.endsWith("\n") ? charter.contents : `${charter.contents}
`
        ).join("\n");
        process.stdout.write(output);
      }
    );
  }
  addCompetencies(program) {
    program.command("competencies").exitOverride().action(async () => {
      process.stdout.write(
        `${JSON.stringify(await this.invoke("competencies", {}, CompetenciesResultSchema))}
`
      );
    });
  }
  addRfc(program) {
    const rfc = program.command("rfc");
    rfc.command("dir").exitOverride().action(async () => {
      process.stdout.write(
        `${(await this.invoke("rfc-dir", {}, ConfigPathResultSchema)).path}
`
      );
    });
    rfc.command("next-id").exitOverride().action(async () => {
      process.stdout.write(`${(await this.invoke("rfc-next-id", {}, RfcIdResultSchema)).id}
`);
    });
  }
  addQa(program) {
    const qa = program.command("qa");
    qa.command("instructions").description("print the QA instructions that apply to a directory, nearest first, as JSON").option("--from <dir>").exitOverride().action(async (opts) => {
      process.stdout.write(
        `${JSON.stringify(await this.invoke("qa-instructions", opts.from === void 0 ? {} : { from: opts.from }, z25.object({ found: z25.boolean(), sources: z25.array(z25.unknown()) })))}
`
      );
    });
    qa.command("evidence-dir").description(
      "print where QA evidence for a ticket is written, and whether git ignores it, as JSON"
    ).argument("<ticket>").exitOverride().action(async (ticket) => {
      process.stdout.write(
        `${JSON.stringify(await this.invoke("qa-evidence-dir", { ticket }, z25.object({ path: z25.string(), gitignored: z25.boolean().nullable() })))}
`
      );
    });
    qa.command("recipe").description(
      "deprecated: print the path of the nearest QA instructions; use `qa instructions`"
    ).exitOverride().action(async () => {
      const result = await this.invoke("qa-recipe", {}, ConfigPathResultSchema);
      process.stderr.write(
        "`flight-rules qa recipe` is deprecated; use `flight-rules qa instructions`\n"
      );
      process.stdout.write(`${result.path}
`);
    });
  }
  addConfig(program) {
    const config = program.command("config");
    config.command("path").description("print the resolved config file path, whether or not it exists").exitOverride().action(async () => {
      process.stdout.write(
        `${(await this.invoke("config-path", {}, ConfigPathResultSchema)).path}
`
      );
    });
    config.command("show").description(
      "print the merged config, which file each value came from, and whether it is valid"
    ).exitOverride().action(async () => {
      process.stdout.write(
        `${JSON.stringify(await this.invoke("config-show", {}, ConfigInspectionResultSchema))}
`
      );
    });
    const scopeHelp = "where to write: user, project, local, or file; config show reports the selected host and exact paths (override with FLIGHT_RULES_HOST=claude|codex)";
    config.command("set").description("write one config value; array keys take several values").argument("<key>").argument("<values...>").addOption(new Option2("--scope <scope>", scopeHelp).choices(configScopes)).exitOverride().action(async (key, values, options) => {
      const result = await this.invoke(
        "config-set",
        { key, values, ...options.scope === void 0 ? {} : { scope: options.scope } },
        z25.object({
          key: z25.string(),
          scope: z25.enum(configScopes),
          path: z25.string(),
          warning: z25.string().optional()
        })
      );
      process.stdout.write(`${JSON.stringify(result)}
`);
    });
    config.command("unset").description("remove one config value from a scope").argument("<key>").addOption(new Option2("--scope <scope>", scopeHelp).choices(configScopes)).exitOverride().action(async (key, options) => {
      const result = await this.invoke(
        "config-unset",
        { key, ...options.scope === void 0 ? {} : { scope: options.scope } },
        z25.object({ key: z25.string(), scope: z25.enum(configScopes), path: z25.string() })
      );
      process.stdout.write(`${JSON.stringify(result)}
`);
    });
  }
  addCheck(program) {
    program.command("check").addOption(
      new Option2(
        "--workflow <name>",
        "check readiness for this workflow before its first mutation"
      ).choices(WorkflowSchema.options)
    ).exitOverride().action(async (options) => {
      const input = ReadinessOptionsSchema.parse({ workflow: options.workflow });
      const report = await this.invoke("check", input, ReadinessResultSchema);
      process.stdout.write(`${JSON.stringify(report)}
`);
      if (!report.ok)
        throw new ReadinessFailedError("flight-rules check failed \u2014 see report above");
    });
  }
  async invoke(id, input, outputSchema) {
    const result = await this.registry.invoke(id, input);
    if (result.status !== "success")
      throw new OperationCliError({
        operationId: id,
        errorName: result.status === "error" ? result.error.name : result.error.name,
        message: result.error.message
      });
    return outputSchema.parse(result.data);
  }
};
var CharterSelectionError = class extends Error {
  name = "CharterSelectionError";
};

// src/operations/cli-coverage.ts
import { z as z26 } from "zod";
var RouteDispositionSchema = z26.discriminatedUnion("status", [
  z26.object({
    status: z26.literal("supported"),
    route: CliRouteSchema,
    operationId: OperationIdSchema
  }),
  z26.object({
    status: z26.literal("pending-migration"),
    route: CliRouteSchema,
    operationId: OperationIdSchema
  }),
  z26.object({ status: z26.literal("excluded"), route: CliRouteSchema, reason: z26.string().min(1) })
]);
var CliRouteCoveragePropsSchema = z26.object({ entries: z26.array(RouteDispositionSchema) });
var CliRouteCoverageError = class extends Error {
  name = "CliRouteCoverageError";
};
var ManifestCliRouteCoverage = class _ManifestCliRouteCoverage {
  entries;
  constructor(props) {
    this.entries = CliRouteCoveragePropsSchema.parse(props).entries;
  }
  check(program, catalog) {
    const discovered = _ManifestCliRouteCoverage.discover(program);
    const byPath = /* @__PURE__ */ new Map();
    for (const entry of this.entries) {
      const key = _ManifestCliRouteCoverage.routeKey(entry.route.path);
      if (byPath.has(key)) throw new CliRouteCoverageError(`Duplicate route disposition: ${key}`);
      byPath.set(key, entry);
    }
    const discoveredKeys = discovered.map((route) => _ManifestCliRouteCoverage.routeKey(route.path));
    const actual = new Set(discoveredKeys);
    if (actual.size !== discoveredKeys.length) {
      const duplicate = discoveredKeys.find((key, index) => discoveredKeys.indexOf(key) !== index);
      throw new CliRouteCoverageError(`Duplicate actionable CLI route: ${duplicate ?? "unknown"}`);
    }
    const missing = discovered.filter((route) => !byPath.has(_ManifestCliRouteCoverage.routeKey(route.path))).map((route) => _ManifestCliRouteCoverage.routeKey(route.path));
    const stale = this.entries.filter((entry) => !actual.has(_ManifestCliRouteCoverage.routeKey(entry.route.path))).map((entry) => _ManifestCliRouteCoverage.routeKey(entry.route.path));
    if (missing.length > 0 || stale.length > 0) {
      throw new CliRouteCoverageError(
        `CLI route coverage drift; missing: ${missing.join(", ") || "none"}; unknown: ${stale.join(", ") || "none"}`
      );
    }
    for (const route of discovered) {
      const entry = byPath.get(_ManifestCliRouteCoverage.routeKey(route.path));
      if (entry === void 0)
        throw new CliRouteCoverageError(
          `Missing disposition: ${_ManifestCliRouteCoverage.routeKey(route.path)}`
        );
      if (!_ManifestCliRouteCoverage.sameAliases(route.aliases, entry.route.aliases)) {
        throw new CliRouteCoverageError(
          `Alias coverage drift: ${_ManifestCliRouteCoverage.routeKey(route.path)}`
        );
      }
    }
    this.checkCatalog(catalog.list(), byPath);
    return discovered;
  }
  assertComplete(program, catalog) {
    this.check(program, catalog);
    const pending = this.entries.filter((entry) => entry.status === "pending-migration").map((entry) => _ManifestCliRouteCoverage.routeKey(entry.route.path));
    if (pending.length > 0)
      throw new CliRouteCoverageError(
        `Core operations remain pending migration: ${pending.join(", ")}`
      );
  }
  list() {
    return this.entries.map((entry) => structuredClone(entry));
  }
  checkCatalog(operations, dispositions) {
    const operationIds = /* @__PURE__ */ new Set();
    const operationRoutes = /* @__PURE__ */ new Set();
    for (const operation of operations) {
      if (operationIds.has(operation.id))
        throw new CliRouteCoverageError(`Duplicate executable operation id: ${operation.id}`);
      operationIds.add(operation.id);
      const key = _ManifestCliRouteCoverage.routeKey(operation.cli.path);
      if (operationRoutes.has(key))
        throw new CliRouteCoverageError(`Duplicate executable operation route: ${key}`);
      operationRoutes.add(key);
      const disposition = dispositions.get(key);
      if (disposition?.status !== "supported") {
        throw new CliRouteCoverageError(
          `Executable operation ${operation.id} has no supported CLI route: ${key}`
        );
      }
      if (disposition.operationId !== operation.id || !_ManifestCliRouteCoverage.sameAliases(operation.cli.aliases, disposition.route.aliases)) {
        throw new CliRouteCoverageError(`Executable operation mapping mismatch: ${key}`);
      }
    }
    for (const disposition of dispositions.values()) {
      if (disposition.status !== "supported") continue;
      const matchingOperations = operations.filter(
        (operation2) => operation2.id === disposition.operationId
      );
      if (matchingOperations.length !== 1) {
        throw new CliRouteCoverageError(
          `Supported CLI route ${_ManifestCliRouteCoverage.routeKey(disposition.route.path)} must map to exactly one executable operation`
        );
      }
      const operation = matchingOperations[0];
      if (operation === void 0 || _ManifestCliRouteCoverage.routeKey(operation.cli.path) !== _ManifestCliRouteCoverage.routeKey(disposition.route.path)) {
        throw new CliRouteCoverageError(
          `Supported CLI route mapping mismatch: ${_ManifestCliRouteCoverage.routeKey(disposition.route.path)}`
        );
      }
    }
  }
  static routeKey(path) {
    return path.join(" ");
  }
  static sameAliases(left, right) {
    return left.slice().sort().join("\0") === right.slice().sort().join("\0");
  }
  static discover(program) {
    const routes = [];
    const visit = (command, parentPath) => {
      const currentPath = command.name() === program.name() && parentPath.length === 0 ? parentPath : [...parentPath, command.name()];
      const actionHandler = Object.getOwnPropertyDescriptor(command, "_actionHandler")?.value;
      if (typeof actionHandler === "function") {
        const aliases = typeof command.aliases === "function" ? command.aliases() : [];
        routes.push({ path: currentPath, aliases: [...aliases] });
      }
      for (const child of command.commands) visit(child, currentPath);
    };
    visit(program, []);
    return routes;
  }
};
var pendingRoutes = [
  "board post heartbeat",
  "board post item",
  "board post activity",
  "board items",
  "packet create",
  "packet new-id",
  "packet update",
  "packet get",
  "packet reviewers"
];
var excludedRoutes = [
  {
    path: ["mcp"],
    aliases: [],
    reason: "Starts a local stdio transport whose operations are registered from the shared catalog."
  },
  {
    path: ["hook", "pre-bash"],
    aliases: ["guard-commit"],
    reason: "Consumes Claude hook payloads and governs host shell commands."
  },
  {
    path: ["hook", "board-heartbeat"],
    aliases: [],
    reason: "Consumes Claude PostToolUse payloads and runs as a host hook."
  },
  {
    path: ["hook", "agent-dispatch"],
    aliases: [],
    reason: "Consumes Claude PreToolUse agent payloads for local session tracking."
  },
  {
    path: ["hook", "agent-stop"],
    aliases: [],
    reason: "Consumes Claude SubagentStop payloads and reports host lifecycle events."
  },
  {
    path: ["agents", "status"],
    aliases: [],
    reason: "Inspects native Codex registration files on the local host."
  },
  {
    path: ["agents", "install"],
    aliases: [],
    reason: "Installs native Codex agent registrations into host-owned directories."
  },
  {
    path: ["board", "login"],
    aliases: [],
    reason: "Provisions a machine-local Ariadne credential from interactive input."
  },
  { path: ["board", "logout"], aliases: [], reason: "Removes a machine-local Ariadne credential." }
];
var cliRouteCoverage = new ManifestCliRouteCoverage({
  entries: [
    { status: "supported", route: { path: ["doc"], aliases: [] }, operationId: "doc" },
    ...[
      ["tdd create", "tdd-create"],
      ["epic create", "epic-create"],
      ["epic edit", "epic-edit"],
      ["epic link-initiative", "epic-link-initiative"],
      ["initiative create", "initiative-create"],
      ["initiative edit", "initiative-edit"],
      ["ticket create", "ticket-create"],
      ["ticket edit", "ticket-edit"],
      ["ticket get", "ticket-get"],
      ["ticket transitions", "ticket-transitions"],
      ["ticket block", "ticket-block"],
      ["ticket unblock", "ticket-unblock"],
      ["ticket status", "ticket-status"],
      ["ticket comment", "ticket-comment"],
      ["ticket label", "ticket-label"],
      ["users get", "users-get"],
      ["tdd get", "tdd-get"],
      ["epic get", "epic-get"],
      ["epic plan", "epic-plan"],
      ["epic review-plan", "epic-review-plan"],
      ["initiative get", "initiative-get"],
      ["initiative plan", "initiative-plan"],
      ["initiative review-plan", "initiative-review-plan"],
      ["charter", "charter"],
      ["competencies", "competencies"],
      ["rfc dir", "rfc-dir"],
      ["rfc next-id", "rfc-next-id"],
      ["qa instructions", "qa-instructions"],
      ["qa evidence-dir", "qa-evidence-dir"],
      ["qa recipe", "qa-recipe"],
      ["config path", "config-path"],
      ["config show", "config-show"],
      ["config set", "config-set"],
      ["config unset", "config-unset"],
      ["git commit", "git-commit"],
      ["git checkout", "git-checkout"],
      ["git push", "git-push"],
      ["commit-message", "commit-message"],
      ["branch-name", "branch-name"],
      ["check", "check"],
      ["review schema", "review-schema"],
      ["review validate", "review-validate"],
      ["review render", "review-render"],
      ["review state", "review-state"],
      ["review context", "review-context"],
      ["review plan", "review-plan"],
      ["pr create", "pr-create"],
      ["pr comment", "pr-comment"],
      ["pr list", "pr-list"],
      ["pr request-review", "pr-request-review"],
      ["board post heartbeat", "board-post-heartbeat"],
      ["board post item", "board-post-item"],
      ["board post activity", "board-post-activity"],
      ["board items", "board-items"],
      ["packet create", "packet-create"],
      ["packet new-id", "packet-new-id"],
      ["packet update", "packet-update"],
      ["packet get", "packet-get"],
      ["packet reviewers", "packet-reviewers"]
    ].map(([path, operationId]) => ({
      status: "supported",
      route: { path: (path ?? "").split(" "), aliases: [] },
      operationId: operationId ?? ""
    })),
    ...pendingRoutes.filter(
      (path) => !(/* @__PURE__ */ new Set([
        "board post heartbeat",
        "board post item",
        "board post activity",
        "board items",
        "packet create",
        "packet new-id",
        "packet update",
        "packet get",
        "packet reviewers"
      ])).has(path)
    ).map((path) => ({
      status: "pending-migration",
      route: { path: path.split(" "), aliases: [] },
      operationId: `cli-${path.replaceAll(" ", "-")}`
    })),
    ...excludedRoutes.map((route) => ({
      status: "excluded",
      route,
      reason: route.reason
    }))
  ]
});

// src/operations/tracker-entity-operations.ts
import { existsSync as existsSync6, realpathSync as realpathSync5, statSync as statSync6 } from "node:fs";
import { isAbsolute as isAbsolute5, relative as relative4, resolve as resolve7 } from "node:path";
import { z as z31 } from "zod";

// src/tasks/evidence/evidence.ts
import { realpathSync as realpathSync3 } from "node:fs";
import { basename as basename3 } from "node:path/posix";
import { z as z27 } from "zod";
var mediaReference = /(!?)\[([^\]]*)\]\(\s*<?([^\s()<>]+)>?(?:\s+"[^"]*")?\s*\)/g;
var absoluteTarget = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\/|^#/;
var localPrefix = /^(?:\.\/)+/;
var fenceRun2 = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var AttachmentSpecSchema = z27.string().min(1).transform((spec) => {
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
    const match = fenceRun2.exec(line);
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
    if (target.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(target)) {
      try {
        const realTarget = realpathSync3(target);
        return [...byName.values()].find((attachment) => {
          try {
            return realpathSync3(attachment.path) === realTarget;
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
      (text2, index) => localReferencePatterns.flatMap(
        (pattern) => [...text2.matchAll(pattern)].map((m) => ({ line: index + 1, match: m[0].replace(trailingPunctuation, "") }))
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

// src/tasks/task-tracker/task-tracker.ts
import { z as z28 } from "zod";
var TrackerUserSchema = z28.object({
  accountId: z28.string(),
  displayName: z28.string()
});
var EntityMetadataSchema = z28.object({
  tddId: z28.number().optional(),
  epicId: z28.number().optional(),
  notes: z28.string().optional(),
  /** Explicit body-format override read first by BodyFormatDetector (docs/bug-report-format.md). */
  kind: z28.enum(["bug", "story"]).optional(),
  /** Why a blocked-by edge leaves this ticket's epic, keyed by blocker id (docs/epic-boundaries.md). */
  crossEpicReasons: z28.record(z28.string(), z28.string()).optional()
}).passthrough();
var CommentSchema = z28.object({
  id: z28.string(),
  body: z28.string(),
  author: z28.string(),
  createdAt: z28.string(),
  updatedAt: z28.string()
});
var AttachmentSchema = z28.object({
  id: z28.string(),
  filename: z28.string(),
  mimeType: z28.string(),
  size: z28.number().optional(),
  mediaUuid: z28.string().optional()
});
var TechnicalDesignSchema = z28.object({
  id: z28.string(),
  epicId: z28.string(),
  url: z28.string().optional(),
  body: z28.string(),
  comments: z28.array(CommentSchema),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z28.string()
});
var TicketSchema = z28.object({
  id: z28.string(),
  size: z28.literal("ticket"),
  status: z28.string(),
  labels: z28.array(z28.string()),
  title: z28.string(),
  body: z28.string(),
  comments: z28.array(CommentSchema),
  assignee: z28.string().nullable(),
  attachments: z28.array(AttachmentSchema).default([]),
  reporter: z28.string().nullable().default(null),
  issueType: z28.string().default("unknown"),
  blockedBy: z28.array(z28.string()).default([]),
  blocking: z28.array(z28.string()).default([]),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z28.string()
});
var EpicSchema = z28.object({
  id: z28.string(),
  size: z28.literal("epic"),
  status: z28.string(),
  labels: z28.array(z28.string()),
  title: z28.string(),
  body: z28.string(),
  childIssues: z28.array(TicketSchema),
  comments: z28.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  metadata: EntityMetadataSchema.default({}),
  updatedAt: z28.string()
});
var CreateEpicInputSchema = z28.object({
  title: z28.string(),
  body: z28.string(),
  labels: z28.array(z28.string()).default([]),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTicketInputSchema = z28.object({
  title: z28.string(),
  body: z28.string(),
  /** Absent for a standalone ticket: a ticket-sized RFC has no epic to parent to. */
  epicId: z28.string().optional(),
  labels: z28.array(z28.string()).default([]),
  assignee: z28.string().optional(),
  metadata: EntityMetadataSchema.partial().optional()
});
var CreateTechnicalDesignInputSchema = z28.object({
  title: z28.string(),
  body: z28.string(),
  epicId: z28.string(),
  metadata: EntityMetadataSchema.partial().optional()
});
var UpdateEpicInputSchema = z28.object({
  body: z28.string(),
  title: z28.string().optional(),
  labels: z28.array(z28.string()).optional()
});
var UpdateTicketInputSchema = z28.object({
  body: z28.string(),
  title: z28.string().optional(),
  labels: z28.array(z28.string()).optional()
});
var UpdateInitiativeInputSchema = z28.object({
  body: z28.string(),
  title: z28.string().optional()
});
var InitiativeSchema = z28.object({
  id: z28.string(),
  size: z28.literal("initiative"),
  title: z28.string(),
  body: z28.string(),
  epics: z28.array(z28.object({ id: z28.string(), title: z28.string() })).default([])
});
var CreateInitiativeInputSchema = z28.object({
  title: z28.string(),
  body: z28.string()
});
var partialWriteErrorSchema = z28.object({
  name: z28.literal("TaskTrackerPartialWriteError"),
  id: z28.string().min(1),
  message: z28.string()
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

// src/operations/tracker-read-operations.ts
import { z as z29 } from "zod";

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
var headingLine = /^##\s+(.+?)\s*$/;
var detailsOpen = /^<details/;
var detailsClose = /^<\/details>/;
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
      const heading = line.match(headingLine);
      if (heading?.[1] !== void 0) {
        current = headingKeys[heading[1]];
        if (current !== void 0) raw[current] = [];
        i++;
        continue;
      }
      if (detailsOpen.test(line.trim())) {
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
    const text2 = (key) => {
      const joined = (raw[key] ?? []).join("\n").trim();
      return joined.length > 0 ? joined : void 0;
    };
    const sections = {
      format,
      acceptanceCriteriaItems: this.checklistItems(raw.acceptanceCriteria),
      fixedWhenItems: this.checklistItems(raw.fixedWhen)
    };
    for (const key of stringSectionKeys) {
      const value = text2(key);
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
      if (detailsOpen.test(trimmed)) {
        i = this.consumeDetails(lines, i).next;
        continue;
      }
      const heading = line.match(headingLine);
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
      if (detailsOpen.test(trimmed)) depth++;
      if (detailsClose.test(trimmed)) depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
    const block = lines.slice(start, end + 1).join("\n");
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const title = summary?.[1]?.trim() ?? "";
    const afterSummary = block.indexOf("</summary>");
    const withoutHead = afterSummary !== -1 ? block.slice(afterSummary + "</summary>".length) : block.replace(detailsOpen, "");
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
var propsSchema = z29.object({
  getTracker: z29.custom((value) => typeof value === "function"),
  getPrHost: z29.custom((value) => typeof value === "function").optional(),
  getConfig: z29.custom((value) => typeof value === "function").optional()
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
var sectionName = z29.string().refine(
  (value) => sectionNameSet.has(value),
  `unknown section \u2014 expected one of: ${sectionNames.join(", ")}`
);
var entityInput = z29.strictObject({ id: z29.string().min(1) });
var ticketInput = entityInput.extend({
  section: sectionName.optional()
});
var ticketResult = TicketSchema.passthrough();
var epicResult = EpicSchema.extend({ childIssues: z29.array(ticketResult) }).passthrough();
var initiativeResult = InitiativeSchema.extend({
  epics: z29.array(z29.object({ id: z29.string(), title: z29.string() }).passthrough())
}).passthrough();
var tddResult = TechnicalDesignSchema.passthrough();
var sectionResult = z29.object({
  id: z29.string(),
  section: z29.string(),
  format: z29.enum(["layered-body", "bug-report"]),
  markdown: z29.string().nullable(),
  items: z29.array(z29.object({ text: z29.string(), done: z29.boolean() })).optional()
});
var edgeResult = z29.object({
  ticket: z29.string(),
  ticketEpic: z29.string(),
  blockedBy: z29.string(),
  blockerEpic: z29.string().nullable(),
  justification: z29.string().nullable()
});
var planTicket = z29.object({
  id: z29.string(),
  status: z29.string(),
  blockedBy: z29.array(z29.string()),
  epicId: z29.string().optional()
});
var dependencyPlan = z29.object({
  waves: z29.array(z29.array(planTicket)),
  cycles: z29.array(z29.string())
});
var TrackerDependencyPlanSchema = dependencyPlan.extend({
  crossEpicEdges: z29.array(edgeResult),
  warnings: z29.array(z29.string())
});
var TrackerReviewPlanSchema = z29.object({
  epic: z29.object({ id: z29.string(), title: z29.string() }).optional(),
  initiative: z29.object({ id: z29.string(), title: z29.string() }).optional(),
  defaultBranch: z29.string(),
  route: z29.enum(["simple", "complex", "incomplete"]),
  reasons: z29.array(z29.string()),
  missing: z29.array(z29.string()),
  blocked: z29.array(
    z29.object({
      ticketId: z29.string(),
      title: z29.string(),
      wave: z29.number(),
      blockedBy: z29.array(z29.string()),
      pr: z29.object({
        number: z29.number(),
        url: z29.string(),
        headRefName: z29.string(),
        baseRefName: z29.string()
      }).nullable()
    })
  ),
  unblocksOnMerge: z29.array(z29.string()),
  crossEpicEdges: z29.array(edgeResult),
  warnings: z29.array(z29.string()),
  cycles: z29.array(z29.string())
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
        z29.union([ticketResult, sectionResult]),
        (input) => this.getTicket(input)
      ),
      this.descriptor(
        "ticket-transitions",
        "List available status transitions for a ticket.",
        ["read", "network"],
        ["ticket", "transitions"],
        entityInput,
        z29.object({ id: z29.string(), transitions: z29.array(z29.string()) }),
        async ({ id }) => ({ id, transitions: await this.props.getTracker().listTransitions(id) })
      ),
      this.descriptor(
        "users-get",
        "List users available for tracker assignment.",
        ["read", "network"],
        ["users", "get"],
        z29.strictObject({}),
        z29.array(TrackerUserSchema.passthrough()),
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
import { existsSync as existsSync5, realpathSync as realpathSync4, statSync as statSync5 } from "node:fs";
import { isAbsolute as isAbsolute4, relative as relative3, resolve as resolve6 } from "node:path";
import { z as z30 } from "zod";
var propsSchema2 = z30.object({
  getTracker: z30.custom((value) => typeof value === "function"),
  cwd: z30.string().min(1),
  trustedRoots: z30.array(z30.string().min(1)).default([])
});
var idSchema = z30.string().min(1);
var blockInput = z30.object({ ticketId: idSchema, blockerId: idSchema, reason: z30.string().optional() }).strict();
var ticketPairInput = z30.object({ ticketId: idSchema, blockerId: idSchema }).strict();
var statusInput = z30.object({ id: idSchema, status: z30.string().min(1) }).strict();
var commentInput = z30.object({
  id: idSchema,
  body: z30.string(),
  attach: z30.array(z30.string().min(1)).default([])
}).strict();
var labelInput = z30.object({
  id: idSchema,
  add: z30.array(z30.string()).default([]),
  remove: z30.array(z30.string()).default([])
}).strict().refine((input) => input.add.length > 0 || input.remove.length > 0, {
  message: "ticket label needs at least one --add or --remove"
});
var blockResult = z30.object({
  ticketId: idSchema,
  blockerId: idSchema,
  ticketEpic: idSchema.nullable(),
  blockerEpic: idSchema.nullable(),
  crossEpic: z30.boolean(),
  reasonRecorded: z30.boolean(),
  warnings: z30.array(z30.string())
});
var blockPartial = z30.object({
  ticketId: idSchema,
  blockerId: idSchema,
  completedSteps: z30.array(z30.string())
});
var ticketPairResult = z30.object({ ticketId: idSchema, blockerId: idSchema });
var statusResult = z30.object({ id: idSchema, status: z30.string() });
var commentPartial = z30.object({
  id: idSchema,
  attachments: z30.array(
    AttachmentSchema.extend({ path: z30.string(), caption: z30.string(), referenced: z30.boolean() })
  ),
  body: z30.string(),
  completedSteps: z30.array(z30.string())
});
var commentResult = z30.union([CommentSchema, commentPartial]);
var labelResult = z30.object({
  id: idSchema,
  added: z30.array(z30.string()),
  removed: z30.array(z30.string())
});
var labelPartial = z30.object({
  id: idSchema,
  added: z30.array(z30.string()),
  removed: z30.array(z30.string()),
  requestedAdd: z30.array(z30.string()),
  requestedRemove: z30.array(z30.string()),
  completedSteps: z30.array(z30.string())
});
var DefaultTicketLifecycleOperations = class {
  props;
  roots;
  constructor(props) {
    this.props = propsSchema2.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync4(root)))];
  }
  operations() {
    return [
      this.descriptor(
        "ticket-block",
        "Block a ticket with an epic-boundary justification when needed.",
        ["write", "network"],
        ["ticket", "block"],
        blockInput,
        z30.union([blockResult, blockPartial]),
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
        z30.union([labelPartial, labelResult]),
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
    const absolute = isAbsolute4(path) ? path : resolve6(this.props.cwd, path);
    if (!existsSync5(absolute)) throw new Error(`Attachment file does not exist: ${path}`);
    const realPath = realpathSync4(absolute);
    const stat = statSync5(realPath);
    const contained = this.roots.some((root) => {
      const fromRoot = relative3(root, realPath);
      return fromRoot === "" || !fromRoot.startsWith("..") && !isAbsolute4(fromRoot);
    });
    if (!contained || !stat.isFile())
      throw new Error(`Attachment file is outside trusted roots: ${path}`);
    return realPath;
  }
};

// src/operations/tracker-entity-operations.ts
var labelListSchema = z31.array(z31.string()).transform((labels) => [...new Set(labels.map((label) => label.trim()).filter(Boolean))]);
var labelsSchema = labelListSchema.default([]);
var createEpicInput = z31.object({
  ...CreateEpicInputSchema.shape,
  labels: labelsSchema,
  allowLocalPaths: z31.boolean().default(false)
}).strict();
var updateEpicInput = z31.object({
  ...UpdateEpicInputSchema.shape,
  labels: labelListSchema.optional(),
  allowLocalPaths: z31.boolean().default(false)
}).strict();
var createInitiativeInput = CreateInitiativeInputSchema.extend({
  allowLocalPaths: z31.boolean().default(false)
}).strict();
var updateInitiativeInput = UpdateInitiativeInputSchema.extend({
  allowLocalPaths: z31.boolean().default(false)
}).strict();
var createTicketInput = z31.object({
  ...CreateTicketInputSchema.shape,
  labels: labelsSchema,
  allowLocalPaths: z31.boolean().default(false)
}).strict();
var updateTicketInput = z31.object({
  ...UpdateTicketInputSchema.shape,
  labels: labelListSchema.optional(),
  allowLocalPaths: z31.boolean().default(false),
  attach: z31.array(z31.string().min(1)).default([])
}).strict();
var createTddInput = CreateTechnicalDesignInputSchema.extend({
  allowLocalPaths: z31.boolean().default(false)
}).strict();
var entityId = z31.string().min(1);
var linkInput = z31.object({ epicId: entityId, initiativeId: entityId }).strict();
var partialTicketEdit = z31.object({
  id: entityId,
  attachments: z31.array(AttachmentSchema),
  body: z31.string()
});
var ticketEditResult = z31.union([TicketSchema, partialTicketEdit]);
var partialTicketCreate = z31.object({ id: entityId, title: z31.string() });
var ticketCreateResult = z31.union([TicketSchema, partialTicketCreate]);
var partialEntityWrite = z31.object({
  id: entityId,
  title: z31.string().optional(),
  body: z31.string().optional()
});
var partialTddCreate = z31.object({ id: entityId, epicId: entityId, body: z31.string() });
var propsSchema3 = z31.object({
  getTracker: z31.custom((value) => typeof value === "function"),
  getPrHost: z31.custom((value) => typeof value === "function").optional(),
  getConfig: z31.custom((value) => typeof value === "function").optional(),
  cwd: z31.string().min(1),
  trustedRoots: z31.array(z31.string().min(1)).default([])
});
var DefaultTrackerEntityOperations = class {
  props;
  roots;
  constructor(props) {
    this.props = propsSchema3.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync5(root)))];
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
        z31.union([EpicSchema, partialEntityWrite]),
        (input) => this.createEpic(input)
      ),
      this.descriptor(
        "epic-edit",
        "Update an epic description, title, or labels.",
        ["write", "network"],
        ["epic", "edit"],
        z31.object({ id: entityId, ...updateEpicInput.shape }).strict(),
        z31.union([EpicSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editEpic(id, input)
      ),
      this.descriptor(
        "epic-link-initiative",
        "Link an epic to an initiative.",
        ["write", "network"],
        ["epic", "link-initiative"],
        linkInput,
        z31.object({ epicId: entityId, initiativeId: entityId }),
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
        z31.union([InitiativeSchema, partialEntityWrite]),
        (input) => this.createInitiative(input)
      ),
      this.descriptor(
        "initiative-edit",
        "Update an initiative description or title.",
        ["write", "network"],
        ["initiative", "edit"],
        z31.object({ id: entityId, ...updateInitiativeInput.shape }).strict(),
        z31.union([InitiativeSchema, partialEntityWrite]),
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
        z31.object({ id: entityId, ...updateTicketInput.shape }).strict(),
        ticketEditResult,
        ({ id, ...input }) => this.editTicket(id, input)
      ),
      this.descriptor(
        "tdd-create",
        "Create a technical design under its parent epic.",
        ["write", "network"],
        ["tdd", "create"],
        createTddInput,
        z31.union([TechnicalDesignSchema, partialTddCreate]),
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
    const absolute = isAbsolute5(path) ? path : resolve7(this.props.cwd, path);
    if (!existsSync6(absolute)) throw new Error(`Attachment file does not exist: ${path}`);
    const realPath = realpathSync5(absolute);
    const stat = statSync6(realPath);
    const contained = this.roots.some((root) => {
      const fromRoot = relative4(root, realPath);
      return fromRoot === "" || !fromRoot.startsWith("..") && !isAbsolute5(fromRoot);
    });
    if (!contained || !stat.isFile())
      throw new Error(`Attachment file is outside trusted roots: ${path}`);
    return realPath;
  }
};

// src/operations/pr-operations.ts
import { realpathSync as realpathSync6, statSync as statSync7 } from "node:fs";
import { isAbsolute as isAbsolute6, relative as relative5, resolve as resolve8 } from "node:path";
import { z as z34 } from "zod";

// src/git/pr-template/pr-template.ts
import { z as z33 } from "zod";

// src/git/semantic-types.ts
import { z as z32 } from "zod";
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
var SemanticTypeSchema = z32.enum(semanticTypes);

// src/git/pr-template/pr-template.ts
var maxChangeLineLength = 256;
var maxChangeLines = 5;
var PullRequestTemplateSchema = z33.object({
  type: z33.enum(semanticTypes),
  scope: z33.string().min(1),
  description: z33.string().min(1),
  whatWasChanged: z33.array(z33.string().min(1).max(maxChangeLineLength)).min(1).max(maxChangeLines),
  whyWasItChanged: z33.string().min(1),
  otsMaterials: z33.string().min(1).optional(),
  ticketId: z33.string().min(1).optional(),
  ticketUrl: z33.url().optional(),
  baseBranch: z33.string().min(1),
  headBranch: z33.string().min(1),
  reviewers: z33.array(z33.string()).default([]),
  labels: z33.array(z33.string()).default([])
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

// src/operations/pr-operations.ts
var propsSchema4 = z34.strictObject({
  cwd: z34.string().min(1),
  getHost: z34.custom((value) => typeof value === "function")
});
var createInput = z34.strictObject({
  type: SemanticTypeSchema,
  scope: z34.string().min(1),
  description: z34.string().min(1),
  why: z34.string().min(1),
  what: z34.array(z34.string().min(1).max(256)).min(1).max(5),
  ots: z34.string().min(1).optional(),
  base: z34.string().min(1),
  head: z34.string().min(1),
  ticketId: z34.string().min(1).optional(),
  ticketUrl: z34.url().optional(),
  reviewer: z34.array(z34.string()).default([]),
  label: z34.array(z34.string()).default([]),
  attach: z34.array(z34.string()).default([])
});
var commentInput2 = z34.strictObject({
  number: z34.number().int().positive(),
  body: z34.string(),
  attach: z34.array(z34.string()).default([])
});
var listInput = z34.strictObject({ ticket: z34.array(z34.string().min(1)).min(1) });
var reviewInput = z34.strictObject({
  number: z34.number().int().positive(),
  reviewer: z34.array(z34.string().min(1)).min(1)
});
var createdSchema = z34.object({ number: z34.number().int().positive(), url: z34.string().url() });
var commentResultSchema = z34.object({ url: z34.string() });
var openPullRequestSchema = z34.object({
  ticket: z34.string(),
  number: z34.number(),
  url: z34.string(),
  headRefName: z34.string(),
  baseRefName: z34.string(),
  title: z34.string()
});
var reviewerResultSchema = z34.object({
  number: z34.number().int().positive(),
  requested: z34.array(z34.string()),
  failed: z34.array(z34.object({ login: z34.string(), error: z34.string() }))
});
var PullRequestAttachmentPathError = class extends Error {
  name = "PullRequestAttachmentPathError";
};
var DefaultPrOperations = class {
  cwd;
  launchRoot;
  launchDevice;
  launchInode;
  getHost;
  constructor(props) {
    const parsed = propsSchema4.parse(props);
    this.cwd = resolve8(parsed.cwd);
    this.launchRoot = realpathSync6(this.cwd);
    const launchStat = statSync7(this.launchRoot);
    this.launchDevice = launchStat.dev;
    this.launchInode = launchStat.ino;
    this.getHost = parsed.getHost;
  }
  operations() {
    const effects = ["write", "network", "process"];
    return [
      this.descriptor("pr-create", "Create a pull request from the validated PR template.", ["write", "network", "process"], ["pr", "create"], createInput, createdSchema, async (input) => {
        const template = PullRequestTemplateSchema.parse({
          type: input.type,
          scope: input.scope,
          description: input.description,
          whyWasItChanged: input.why,
          whatWasChanged: input.what,
          baseBranch: input.base,
          headBranch: input.head,
          ...input.ots === void 0 ? {} : { otsMaterials: input.ots },
          ...input.ticketId === void 0 ? {} : { ticketId: input.ticketId },
          ...input.ticketUrl === void 0 ? {} : { ticketUrl: input.ticketUrl },
          reviewers: input.reviewer,
          labels: input.label
        });
        this.validateAttachments(input.attach);
        return this.getHost().createPullRequest(template, { attach: input.attach });
      }),
      this.descriptor("pr-comment", "Post a comment on a pull request.", effects, ["pr", "comment"], commentInput2, commentResultSchema, (input) => {
        this.validateAttachments(input.attach);
        return this.getHost().commentOnPullRequest(input.number, input.body, { attach: input.attach });
      }),
      this.descriptor("pr-list", "List open pull requests matched to ticket identifiers.", ["read", "network", "process"], ["pr", "list"], listInput, z34.array(openPullRequestSchema), (input) => this.getHost().listOpenPullRequestsForTickets(input.ticket)),
      this.descriptor("pr-request-review", "Request reviewers for a pull request and preserve each outcome.", effects, ["pr", "request-review"], reviewInput, reviewerResultSchema, async (input) => {
        const result = await this.getHost().requestReviewers(input.number, input.reviewer);
        if (result.failed.length > 0) {
          return {
            status: "partial",
            data: result,
            error: {
              name: "ReviewerRequestPartialFailure",
              message: `reviewer request failed for: ${result.failed.map(({ login }) => login).join(", ")}`
            }
          };
        }
        return result;
      })
    ];
  }
  descriptor(id, description, effects, path, inputSchema, outputSchema, handler) {
    return { id, description, effects, cli: { path, aliases: [] }, inputSchema, outputSchema, handler };
  }
  validateAttachments(specs) {
    this.requireOriginalLaunchDirectory();
    for (const spec of specs) {
      const split = spec.indexOf("#");
      const pathname = split < 0 ? spec : spec.slice(0, split);
      if (pathname.length === 0 || split >= 0 && spec.slice(split + 1).length === 0) {
        throw new PullRequestAttachmentPathError(`Invalid attachment spec: ${spec}`);
      }
      const candidate = isAbsolute6(pathname) ? pathname : resolve8(this.cwd, pathname);
      let canonical;
      try {
        canonical = realpathSync6(candidate);
        if (!statSync7(canonical).isFile()) throw new Error("not a file");
      } catch {
        throw new PullRequestAttachmentPathError(`Attachment is not a readable file: ${pathname}`);
      }
      const fromRoot = relative5(this.launchRoot, canonical);
      if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute6(fromRoot)) {
        throw new PullRequestAttachmentPathError(`Attachment must be inside the launch checkout: ${pathname}`);
      }
    }
  }
  requireOriginalLaunchDirectory() {
    try {
      const directory = statSync7(this.cwd);
      if (realpathSync6(this.cwd) !== this.launchRoot || directory.dev !== this.launchDevice || directory.ino !== this.launchInode) {
        throw new Error("replaced");
      }
    } catch {
      throw new PullRequestAttachmentPathError(
        `The launch checkout was moved or replaced: ${this.cwd}`
      );
    }
  }
};

// src/operations/ariadne-operations.ts
import { z as z36 } from "zod";

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
  trim(text2) {
    return text2.slice(0, maxSlugLength).replace(/^-+|-+$/g, "");
  }
  suffix() {
    return randomBytes(4).toString("hex");
  }
};
var packetIdGenerator = new RandomPacketIdGenerator();

// src/shared/ariadne/review-packet.schema.ts
import { z as z35 } from "zod";
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
var textSchema = (max) => z35.string().min(1, "must not be blank").max(max, `must be at most ${max} characters`);
var oneLineTextSchema = (max) => textSchema(max).refine((value) => !/[\r\n]/.test(value), "must be one line");
var PositiveIntSchema = z35.number().int().positive();
var PacketIdSchema = AgentRecordIdSchema;
var OperationIdSchema2 = z35.string().regex(/^[A-Za-z0-9_-]{16,80}$/, "must be 16\u201380 letters, digits, underscores or hyphens");
var HeadShaSchema = z35.string().regex(/^[0-9a-f]{40}$/, "must be a 40-character lowercase hex commit sha");
var GithubLoginSchema = z35.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "must be a GitHub login");
var PacketAnchorSchema = z35.strictObject({
  path: textSchema(packetLimits.path),
  line: PositiveIntSchema,
  startLine: optionalSchema(PositiveIntSchema),
  side: z35.enum(anchorSides)
}).refine((anchor) => anchor.startLine === void 0 || anchor.startLine < anchor.line, {
  path: ["startLine"],
  message: "must be before line"
});
var SignOffTimeSchema = z35.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/, "must be an ISO 8601 UTC time ending in Z").refine((value) => {
  const [year = 0, month = 0, day = 0] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "must be a real calendar date");
var FocusAreaSchema = z35.strictObject({
  id: AgentRecordIdSchema,
  kind: z35.enum(focusAreaKinds),
  title: oneLineTextSchema(packetLimits.title),
  rationale: textSchema(packetLimits.rationale),
  anchors: z35.array(PacketAnchorSchema).max(packetLimits.anchors, `up to ${packetLimits.anchors} anchors`)
});
var PacketPrSchema = z35.strictObject({
  repo: z35.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/, "must be owner/name"),
  number: PositiveIntSchema,
  headSha: HeadShaSchema,
  title: oneLineTextSchema(packetLimits.title),
  ticket: optionalSchema(oneLineTextSchema(packetLimits.ticket)),
  signOff: z35.strictObject({ at: SignOffTimeSchema, headSha: HeadShaSchema }).nullable().optional(),
  focusAreas: z35.array(FocusAreaSchema).max(packetLimits.focusAreas, `up to ${packetLimits.focusAreas} focus areas per PR`)
});
var PacketInputSchema = z35.strictObject({
  id: PacketIdSchema,
  title: oneLineTextSchema(packetLimits.title),
  overview: z35.strictObject({
    objective: textSchema(packetLimits.objective),
    highlights: z35.array(oneLineTextSchema(packetLimits.highlight)).min(1, "at least 1 highlight").max(packetLimits.highlights, `up to ${packetLimits.highlights} highlights`)
  }),
  prs: z35.array(PacketPrSchema).min(1, "at least 1 PR").max(packetLimits.prs, `up to ${packetLimits.prs} PRs`),
  reviewers: z35.array(GithubLoginSchema).min(1, "at least 1 reviewer").max(packetLimits.reviewers, `up to ${packetLimits.reviewers} reviewers`)
});
var PacketUpdateSchema = z35.strictObject({
  expectedRevision: z35.number().int().nonnegative(),
  operationId: OperationIdSchema2,
  packet: PacketInputSchema.omit({ id: true })
});
var GithubSnapshotSchema = z35.looseObject({ id: z35.union([z35.string(), z35.number()]), login: z35.string() });
var PacketSchema = z35.looseObject({
  id: z35.string(),
  authorId: z35.string(),
  title: z35.string(),
  overview: z35.looseObject({ objective: z35.string(), highlights: z35.array(z35.string()) }),
  prs: z35.array(z35.looseObject({ repo: z35.string(), number: z35.number() })),
  reviewers: z35.array(z35.looseObject({ id: z35.string(), github: GithubSnapshotSchema })),
  status: z35.enum(["open", "closed"]),
  revision: z35.number().int(),
  createdAt: z35.string(),
  updatedAt: z35.string()
});
var ReviewerSchema = z35.looseObject({ id: z35.string(), name: z35.string(), github: GithubSnapshotSchema });
var PacketResponseSchema = z35.looseObject({ packet: PacketSchema }).transform((response) => response.packet);
var ReviewerListResponseSchema = z35.looseObject({ reviewers: z35.array(ReviewerSchema) });

// src/operations/ariadne-operations.ts
var BoardResultSchema = (value) => z36.discriminatedUnion("status", [
  z36.object({
    status: z36.literal("skipped"),
    reason: z36.enum([
      "disabled",
      "no-token",
      "invalid-url",
      "not-jira-ticket",
      "nothing-recorded"
    ]),
    notices: z36.array(z36.string()).optional()
  }),
  z36.object({
    status: z36.literal("failed"),
    message: z36.string(),
    notices: z36.array(z36.string()).optional()
  }),
  z36.object({ status: z36.literal("ok"), value, notices: z36.array(z36.string()).optional() })
]);
var packetInput = z36.unknown();
var packetIdInput = z36.strictObject({ title: z36.string() });
var packetUpdateInput = z36.strictObject({
  id: z36.string().min(1),
  packet: z36.unknown(),
  expectedRevision: z36.number().int().nonnegative()
});
var packetOutput = PacketSchema;
var reviewersOutput = ReviewerListResponseSchema;
var AriadneOperationsPropsSchema = z36.object({
  getBoard: z36.custom((value) => typeof value === "function"),
  getPackets: z36.custom((value) => typeof value === "function")
});
var inputSchemas = {
  heartbeat: z36.object({
    input: HeartbeatInputSchema.omit({ session: true }).extend({
      session: z36.string().optional(),
      ticket: z36.string().optional(),
      step: z36.string(),
      repo: z36.string().optional(),
      branch: z36.string().optional(),
      skill: z36.string().optional(),
      detail: z36.string().optional()
    }),
    options: z36.object({ strict: z36.boolean().optional(), skill: z36.string().optional() }).optional()
  }),
  item: z36.object({
    input: ItemInputSchema.omit({ session: true }).extend({
      session: z36.string().optional(),
      ticket: z36.string().optional(),
      title: z36.string(),
      detail: z36.string().optional(),
      options: z36.array(z36.string()).optional(),
      id: z36.string().optional()
    }),
    options: z36.object({ strict: z36.boolean().optional(), skill: z36.string().optional() }).optional()
  }),
  activity: z36.object({
    input: ActivityInputSchema.omit({ session: true }).extend({
      session: z36.string().optional(),
      ticket: z36.string().optional(),
      text: z36.string(),
      id: z36.string().optional()
    }),
    options: z36.object({ strict: z36.boolean().optional(), skill: z36.string().optional() }).optional()
  }),
  items: z36.strictObject({
    session: z36.string().optional(),
    ticket: z36.string().optional(),
    strict: z36.boolean().optional()
  })
};
var DefaultAriadneOperations = class {
  props;
  constructor(props) {
    this.props = AriadneOperationsPropsSchema.parse(props);
  }
  operations() {
    return [
      this.descriptor(
        "board-post-heartbeat",
        "Report a run heartbeat to Ariadne.",
        ["write", "network"],
        ["board", "post", "heartbeat"],
        inputSchemas.heartbeat,
        BoardResultSchema(HeartbeatResponseSchema),
        ({ input, options }) => this.mapBoard(this.props.getBoard().heartbeat(input, this.boardOptions(options)))
      ),
      this.descriptor(
        "board-post-item",
        "Post a question or request to an Ariadne run.",
        ["write", "network"],
        ["board", "post", "item"],
        inputSchemas.item,
        BoardResultSchema(ItemResponseSchema),
        ({ input, options }) => this.mapBoard(
          this.props.getBoard().item(input, {
            ...this.boardOptions(options),
            bootstrapMissingSession: false
          })
        )
      ),
      this.descriptor(
        "board-post-activity",
        "Add activity to an Ariadne run.",
        ["write", "network"],
        ["board", "post", "activity"],
        inputSchemas.activity,
        BoardResultSchema(ActivityResponseSchema),
        ({ input, options }) => this.mapBoard(
          this.props.getBoard().activity(input, {
            ...this.boardOptions(options),
            bootstrapMissingSession: false
          })
        )
      ),
      this.descriptor(
        "board-items",
        "List items for an Ariadne run.",
        ["read", "network"],
        ["board", "items"],
        inputSchemas.items,
        BoardResultSchema(ItemListResponseSchema),
        ({ session, ticket, strict }) => this.mapBoard(
          this.props.getBoard().items(session, strict === void 0 ? {} : { strict }, ticket)
        )
      ),
      this.descriptor(
        "packet-create",
        "Publish a validated Ariadne review packet.",
        ["write", "network"],
        ["packet", "create"],
        z36.strictObject({ packet: packetInput }),
        packetOutput,
        ({ packet }) => this.props.getPackets().create(packet)
      ),
      this.descriptor(
        "packet-new-id",
        "Generate a reusable Ariadne review packet id.",
        [],
        ["packet", "new-id"],
        packetIdInput,
        z36.object({ id: z36.string() }),
        ({ title }) => ({ id: packetIdGenerator.generate(title) })
      ),
      this.descriptor(
        "packet-update",
        "Replace a review packet at its expected revision.",
        ["write", "network"],
        ["packet", "update"],
        packetUpdateInput,
        packetOutput,
        ({ id, packet, expectedRevision }) => this.props.getPackets().update(id, { packet, expectedRevision })
      ),
      this.descriptor(
        "packet-get",
        "Read an Ariadne review packet and its revision.",
        ["read", "network"],
        ["packet", "get"],
        z36.object({ id: z36.string().min(1) }),
        packetOutput,
        ({ id }) => this.props.getPackets().get(id)
      ),
      this.descriptor(
        "packet-reviewers",
        "List Ariadne members who can review packets.",
        ["read", "network"],
        ["packet", "reviewers"],
        z36.strictObject({}),
        reviewersOutput,
        () => this.props.getPackets().reviewers()
      )
    ];
  }
  boardOptions(options) {
    return {
      ...options?.strict === void 0 ? {} : { strict: options.strict },
      ...options?.skill === void 0 ? {} : { skill: options.skill }
    };
  }
  async mapBoard(outcome) {
    const result = await outcome;
    if (result.status === "posted") return { ...result, status: "ok" };
    return result;
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

// src/operations/git-config-operations.ts
import { existsSync as existsSync7, lstatSync, realpathSync as realpathSync7 } from "node:fs";
import { dirname as dirname6, isAbsolute as isAbsolute7, join as join7, parse, relative as relative6, resolve as resolve9, sep as sep4 } from "node:path";
import { z as z38 } from "zod";

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

// src/git/commit-message-builder/commit-message-builder.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { dirname as dirname5, join as join6 } from "node:path";

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
  strip(text2) {
    const stripped = text2.replace(closingBlock, "").replace(attributionLine, "");
    if (stripped === text2) return text2;
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
import { z as z37 } from "zod";
var CommitMessageInputSchema = z37.object({
  type: SemanticTypeSchema,
  // Bare issue numbers make one-character scopes legitimate; 32 clears a 10-character tracker key plus a six-digit number.
  scope: z37.string().min(1).max(32),
  description: z37.string().min(2).max(50),
  body: z37.string().optional(),
  model: z37.string().max(72).optional(),
  footers: z37.array(z37.string().regex(/^[a-zA-Z0-9-]+(: |=).*$/)).default([])
});
var CommitMessageHeaderSchema = z37.preprocess(
  (arg) => {
    return z37.string({ error: "Git Commit headers should be 72 characters or less" }).max(72).parse(arg);
  },
  z37.templateLiteral([SemanticTypeSchema, "(", z37.string(), "): ", z37.string()])
);
var CommitMessageBuilderPropsSchema = z37.object({
  binPath: z37.string().min(1),
  agentEnv: z37.string().optional()
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
      const pkgPath = join6(dirname5(binPath), "..", "package.json");
      const parsed = JSON.parse(readFileSync6(pkgPath, "utf-8"));
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
var ConfigScopeSchema = z38.enum(configScopes);
var ConfigSetInputSchema = z38.object({
  key: z38.string().min(1),
  values: z38.array(z38.string()).min(1),
  scope: ConfigScopeSchema.optional()
}).strict();
var ConfigUnsetInputSchema = z38.object({ key: z38.string().min(1), scope: ConfigScopeSchema.optional() }).strict();
var GitCommitInputSchema = CommitMessageInputSchema.extend({
  files: z38.array(z38.string()).default([])
}).strict();
var GitCheckoutInputSchema = z38.object({
  type: z38.string().min(1),
  scope: z38.string().min(1),
  description: z38.string().optional(),
  from: z38.string().optional()
}).strict();
var GitPushInputSchema = z38.object({ remote: z38.string().min(1).default("origin"), setUpstream: z38.boolean().default(true) }).strict();
var CommitMessageOutputSchema = z38.object({ message: z38.string() });
var BranchNameInputSchema = z38.object({ type: z38.string().min(1), scope: z38.string().min(1), description: z38.string().optional() }).strict();
var ConfigOperationPolicySchema = z38.object({
  scopes: z38.array(ConfigScopeSchema).default(["project", "local"]),
  roots: z38.array(z38.string().min(1)).default([])
}).strict();
var GitConfigOperationsPropsSchema = z38.object({
  cwd: z38.string().min(1),
  configStore: z38.custom((value) => typeof value === "object" && value !== null),
  git: z38.custom((value) => typeof value === "object" && value !== null),
  configPolicy: ConfigOperationPolicySchema.default({ scopes: ["project", "local"], roots: [] }),
  binPath: z38.string().default(process.argv[1] ?? ""),
  agentEnv: z38.string().optional()
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
    this.allowedRoots = [...new Set(roots.map((root) => realpathSync7(root)))];
  }
  operations() {
    return [
      this.descriptor(
        "config-set",
        "Set a value in an allowed configuration scope.",
        ["write", "process"],
        ["config", "set"],
        ConfigSetInputSchema,
        z38.object({
          key: z38.string(),
          scope: ConfigScopeSchema,
          path: z38.string(),
          warning: z38.string().optional()
        }),
        (input) => this.setConfig(input)
      ),
      this.descriptor(
        "config-unset",
        "Remove a value from an allowed configuration scope.",
        ["write", "process"],
        ["config", "unset"],
        ConfigUnsetInputSchema,
        z38.object({ key: z38.string(), scope: ConfigScopeSchema, path: z38.string() }),
        (input) => this.unsetConfig(input)
      ),
      this.descriptor(
        "git-commit",
        "Create a conventional commit in the launch checkout.",
        ["write", "process"],
        ["git", "commit"],
        GitCommitInputSchema,
        z38.object({ sha: z38.string(), message: z38.string() }),
        (input) => this.commit(input)
      ),
      this.descriptor(
        "git-checkout",
        "Start a conventional branch in the launch checkout.",
        ["write", "process"],
        ["git", "checkout"],
        GitCheckoutInputSchema,
        z38.object({
          branch: z38.string(),
          from: z38.string().nullable(),
          renamedFrom: z38.string().nullable()
        }),
        (input) => this.checkout(input)
      ),
      this.descriptor(
        "git-push",
        "Push the current branch from the launch checkout.",
        ["write", "network", "process"],
        ["git", "push"],
        GitPushInputSchema,
        z38.object({ branch: z38.string(), remote: z38.string(), setUpstream: z38.boolean() }),
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
        z38.object({ branch: z38.string() }),
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
    const absolutePath = isAbsolute7(path) ? path : resolve9(this.props.cwd, path);
    this.rejectDanglingSymlinks(absolutePath);
    let existingPath = existsSync7(absolutePath) ? absolutePath : dirname6(absolutePath);
    while (!existsSync7(existingPath)) {
      const parent = dirname6(existingPath);
      if (parent === existingPath)
        throw new LaunchConfigOperationDeniedError(
          `Configuration path has no existing parent: ${path}`
        );
      existingPath = parent;
    }
    const resolvedExistingPath = realpathSync7(existingPath);
    const target = existsSync7(absolutePath) ? resolvedExistingPath : resolve9(resolvedExistingPath, relative6(existingPath, absolutePath));
    if (!this.allowedRoots.some((root) => {
      const rel = relative6(root, target);
      return rel === "" || !rel.startsWith("..") && !isAbsolute7(rel);
    }))
      throw new LaunchConfigOperationDeniedError(
        `Configuration path escapes launch roots: ${path}`
      );
    return path;
  }
  rejectDanglingSymlinks(path) {
    const root = parse(path).root;
    let current = root;
    for (const part of path.slice(root.length).split(sep4).filter(Boolean)) {
      current = join7(current, part);
      try {
        if (!lstatSync(current).isSymbolicLink()) continue;
      } catch {
        break;
      }
      try {
        realpathSync7(current);
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

// src/operations/review-operations.ts
import { z as z46 } from "zod";

// src/code-review/review-policy.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync7, realpathSync as realpathSync8 } from "node:fs";
import { dirname as dirname7, join as join8, relative as relative7 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { z as z41 } from "zod";

// src/bundled-docs/charter-catalog/charter-catalog.ts
import { matchesGlob } from "node:path";
import { parse as parseYaml3 } from "yaml";
import { z as z39 } from "zod";
var coreCharterId = "coding-charter";
var languageCharterPrefix = `${coreCharterId}-`;
var LanguageFrontmatterSchema = z39.strictObject({
  language: z39.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  "applies-to": z39.array(z39.string().min(1)).min(1)
}).transform(({ language, "applies-to": appliesTo }) => ({ language, appliesTo }));
var FrontmatterSchema = z39.string().transform((contents, ctx) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(contents)?.[1];
  if (block === void 0) {
    ctx.addIssue({ code: "custom", message: "missing YAML frontmatter" });
    return z39.NEVER;
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
      throw new CharterFormatError(`Charter "${doc.id}" has invalid frontmatter: ${z39.prettifyError(parsed.error)}`);
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

// src/code-review/review.schema.ts
import { z as z40 } from "zod";
var reviewContractVersion = 1;
var reviewSchemaRevision = 1;
var ReviewOutcomeSchema = z40.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]);
var FindingIdSchema = z40.string().regex(/^f-[a-f0-9]{10}$/);
var HeadShaSchema2 = z40.string().regex(/^[a-f0-9]{40}$/);
var ReviewPathSchema = z40.string().max(400).regex(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\p{Cc}]*$/u);
var TextSchema = z40.string().min(1).max(16e3);
var LineTextSchema = z40.string().min(1).max(400).regex(/^[^\r\n]+$/);
var PositiveIdSchema = z40.number().int().positive().max(Number.MAX_SAFE_INTEGER);
var HttpsUrlSchema = z40.url().regex(/^https:\/\//);
var CategorySchema = z40.enum([
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
var ActionLabelSchema = z40.enum([
  "issue",
  "todo",
  "suggestion",
  "question",
  "chore",
  "nitpick",
  "typo",
  "polish"
]);
var InformationLabelSchema = z40.enum(["praise", "note", "thought"]);
var SeveritySchema = z40.enum(["critical", "major", "minor", "trivial"]);
var DecisionOptionsSchema = z40.array(
  z40.strictObject({ id: z40.string().regex(/^[a-z][a-z0-9-]{0,79}$/), description: TextSchema })
).min(2);
var findingFields = {
  path: ReviewPathSchema,
  line: z40.number().int().nonnegative(),
  start_line: z40.number().int().positive().optional(),
  category: CategorySchema.optional(),
  subject: LineTextSchema,
  discussion: TextSchema,
  related_finding_id: FindingIdSchema.optional()
};
var actionFields = {
  ...findingFields,
  label: ActionLabelSchema,
  type: z40.enum(["fix", "clarify"]),
  blocking: z40.boolean(),
  severity: SeveritySchema,
  details: TextSchema,
  resolved_when: TextSchema
};
var decisionFields = {
  ...actionFields,
  type: z40.literal("decide"),
  decision_owner: LineTextSchema,
  decision_options: DecisionOptionsSchema
};
var informationFields = {
  ...findingFields,
  label: InformationLabelSchema,
  blocking: z40.literal(false),
  details: TextSchema.optional()
};
var NewFindingSchema = z40.union([
  z40.strictObject(actionFields),
  z40.strictObject(decisionFields),
  z40.strictObject(informationFields)
]);
var ActionableFindingSchema = z40.union([
  z40.strictObject({ ...actionFields, id: FindingIdSchema }),
  z40.strictObject({ ...decisionFields, id: FindingIdSchema })
]);
var StoredFindingSchema = z40.union([
  ...ActionableFindingSchema.options,
  z40.strictObject({ ...informationFields, id: FindingIdSchema })
]);
var ReviewEvidenceSchema = z40.discriminatedUnion("kind", [
  z40.strictObject({
    kind: z40.literal("github_comment"),
    comment_id: PositiveIdSchema,
    url: HttpsUrlSchema
  }),
  z40.strictObject({
    kind: z40.literal("code"),
    commit_sha: HeadShaSchema2,
    path: ReviewPathSchema.min(1),
    line: z40.number().int().positive()
  }),
  z40.strictObject({ kind: z40.literal("commit"), sha: HeadShaSchema2 }),
  z40.strictObject({
    kind: z40.literal("check_run"),
    check_run_id: PositiveIdSchema,
    commit_sha: HeadShaSchema2
  }),
  z40.strictObject({ kind: z40.literal("document"), url: HttpsUrlSchema }),
  z40.strictObject({
    kind: z40.literal("verification"),
    commit_sha: HeadShaSchema2,
    command: TextSchema,
    result: z40.literal("passed"),
    report_url: HttpsUrlSchema
  }),
  z40.strictObject({
    kind: z40.literal("thread_resolution"),
    thread_id: z40.string().min(1),
    author_id: PositiveIdSchema
  })
]);
var DecisionAnswerSchema = z40.strictObject({
  comment_id: PositiveIdSchema,
  author_id: PositiveIdSchema,
  option_id: z40.string().min(1)
});
var transitionFields = {
  id: FindingIdSchema,
  reason: TextSchema,
  reply: TextSchema.optional(),
  decision: DecisionAnswerSchema.optional()
};
var PriorFindingSchema = z40.union([
  z40.strictObject({
    ...transitionFields,
    status: z40.literal("resolved"),
    evidence: z40.array(ReviewEvidenceSchema).min(1)
  }),
  z40.strictObject({
    ...transitionFields,
    status: z40.literal("withdrawn"),
    evidence: z40.array(ReviewEvidenceSchema).min(1),
    withdrawal_basis: z40.enum(["incorrect", "no_longer_applicable", "dismissed"])
  }),
  z40.strictObject({
    ...transitionFields,
    status: z40.literal("still_open"),
    evidence: z40.array(ReviewEvidenceSchema).optional(),
    updated_finding: ActionableFindingSchema.optional()
  })
]);
var reviewFields = {
  contract_version: z40.literal(reviewContractVersion),
  schema_revision: z40.literal(reviewSchemaRevision),
  head_sha: HeadShaSchema2,
  review_complete: z40.boolean(),
  incomplete_reason: z40.string().max(16e3).optional(),
  summary: TextSchema,
  outcome: ReviewOutcomeSchema,
  outcome_reason: TextSchema,
  remaining_risk: TextSchema,
  extensions: z40.record(z40.string(), z40.json()).optional()
};
var ReviewSchema = z40.strictObject({
  ...reviewFields,
  findings: z40.array(NewFindingSchema),
  prior_findings: z40.array(PriorFindingSchema)
});
var FindingRecordSchema = z40.strictObject({
  v: z40.literal(reviewContractVersion),
  schema_revision: z40.literal(reviewSchemaRevision),
  finding: ActionableFindingSchema,
  status: z40.enum(["open", "resolved", "withdrawn"]),
  evidence: z40.array(ReviewEvidenceSchema),
  decision: DecisionAnswerSchema.optional()
});
var ReviewStateSchema = z40.strictObject({
  v: z40.literal(reviewContractVersion),
  schema_revision: z40.literal(reviewSchemaRevision),
  sha: HeadShaSchema2,
  outcome: ReviewOutcomeSchema,
  records: z40.array(
    z40.union([
      z40.strictObject({
        id: FindingIdSchema,
        status: z40.enum(["open", "resolved", "withdrawn"]),
        location: z40.union([
          z40.strictObject({ kind: z40.literal("review_comment"), comment_id: PositiveIdSchema }),
          z40.strictObject({ kind: z40.literal("review_body"), review_id: PositiveIdSchema })
        ])
      }),
      z40.strictObject({
        id: FindingIdSchema,
        status: z40.literal("informational"),
        fingerprint: z40.string().min(1),
        finding: z40.strictObject({ ...informationFields, id: FindingIdSchema }).optional()
      })
    ])
  )
});
var TransportReviewSchema = z40.strictObject({
  ...reviewFields,
  findings: z40.array(
    z40.strictObject({
      ...actionFields,
      type: z40.enum(["fix", "clarify", "decide"]).optional(),
      label: z40.enum([...ActionLabelSchema.options, ...InformationLabelSchema.options]),
      severity: SeveritySchema.optional(),
      details: TextSchema.optional(),
      resolved_when: TextSchema.optional(),
      decision_owner: LineTextSchema.optional(),
      decision_options: DecisionOptionsSchema.optional()
    })
  ),
  prior_findings: z40.array(
    z40.strictObject({
      ...transitionFields,
      status: z40.enum(["resolved", "still_open", "withdrawn"]),
      evidence: z40.array(ReviewEvidenceSchema).optional(),
      withdrawal_basis: z40.enum(["incorrect", "no_longer_applicable", "dismissed"]).optional(),
      updated_finding: StoredFindingSchema.optional()
    })
  )
});

// src/code-review/review-policy.ts
var ReviewPolicyPropsSchema = z41.strictObject({
  home: z41.string().min(1).optional(),
  env: z41.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional()
});
var LoadPolicyPropsSchema = z41.strictObject({ paths: z41.array(z41.string()).optional() });
var RepositoryContextPropsSchema = z41.strictObject({
  cwd: z41.string().min(1),
  trustedRef: HeadShaSchema2,
  contextPath: ReviewPathSchema.min(1).default("CODE-REVIEW.md")
});
var FileReviewPolicy = class {
  home;
  env;
  constructor(props = {}) {
    const parsed = ReviewPolicyPropsSchema.parse(props);
    this.home = parsed.home ?? join8(dirname7(fileURLToPath3(import.meta.url)), "..");
    this.env = props.env ?? process.env;
  }
  load(input = {}) {
    const { paths } = LoadPolicyPropsSchema.parse(input);
    const docs = realpathSync8(join8(this.home, "docs"));
    const read = (id) => {
      const path = realpathSync8(join8(docs, `${id}.md`));
      if (relative7(docs, path).startsWith(".."))
        throw new ReviewPolicyError("review policy path leaves the installed docs directory");
      return readFileSync7(path, "utf8");
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
import { z as z42 } from "zod";
var GhReviewGitHubApiPropsSchema = z42.strictObject({
  cwd: z42.string().min(1).optional(),
  env: z42.custom(
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
var GitHubReviewVerifierPropsSchema = z42.strictObject({
  repo: z42.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  prNumber: z42.number().int().positive(),
  prAuthorId: z42.number().int().positive(),
  owners: z42.record(z42.string(), z42.array(z42.string().min(1))).default({}),
  requireMapping: z42.boolean().default(false)
});
var UserSchema = z42.looseObject({ id: z42.number(), login: z42.string(), type: z42.string() });
var CommentSchema2 = z42.looseObject({
  id: z42.number(),
  user: UserSchema,
  issue_url: z42.string().optional(),
  pull_request_url: z42.string().optional(),
  body: z42.string()
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
      const check = z42.looseObject({
        head_sha: z42.string(),
        status: z42.string(),
        conclusion: z42.string().nullable()
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
    const permission = z42.looseObject({ permission: z42.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/collaborators/${encodeURIComponent(comment.user.login)}/permission`
      )
    );
    return ["write", "maintain", "admin"].includes(permission.permission);
  }
  async dismissal(evidence) {
    if (evidence.kind !== "thread_resolution" || evidence.author_id === this.props.prAuthorId)
      return false;
    const result = z42.looseObject({
      data: z42.looseObject({
        node: z42.looseObject({
          isResolved: z42.boolean(),
          resolvedBy: z42.looseObject({ databaseId: z42.number(), actorType: z42.string() }).nullable(),
          pullRequest: z42.looseObject({
            number: z42.number(),
            repository: z42.looseObject({ nameWithOwner: z42.string() })
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
    const comparison = z42.looseObject({ status: z42.string() }).parse(await this.api.get(`/repos/${this.props.repo}/compare/${sha}...${headSha}`));
    return ["ahead", "identical"].includes(comparison.status);
  }
  /** True when `ref` has `path` as a file with at least `line` lines. */
  async hasLine(path, line, ref) {
    const file = z42.looseObject({ type: z42.string(), encoding: z42.string(), content: z42.string() }).parse(
      await this.api.get(
        `/repos/${this.props.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`
      )
    );
    if (file.type !== "file" || file.encoding !== "base64") return false;
    const text2 = Buffer.from(file.content, "base64").toString("utf8");
    const lines = text2 === "" ? 0 : text2.split("\n").length - (text2.endsWith("\n") ? 1 : 0);
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
import { randomBytes as randomBytes2 } from "node:crypto";
import { z as z44 } from "zod";

// src/code-review/review-contract.ts
import { z as z43 } from "zod";
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
      full: z43.toJSONSchema(ReviewSchema, { target: "draft-07" }),
      transport: z43.toJSONSchema(TransportReviewSchema, { target: "draft-07" })
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
var EvidenceReviewPlanner = class {
  verifier;
  constructor(props) {
    this.verifier = props.verifier;
  }
  async plan(input) {
    const headSha = HeadShaSchema2.parse(input.headSha);
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
    let id = `f-${randomBytes2(5).toString("hex")}`;
    while (ids.has(id)) id = `f-${randomBytes2(5).toString("hex")}`;
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
var ValidatedEvidencePropsSchema = z44.strictObject({
  verified: z44.array(z44.string()),
  authorizedDecisions: z44.array(z44.string()),
  dismissals: z44.array(z44.string())
});

// src/code-review/review-codec.ts
import { createHash } from "node:crypto";
import { z as z45 } from "zod";
var MarkerInputSchema = z45.strictObject({
  body: z45.string(),
  authorId: z45.number().int().positive(),
  trustedAuthorIds: z45.array(z45.number().int().positive())
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

// src/operations/review-operations.ts
var ReviewOperationsLaunchPropsSchema = z46.strictObject({
  cwd: z46.string().min(1).optional(),
  trustedRef: HeadShaSchema2.optional(),
  owners: z46.record(z46.string(), z46.array(z46.string().min(1))).default({}),
  requireMapping: z46.boolean().default(false)
});
var ReviewOperationsPropsSchema = ReviewOperationsLaunchPropsSchema.extend({
  cwd: z46.string().min(1),
  env: z46.custom(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value)
  ).optional(),
  policy: z46.custom(
    (value) => typeof value === "object" && value !== null && "repository" in value && "load" in value
  ).optional(),
  api: z46.custom(
    (value) => typeof value === "object" && value !== null && "get" in value && "graphql" in value
  ).optional()
});
var JsonValueSchema = z46.json();
var schemaInput = z46.strictObject({ transport: z46.boolean().default(false) });
var reviewInput2 = z46.strictObject({ review: JsonValueSchema });
var reviewOutput = ReviewSchema;
var stateInput = z46.strictObject({ state: JsonValueSchema });
var stateOutput = z46.string();
var contextInput = z46.strictObject({
  contextPath: z46.string().min(1).default("CODE-REVIEW.md")
});
var contextOutput = z46.object({
  trustedRef: HeadShaSchema2,
  contextPath: z46.string(),
  sources: z46.array(z46.object({ path: z46.string(), contents: z46.string() })),
  missing: z46.array(z46.string())
});
var planInput = z46.strictObject({
  number: z46.number().int().positive(),
  repo: z46.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  review: JsonValueSchema,
  records: z46.array(JsonValueSchema)
});
var renderInput = z46.strictObject({
  review: JsonValueSchema,
  records: z46.array(FindingRecordSchema),
  outcome: z46.string(),
  problems: z46.array(z46.string())
});
var renderOutput = z46.object({
  headSha: z46.string(),
  outcome: z46.string(),
  problems: z46.array(z46.string()),
  findings: z46.array(
    z46.object({
      id: z46.string(),
      status: z46.string(),
      path: z46.string(),
      line: z46.number(),
      body: z46.string()
    })
  )
});
var planOutput = z46.object({
  review: ReviewSchema,
  records: z46.array(FindingRecordSchema),
  informational: z46.array(StoredFindingSchema),
  outcome: z46.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]),
  problems: z46.array(z46.string())
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
        reviewInput2,
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
          const pullRequest = z46.looseObject({
            head: z46.looseObject({ sha: HeadShaSchema2 }),
            user: z46.looseObject({ id: z46.number().int().positive() })
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
export {
  BlankQaRecipeError,
  CallerContextSchema,
  CharterSelectionError,
  CliRouteCoverageError,
  CliRouteSchema,
  CommanderLocalDiscoveryCli,
  DefaultAriadneOperations,
  DefaultGitConfigOperations,
  DefaultLocalDiscoveryOperations,
  DefaultPrOperations,
  DefaultReviewOperations,
  DefaultTicketLifecycleOperations,
  DefaultTrackerEntityOperations,
  DefaultTrackerReadOperations,
  DispatchOutcomeSchema,
  DispatchRequestSchema,
  DocOperation,
  DocOperationInputSchema,
  DocOperationOutputSchema,
  DuplicateOperationIdError,
  FileInstructionCatalog,
  ImplementationReportSchema,
  InstructionsUnavailableError,
  InvalidWorkerReportError,
  LaunchOperationAccessPolicy,
  ManifestCliRouteCoverage,
  MapOperationRegistry,
  OperationAccessDeniedError,
  OperationCliError,
  OperationEffectSchema,
  OperationEnvelopeSchema,
  OperationErrorSchema,
  OperationIdSchema,
  OperationInputError,
  OperationOutputError,
  QaInstructionsNotFoundError,
  QuestionRequestSchema,
  ReadinessOptionsSchema,
  ReportModeSchema,
  RunContextSchema,
  RuntimeSnapshotSchema,
  SiblingSkillRequestSchema,
  UnknownInstructionError,
  UnknownOperationError,
  UnsafeInstructionPathError,
  VerificationReportSchema,
  VerifiedImplementationLoop,
  WorkerReportCodec,
  WorkflowEvidenceSchema,
  WorkflowSchema,
  cliRouteCoverage,
  instructionCatalog,
  workerReportCodec
};
