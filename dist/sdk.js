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
import { z as z9 } from "zod";
var DocIdSchema = z9.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var FileDocResolverPropsSchema = z9.object({ docsDir: z9.string().min(1) });
var InstallDocsPropsSchema = z9.object({
  moduleUrl: z9.url().refine((value) => value.startsWith("file:")),
  env: z9.record(z9.string(), z9.string().optional())
});
var DocNotFoundPropsSchema = z9.object({ id: z9.string(), available: z9.array(z9.string()) });

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
import { readdirSync as readdirSync3 } from "node:fs";
import { resolve as resolve4 } from "node:path";
import { z as z15 } from "zod";

// src/shared/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join3, resolve as resolve2 } from "node:path";
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
function getQaRecipePath(config, configPath) {
  const recipe = config.qaRecipe ?? "flight-rules.qa.md";
  if (isAbsolute3(recipe)) return recipe;
  return resolve2(dirname2(configPath), recipe);
}

// src/tasks/qa-instructions/qa-instructions.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { dirname as dirname3, join as join4, resolve as resolve3 } from "node:path";
var atxHeading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
var fenceRun = /^ {0,3}(`{3,}|~{3,})/;
var legacyHint = 'Legacy QA recipe in use. Move its content into a QA.md at the repo root (or a "QA" section of AGENTS.md); see docs/qa-instructions.md.';
var nodeFileSystem = {
  isFile: (path) => existsSync3(path) && statSync3(path).isFile(),
  exists: (path) => existsSync3(path),
  readFile: (path) => readFileSync4(path, "utf8")
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
    const absolute = resolve3(from);
    const start = this.fs.isFile(absolute) ? dirname3(absolute) : absolute;
    const levels = [];
    let current = start;
    for (; ; ) {
      levels.push(current);
      if (this.fs.exists(join4(current, ".git"))) return levels;
      const parent = dirname3(current);
      if (parent === current) return [start];
      current = parent;
    }
  }
  sourceAt(dir) {
    const agentsMd = join4(dir, "AGENTS.md");
    if (this.fs.isFile(agentsMd)) {
      const section = this.extractQaSection(this.fs.readFile(agentsMd));
      if (section !== void 0)
        return { path: agentsMd, kind: "agents-md-section", dir, content: section };
    }
    return this.fileSource(join4(dir, "QA.md"), "qa-md", dir) ?? this.fileSource(join4(dir, ".agents", "QA.md"), "agents-dir-qa-md", dir);
  }
  fileSource(path, kind, dir) {
    if (!this.fs.isFile(path)) return void 0;
    const content = this.fs.readFile(path).trim();
    return content.length > 0 ? { path, kind, dir, content } : void 0;
  }
  legacySource(path) {
    if (path === void 0) return void 0;
    const source = this.fileSource(path, "legacy-recipe", dirname3(path));
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
      files = readdirSync3(directory);
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
      from: input.from === void 0 ? this.props.cwd : resolve4(this.props.cwd, input.from),
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
import { readFileSync as readFileSync5 } from "node:fs";
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
var RuntimeFailureReportSchema = z25.object({
  tracker: z25.null(),
  repo: z25.null(),
  checks: z25.array(
    z25.object({
      name: z25.string(),
      ok: z25.boolean(),
      required: z25.boolean(),
      code: z25.string(),
      detail: z25.string(),
      remedy: z25.string()
    })
  ),
  ok: z25.literal(false),
  scope: z25.literal("workflow")
});
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
    ).option(
      "--runtime-file <path>",
      "JSON containing current caller/worker capability observations; requires --workflow"
    ).exitOverride().action(async (options) => {
      let evidence;
      try {
        evidence = options.runtimeFile === void 0 ? void 0 : JSON.parse(readFileSync5(options.runtimeFile, "utf8"));
      } catch {
        this.writeRuntimeFailure(
          "Cannot read a JSON runtime evidence file",
          "Supply a readable evidence file; see flight-rules doc workflow-preflight."
        );
        throw new ReadinessFailedError("flight-rules check failed \u2014 see report above");
      }
      const parsed = ReadinessOptionsSchema.safeParse({ workflow: options.workflow, evidence });
      if (!parsed.success) {
        this.writeRuntimeFailure(
          "Invalid workflow runtime evidence",
          "Supply evidence matching WorkflowEvidenceSchema with a --workflow selection."
        );
        throw new ReadinessFailedError("flight-rules check failed \u2014 see report above");
      }
      const report = await this.invoke("check", parsed.data, ReadinessResultSchema);
      process.stdout.write(`${JSON.stringify(report)}
`);
      if (!report.ok)
        throw new ReadinessFailedError("flight-rules check failed \u2014 see report above");
    });
  }
  writeRuntimeFailure(detail, remedy) {
    const report = RuntimeFailureReportSchema.parse({
      tracker: null,
      repo: null,
      checks: [
        { name: "runtime", ok: false, required: true, code: "INVALID_CONTEXT", detail, remedy }
      ],
      ok: false,
      scope: "workflow"
    });
    process.stdout.write(`${JSON.stringify(report)}
`);
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
  "ticket block",
  "ticket unblock",
  "ticket status",
  "ticket comment",
  "ticket label",
  "pr create",
  "pr comment",
  "pr list",
  "pr request-review",
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
      ["review plan", "review-plan"]
    ].map(([path, operationId]) => ({
      status: "supported",
      route: { path: (path ?? "").split(" "), aliases: [] },
      operationId: operationId ?? ""
    })),
    ...pendingRoutes.map((path) => ({
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
import { existsSync as existsSync4, realpathSync as realpathSync3, statSync as statSync4 } from "node:fs";
import { isAbsolute as isAbsolute4, relative as relative3, resolve as resolve5 } from "node:path";
import { z as z30 } from "zod";

// src/tasks/evidence/evidence.ts
import { realpathSync as realpathSync2 } from "node:fs";
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
        const realTarget = realpathSync2(target);
        return [...byName.values()].find((attachment) => {
          try {
            return realpathSync2(attachment.path) === realTarget;
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

// src/operations/tracker-entity-operations.ts
var labelListSchema = z30.array(z30.string()).transform((labels) => [...new Set(labels.map((label) => label.trim()).filter(Boolean))]);
var labelsSchema = labelListSchema.default([]);
var createEpicInput = z30.object({
  ...CreateEpicInputSchema.shape,
  labels: labelsSchema,
  allowLocalPaths: z30.boolean().default(false)
}).strict();
var updateEpicInput = z30.object({
  ...UpdateEpicInputSchema.shape,
  labels: labelListSchema.optional(),
  allowLocalPaths: z30.boolean().default(false)
}).strict();
var createInitiativeInput = CreateInitiativeInputSchema.extend({
  allowLocalPaths: z30.boolean().default(false)
}).strict();
var updateInitiativeInput = UpdateInitiativeInputSchema.extend({
  allowLocalPaths: z30.boolean().default(false)
}).strict();
var createTicketInput = z30.object({
  ...CreateTicketInputSchema.shape,
  labels: labelsSchema,
  allowLocalPaths: z30.boolean().default(false)
}).strict();
var updateTicketInput = z30.object({
  ...UpdateTicketInputSchema.shape,
  labels: labelListSchema.optional(),
  allowLocalPaths: z30.boolean().default(false),
  attach: z30.array(z30.string().min(1)).default([])
}).strict();
var createTddInput = CreateTechnicalDesignInputSchema.extend({
  allowLocalPaths: z30.boolean().default(false)
}).strict();
var entityId = z30.string().min(1);
var linkInput = z30.object({ epicId: entityId, initiativeId: entityId }).strict();
var partialTicketEdit = z30.object({
  id: entityId,
  attachments: z30.array(AttachmentSchema),
  body: z30.string()
});
var ticketEditResult = z30.union([TicketSchema, partialTicketEdit]);
var partialTicketCreate = z30.object({ id: entityId, title: z30.string() });
var ticketCreateResult = z30.union([TicketSchema, partialTicketCreate]);
var partialEntityWrite = z30.object({
  id: entityId,
  title: z30.string().optional(),
  body: z30.string().optional()
});
var partialTddCreate = z30.object({ id: entityId, epicId: entityId, body: z30.string() });
var propsSchema2 = z30.object({
  getTracker: z30.custom((value) => typeof value === "function"),
  getPrHost: z30.custom((value) => typeof value === "function").optional(),
  getConfig: z30.custom((value) => typeof value === "function").optional(),
  cwd: z30.string().min(1),
  trustedRoots: z30.array(z30.string().min(1)).default([])
});
var DefaultTrackerEntityOperations = class {
  props;
  roots;
  constructor(props) {
    this.props = propsSchema2.parse(props);
    const roots = this.props.trustedRoots.length === 0 ? [this.props.cwd] : this.props.trustedRoots;
    this.roots = [...new Set(roots.map((root) => realpathSync3(root)))];
  }
  operations() {
    return [
      ...new DefaultTrackerReadOperations({
        getTracker: this.props.getTracker,
        ...this.props.getPrHost === void 0 ? {} : { getPrHost: this.props.getPrHost },
        ...this.props.getConfig === void 0 ? {} : { getConfig: this.props.getConfig }
      }).operations(),
      this.descriptor(
        "epic-create",
        "Create an epic with portable context and labels.",
        ["write", "network"],
        ["epic", "create"],
        createEpicInput,
        z30.union([EpicSchema, partialEntityWrite]),
        (input) => this.createEpic(input)
      ),
      this.descriptor(
        "epic-edit",
        "Update an epic description, title, or labels.",
        ["write", "network"],
        ["epic", "edit"],
        z30.object({ id: entityId, ...updateEpicInput.shape }).strict(),
        z30.union([EpicSchema, partialEntityWrite]),
        ({ id, ...input }) => this.editEpic(id, input)
      ),
      this.descriptor(
        "epic-link-initiative",
        "Link an epic to an initiative.",
        ["write", "network"],
        ["epic", "link-initiative"],
        linkInput,
        z30.object({ epicId: entityId, initiativeId: entityId }),
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
        z30.union([InitiativeSchema, partialEntityWrite]),
        (input) => this.createInitiative(input)
      ),
      this.descriptor(
        "initiative-edit",
        "Update an initiative description or title.",
        ["write", "network"],
        ["initiative", "edit"],
        z30.object({ id: entityId, ...updateInitiativeInput.shape }).strict(),
        z30.union([InitiativeSchema, partialEntityWrite]),
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
        z30.object({ id: entityId, ...updateTicketInput.shape }).strict(),
        ticketEditResult,
        ({ id, ...input }) => this.editTicket(id, input)
      ),
      this.descriptor(
        "tdd-create",
        "Create a technical design under its parent epic.",
        ["write", "network"],
        ["tdd", "create"],
        createTddInput,
        z30.union([TechnicalDesignSchema, partialTddCreate]),
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
    const absolute = isAbsolute4(path) ? path : resolve5(this.props.cwd, path);
    if (!existsSync4(absolute)) throw new Error(`Attachment file does not exist: ${path}`);
    const realPath = realpathSync3(absolute);
    const stat = statSync4(realPath);
    const contained = this.roots.some((root) => {
      const fromRoot = relative3(root, realPath);
      return fromRoot === "" || !fromRoot.startsWith("..") && !isAbsolute4(fromRoot);
    });
    if (!contained || !stat.isFile())
      throw new Error(`Attachment file is outside trusted roots: ${path}`);
    return realPath;
  }
};
export {
  BlankQaRecipeError,
  CallerContextSchema,
  CharterSelectionError,
  CliRouteCoverageError,
  CliRouteSchema,
  CommanderLocalDiscoveryCli,
  DefaultLocalDiscoveryOperations,
  DefaultTrackerEntityOperations,
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
  WorkerReportCodec,
  WorkflowEvidenceSchema,
  WorkflowSchema,
  cliRouteCoverage,
  instructionCatalog,
  workerReportCodec
};
