// src/sdk/instruction-catalog.ts
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

// src/sdk/instruction-catalog.ts
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
  constructor(props) {
    super(props.message);
    this.operationId = props.operationId;
    this.operationErrorName = props.errorName;
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

// src/operations/cli-coverage.ts
import { z as z11 } from "zod";
var RouteDispositionSchema = z11.discriminatedUnion("status", [
  z11.object({
    status: z11.literal("supported"),
    route: CliRouteSchema,
    operationId: OperationIdSchema
  }),
  z11.object({
    status: z11.literal("pending-migration"),
    route: CliRouteSchema,
    operationId: OperationIdSchema
  }),
  z11.object({ status: z11.literal("excluded"), route: CliRouteSchema, reason: z11.string().min(1) })
]);
var CliRouteCoveragePropsSchema = z11.object({ entries: z11.array(RouteDispositionSchema) });
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
  "charter",
  "competencies",
  "rfc dir",
  "rfc next-id",
  "qa instructions",
  "qa evidence-dir",
  "qa recipe",
  "config path",
  "config show",
  "config set",
  "config unset",
  "check",
  "ticket get",
  "ticket transitions",
  "users get",
  "tdd get",
  "tdd create",
  "epic get",
  "epic create",
  "epic edit",
  "epic plan",
  "epic review-plan",
  "epic link-initiative",
  "initiative get",
  "initiative create",
  "initiative edit",
  "initiative plan",
  "initiative review-plan",
  "ticket create",
  "ticket edit",
  "ticket block",
  "ticket unblock",
  "ticket status",
  "ticket comment",
  "ticket label",
  "git commit",
  "git checkout",
  "git push",
  "commit-message",
  "branch-name",
  "pr create",
  "pr comment",
  "pr list",
  "pr request-review",
  "review schema",
  "review validate",
  "review render",
  "review state",
  "review context",
  "review plan",
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
export {
  CallerContextSchema,
  CliRouteCoverageError,
  CliRouteSchema,
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
  QuestionRequestSchema,
  ReportModeSchema,
  RunContextSchema,
  RuntimeSnapshotSchema,
  SiblingSkillRequestSchema,
  UnknownInstructionError,
  UnknownOperationError,
  UnsafeInstructionPathError,
  VerificationReportSchema,
  WorkerReportCodec,
  cliRouteCoverage,
  instructionCatalog,
  workerReportCodec
};
