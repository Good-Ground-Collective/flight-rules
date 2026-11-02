// src/sdk/claude-agent/claude-agent-runtime.ts
import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
import { z as z14 } from "zod";

// src/agents/agent-emitter/agent-emitter.schema.ts
import { z as z2 } from "zod";

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

// src/agents/agent-emitter/agent-emitter.schema.ts
var ModelBindingsSchema = z2.strictObject({
  standard: z2.string().trim().min(1),
  escalated: z2.string().trim().min(1),
  expert: z2.string().trim().min(1)
});
var AgentDefinitionSchema = z2.strictObject({
  frontmatter: AgentRegistrationSchema,
  body: z2.string().refine((body) => body.trim() !== "", "agent prompt must not be empty")
});

// src/sdk/worker-runtime-core.ts
import { z as z9 } from "zod";

// src/orchestration/dispatch-queue.ts
import { z as z5 } from "zod";

// src/orchestration/orchestration-policy.ts
import { isDeepStrictEqual } from "node:util";
import { z as z4 } from "zod";

// src/orchestration/orchestration.schema.ts
import { isAbsolute, relative, sep } from "node:path";
import { z as z3 } from "zod";
var OrchestrationTextSchema = z3.string().refine((value) => value.trim().length > 0, "must not be blank");
var AbsolutePathSchema = OrchestrationTextSchema.refine(
  isAbsolute,
  "must be an absolute path on this host"
);
var CapabilityNameSchema = z3.string().regex(/^[a-z][a-zA-Z0-9:.-]*$/);
var RunContextObjectSchema = z3.strictObject({
  runId: OrchestrationTextSchema,
  taskId: OrchestrationTextSchema,
  cwd: AbsolutePathSchema,
  repositoryRoot: AbsolutePathSchema,
  baseRef: OrchestrationTextSchema,
  skill: OrchestrationTextSchema
});
var RunContextSchema = RunContextObjectSchema.refine((value) => {
  const path = relative(value.repositoryRoot, value.cwd);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}, "working directory must be inside the active repository root");
var CallerContextSchema = RunContextSchema.safeExtend({ attempt: z3.int().positive() });
var CapabilityEvidenceSchema = z3.discriminatedUnion("state", [
  z3.strictObject({ state: z3.literal("available"), evidence: OrchestrationTextSchema }),
  z3.strictObject({
    state: z3.enum(["denied", "unknown"]),
    evidence: OrchestrationTextSchema,
    remedy: OrchestrationTextSchema
  })
]);
var AdapterLimitsSchema = z3.strictObject({
  maxConcurrent: z3.int().nonnegative().nullable(),
  activeWorkers: z3.int().nonnegative(),
  currentDepth: z3.int().nonnegative(),
  maxDepth: z3.int().nonnegative().nullable(),
  source: OrchestrationTextSchema
});
var RuntimeSnapshotSchema = z3.strictObject({
  context: CallerContextSchema,
  host: z3.strictObject({ name: OrchestrationTextSchema, version: OrchestrationTextSchema }),
  observedAt: z3.iso.datetime(),
  agent: AgentFrontmatterSchema.shape.name.nullable(),
  spawn: CapabilityEvidenceSchema,
  ask: CapabilityEvidenceSchema,
  permissions: z3.record(CapabilityNameSchema, CapabilityEvidenceSchema),
  limits: AdapterLimitsSchema
});
var DispatchRequestSchema = z3.strictObject({
  id: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema,
  input: z3.record(z3.string(), z3.json()),
  requiredCapabilities: z3.array(CapabilityNameSchema).optional()
});
var OrchestrationFailureSchema = z3.strictObject({
  code: z3.enum([
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
var OutcomeIdentitySchema = z3.strictObject({
  dispatchId: OrchestrationTextSchema,
  agent: AgentFrontmatterSchema.shape.name,
  context: CallerContextSchema
});
var DispatchOutcomeSchema = z3.discriminatedUnion("status", [
  OutcomeIdentitySchema.extend({
    status: z3.literal("completed"),
    report: z3.record(z3.string(), z3.json())
  }),
  OutcomeIdentitySchema.extend({
    status: z3.enum(["failed", "unavailable"]),
    failure: OrchestrationFailureSchema
  })
]);
var QuestionRequestSchema = z3.strictObject({
  context: CallerContextSchema,
  question: OrchestrationTextSchema,
  allowHumanQuestions: z3.boolean()
});
var SiblingSkillRequestSchema = z3.strictObject({
  context: CallerContextSchema,
  skill: OrchestrationTextSchema,
  input: z3.record(z3.string(), z3.json())
});

// src/orchestration/orchestration-policy.ts
var RegistryOrchestrationPolicyPropsSchema = z4.strictObject({
  agents: z4.array(AgentDefinitionSchema).min(1).refine(
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

// src/orchestration/dispatch-queue.ts
var DispatchQueuePropsSchema = z5.strictObject({
  agents: z5.array(AgentDefinitionSchema).min(1),
  requests: z5.array(DispatchRequestSchema).refine(
    (requests) => new Set(requests.map((request) => request.id)).size === requests.length,
    "dispatch IDs must be unique"
  ),
  maxConcurrent: z5.int().positive()
});
var ObservedDispatchIdsSchema = z5.array(z5.string().min(1)).refine((ids) => new Set(ids).size === ids.length, "observed dispatch IDs must be unique");
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

// src/sdk/report-codec.ts
import { z as z8 } from "zod";
import { parse as parseYaml } from "yaml";

// src/orchestration/implementation-loop.schema.ts
import { z as z6 } from "zod";
var ImplementationReportSchema = z6.strictObject({
  summary: OrchestrationTextSchema,
  filesChanged: z6.array(
    z6.strictObject({ path: OrchestrationTextSchema, why: OrchestrationTextSchema })
  ),
  testsRun: z6.array(
    z6.strictObject({ command: OrchestrationTextSchema, result: OrchestrationTextSchema })
  ),
  approach: OrchestrationTextSchema,
  openQuestions: z6.array(OrchestrationTextSchema).optional()
});
var CriterionResultSchema = z6.strictObject({
  criterion: OrchestrationTextSchema,
  verdict: z6.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
  evidence: OrchestrationTextSchema
});
var VerificationReportSchema = z6.strictObject({
  summary: OrchestrationTextSchema,
  criteria: z6.array(CriterionResultSchema).min(1),
  charterConcerns: z6.array(OrchestrationTextSchema).optional(),
  openQuestions: z6.array(OrchestrationTextSchema).optional(),
  verified: z6.boolean()
}).refine(
  (report) => report.verified === report.criteria.every((criterion) => criterion.verdict === "PASS"),
  "verified must agree with every itemized verdict"
);
var HandoffRecordSchema = z6.strictObject({
  request: DispatchRequestSchema,
  outcome: z6.unknown()
});
var ImplementationRunSchema = z6.strictObject({
  context: RunContextSchema,
  criteria: z6.array(OrchestrationTextSchema).min(1).refine((criteria) => new Set(criteria).size === criteria.length, "criteria must be distinct"),
  implementationInput: z6.record(z6.string(), z6.json()).refine(
    (input) => !Object.hasOwn(input, "verifierFailures"),
    "verifierFailures is reserved for validated retry evidence"
  ),
  history: z6.array(
    z6.strictObject({ implementation: HandoffRecordSchema, verification: HandoffRecordSchema })
  ).max(3)
});

// src/orchestration/review-triage.schema.ts
import { z as z7 } from "zod";
var FindingDispositionSchema = z7.discriminatedUnion("disposition", [
  z7.strictObject({
    id: OrchestrationTextSchema,
    disposition: z7.literal("fix"),
    evidence: OrchestrationTextSchema,
    criterion: OrchestrationTextSchema
  }),
  z7.strictObject({
    id: OrchestrationTextSchema,
    disposition: z7.literal("ignore"),
    evidence: OrchestrationTextSchema
  }),
  z7.strictObject({
    id: OrchestrationTextSchema,
    disposition: z7.literal("needs_input"),
    evidence: OrchestrationTextSchema,
    question: OrchestrationTextSchema
  })
]);
var ReviewTriageReportSchema = z7.strictObject({
  summary: OrchestrationTextSchema,
  headSha: z7.string().regex(/^[a-f0-9]{40}$/),
  findings: z7.array(FindingDispositionSchema).refine(
    (findings) => new Set(findings.map((finding) => finding.id)).size === findings.length,
    "Each finding must have exactly one disposition"
  ),
  openQuestions: z7.array(OrchestrationTextSchema).optional()
}).refine(
  (report) => report.findings.every(
    (finding) => finding.disposition !== "needs_input" || report.openQuestions?.includes(finding.question)
  ),
  "Every needs_input question must also appear in openQuestions"
);

// src/sdk/report-codec.ts
var reportText = OrchestrationTextSchema;
var JsonReportValueSchema = z8.json();
var InternalResearchSchema = z8.strictObject({
  files: z8.array(z8.strictObject({ path: reportText, why: reportText })),
  patterns: z8.array(reportText),
  integrationPoints: z8.array(reportText),
  risks: z8.array(reportText)
});
var ExternalResearchSchema = z8.strictObject({
  answer: reportText,
  sources: z8.array(z8.strictObject({ url: z8.url(), title: reportText })),
  exampleUsage: reportText.nullable(),
  caveats: z8.array(reportText)
});
var ResearchReportSchema = z8.strictObject({
  summary: reportText,
  confidence: z8.enum(["low", "med", "high"]),
  internal: InternalResearchSchema.optional(),
  external: ExternalResearchSchema.optional()
});
var EvidenceSchema = z8.strictObject({
  dir: reportText,
  items: z8.array(
    z8.strictObject({
      path: reportText,
      kind: z8.enum(["image", "video", "text"]),
      phase: z8.enum(["before", "after"]),
      caption: reportText
    })
  )
});
var QaReproduceSchema = z8.discriminatedUnion("reproduced", [
  z8.strictObject({
    summary: reportText,
    reproduced: z8.literal(true),
    needs: z8.array(reportText).optional(),
    steps: z8.array(reportText),
    after: z8.array(reportText),
    rootCause: reportText,
    trapForQA: reportText,
    fixedWhen: z8.array(reportText),
    evidence: EvidenceSchema,
    openQuestions: z8.array(reportText).optional()
  }),
  z8.strictObject({
    summary: reportText,
    reproduced: z8.literal(false),
    reason: reportText,
    needs: z8.array(reportText).optional(),
    evidence: EvidenceSchema,
    openQuestions: z8.array(reportText).optional()
  })
]);
var QaVerifySchema = z8.strictObject({
  summary: reportText,
  items: z8.array(
    z8.strictObject({
      item: reportText,
      verdict: z8.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
      evidence: reportText
    })
  ),
  evidence: EvidenceSchema,
  verified: z8.boolean(),
  needs: z8.array(reportText).optional(),
  openQuestions: z8.array(reportText).optional()
}).refine(
  (report) => report.verified === report.items.every((item) => item.verdict === "PASS"),
  "verified must agree with every item verdict"
);
var WriterFindingSchema = z8.strictObject({
  excerpt: reportText,
  location: reportText,
  mandate: reportText,
  problem: reportText,
  suggestion: reportText
});
var WriterFeedbackSchema = z8.strictObject({
  summary: reportText,
  verdict: z8.enum(["CLEAN", "MINOR", "HEAVY"]),
  findings: z8.array(WriterFindingSchema),
  strengths: z8.array(reportText),
  openQuestions: z8.array(reportText).optional()
});
var WriterChangeSchema = z8.strictObject({
  before: reportText,
  after: reportText,
  mandate: reportText,
  why: reportText
});
var WriterRewriteSchema = z8.strictObject({
  summary: reportText,
  verdict: z8.enum(["CLEAN", "MINOR", "HEAVY"]),
  changes: z8.array(WriterChangeSchema).optional(),
  rewritten: reportText.optional(),
  preserved: z8.array(reportText),
  openQuestions: z8.array(reportText).optional()
}).refine(
  (report) => report.changes === void 0 !== (report.rewritten === void 0),
  "rewrite reports must contain either file changes or inline rewritten text"
);
var WriterAuthorSchema = z8.strictObject({
  summary: reportText,
  whatWasChanged: z8.array(reportText.max(256)).min(1).max(5),
  whyWasItChanged: reportText,
  otsMaterials: reportText,
  openQuestions: z8.array(reportText).optional()
});
var ReportModeSchema = z8.union([
  z8.strictObject({ agent: z8.literal("code-implementation"), mode: z8.literal("implement") }),
  z8.strictObject({
    agent: z8.literal("code-implementation-escalated"),
    mode: z8.literal("implement")
  }),
  z8.strictObject({ agent: z8.literal("code-verifier"), mode: z8.literal("verify") }),
  z8.strictObject({ agent: z8.literal("code-verifier"), mode: z8.literal("triage") }),
  z8.strictObject({
    agent: z8.literal("research-agent"),
    mode: z8.enum(["internal", "external", "mixed"])
  }),
  z8.strictObject({ agent: z8.literal("qa-engineer"), mode: z8.literal("reproduce") }),
  z8.strictObject({ agent: z8.literal("qa-engineer"), mode: z8.literal("verify") }),
  z8.strictObject({ agent: z8.literal("qa-engineer-verify"), mode: z8.literal("verify") }),
  z8.strictObject({ agent: z8.literal("tech-writer"), mode: z8.literal("feedback") }),
  z8.strictObject({ agent: z8.literal("tech-writer"), mode: z8.literal("rewrite") }),
  z8.strictObject({ agent: z8.literal("tech-writer"), mode: z8.literal("author") })
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
    return z8.string().transform((input, context) => {
      const blocks = [...input.matchAll(/```yaml\s*\r?\n([\s\S]*?)\r?\n```/gi)];
      const block = blocks.at(0);
      const before = block === void 0 ? "" : input.slice(0, block.index);
      const after = block === void 0 ? input : input.slice(block.index + block[0].length);
      if (blocks.length !== 1 || block === void 0 || after.trim() !== "" || before.trim() !== "" && mode.agent !== "research-agent" || before.includes("```")) {
        context.addIssue({
          code: "custom",
          message: "Return one final fenced YAML report; only research reports may have prose before it"
        });
        return z8.NEVER;
      }
      return block[1] ?? "";
    }).transform((yaml, context) => {
      try {
        return parseYaml(yaml);
      } catch (cause) {
        context.addIssue({
          code: "custom",
          message: `Malformed YAML report: ${cause instanceof Error ? cause.message : String(cause)}`
        });
        return z8.NEVER;
      }
    }).pipe(JsonReportValueSchema).pipe(z8.preprocess((report) => report, this.schemaFor(mode)));
  }
  schemaFor(mode) {
    if (mode.agent === "code-implementation" || mode.agent === "code-implementation-escalated")
      return ImplementationReportSchema;
    if (mode.agent === "code-verifier")
      return mode.mode === "triage" ? ReviewTriageReportSchema : VerificationReportSchema;
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

// src/sdk/worker-runtime-core.ts
var WorkerCapabilitySchema = z9.enum(["read", "edit", "shell", "web", "spawn", "ask"]);
var CapabilityToolDeniedPropsSchema = z9.strictObject({
  toolName: z9.string().min(1),
  capability: WorkerCapabilitySchema.optional()
});
var CapabilityToolDeniedError = class extends Error {
  name = "CapabilityToolDeniedError";
  capability;
  constructor(props) {
    const parsed = CapabilityToolDeniedPropsSchema.parse(props);
    super(
      parsed.capability === void 0 ? `The worker attempted unregistered tool ${parsed.toolName}.` : `The worker attempted ${parsed.toolName} without an effective ${parsed.capability} grant.`
    );
    this.capability = parsed.capability;
  }
};
var WorkerDispatchConfigurationError = class extends Error {
  name = "WorkerDispatchConfigurationError";
};
var StandardWorkerRunProtocol = class {
  reports = new WorkerReportCodec();
  prepare(admission) {
    const { request, definition } = admission;
    const parsedMode = ReportModeSchema.safeParse({
      agent: request.agent,
      mode: request.input.mode
    });
    if (!parsedMode.success) {
      return {
        status: "rejected",
        outcome: this.failed(request, {
          code: "INVALID_REPORT",
          message: parsedMode.error.message,
          remedy: "Choose a report mode supported by the named worker registration before dispatch."
        })
      };
    }
    const mode = parsedMode.data;
    const task = [
      "## Dispatch context",
      JSON.stringify(request.context),
      "## Dispatch input",
      JSON.stringify(request.input),
      `Return the canonical final fenced YAML report for mode ${mode.mode}.`
    ].join("\n\n");
    const prompt = [definition.body.trim(), task].join("\n\n");
    return { status: "ready", mode, prompt, task };
  }
  cancelled(request) {
    return this.failed(request, this.cancellationFailure());
  }
  failed(request, failure) {
    return {
      status: "failed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      failure
    };
  }
  finish(request, finalText, mode) {
    let report;
    try {
      report = this.reports.parse(finalText, mode);
    } catch (cause) {
      return this.failed(request, {
        code: "INVALID_REPORT",
        message: cause instanceof Error ? cause.message : String(cause),
        remedy: "Obtain a final report matching the named worker mode; do not infer success from tool activity."
      });
    }
    return {
      status: "completed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      report
    };
  }
  executionFailure(cause, signal) {
    if (signal.aborted) return this.cancellationFailure();
    if (cause instanceof CapabilityToolDeniedError) {
      const capability = cause.capability;
      return {
        code: capability === void 0 ? "CAPABILITY_UNKNOWN" : "CAPABILITY_DENIED",
        capability,
        message: cause.message,
        remedy: "Refresh effective host grants and provide only tools the host can enforce."
      };
    }
    return {
      code: "EXECUTION_FAILED",
      message: cause instanceof Error ? cause.message : String(cause),
      remedy: "Inspect the provider or host tool failure, then retry only when the caller chooses."
    };
  }
  cancellationFailure() {
    return {
      code: "CANCELLED",
      message: "The caller cancelled this worker and graph execution has stopped.",
      remedy: "Start a new invocation only when the caller chooses to resume."
    };
  }
};
var workerRunProtocol = new StandardWorkerRunProtocol();
var QueuedWorkerDispatcherPropsSchema = z9.strictObject({
  agents: z9.array(AgentDefinitionSchema).min(1),
  observe: z9.custom(
    (value) => typeof value === "function"
  ),
  run: z9.custom((value) => typeof value === "function"),
  createError: z9.custom((value) => typeof value === "function")
});
var QueuedWorkerDispatcher = class {
  agents;
  observe;
  run;
  createError;
  activeExecutions = /* @__PURE__ */ new Map();
  constructor(props) {
    const parsed = QueuedWorkerDispatcherPropsSchema.parse(props);
    this.agents = parsed.agents;
    this.observe = parsed.observe;
    this.run = parsed.run;
    this.createError = parsed.createError;
  }
  async dispatch(request, options = {}) {
    const [outcome] = await this.dispatchMany([request], {
      maxConcurrent: 1,
      ...options
    });
    if (outcome === void 0)
      throw this.createError("Single dispatch completed without an outcome.");
    return outcome;
  }
  async dispatchMany(requests, options) {
    const validatedRequests = z9.array(DispatchRequestSchema).parse(requests);
    const queue = new BoundedDispatchQueue({
      agents: this.agents,
      requests: validatedRequests,
      maxConcurrent: options.maxConcurrent
    });
    const active = /* @__PURE__ */ new Map();
    const controllers = /* @__PURE__ */ new Map();
    const settledOutcomes = /* @__PURE__ */ new Map();
    let wakeCancellationWait;
    const cancellationWait = new Promise((resolve3) => {
      wakeCancellationWait = resolve3;
    });
    const cancelActive = () => {
      wakeCancellationWait();
      queue.cancel();
      for (const controller of controllers.values()) controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", cancelActive, { once: true });
    try {
      while (queue.results() === void 0) {
        if (options.signal?.aborted) cancelActive();
        const next = queue.pending();
        if (next === void 0) {
          if (active.size === 0) break;
          await Promise.race([...active.values()].map((entry) => entry.promise));
          continue;
        }
        const snapshot = RuntimeSnapshotSchema.parse(await this.observe(next));
        if (options.signal?.aborted) {
          cancelActive();
          continue;
        }
        const foreignReservations = this.activeExecutions.size - active.size;
        const refreshedSnapshot = {
          ...snapshot,
          limits: {
            ...snapshot.limits,
            activeWorkers: snapshot.limits.activeWorkers + foreignReservations
          }
        };
        if (active.size === 0 && foreignReservations > 0 && snapshot.limits.maxConcurrent !== null && refreshedSnapshot.limits.activeWorkers >= snapshot.limits.maxConcurrent) {
          await Promise.race([Promise.race(this.activeExecutions.values()), cancellationWait]);
          continue;
        }
        const admission = queue.admit(refreshedSnapshot, []);
        if (admission.status === "ready") {
          const controller = new AbortController();
          controllers.set(admission.request.id, controller);
          const reservation = Symbol(admission.request.id);
          const run = Promise.resolve().then(() => this.run(admission, snapshot, controller.signal)).then((outcome) => {
            const handoff = queue.settle(
              admission.request.id,
              outcome,
              z9.record(z9.string(), z9.json())
            );
            if (handoff.status === "accepted") {
              settledOutcomes.set(admission.request.id, outcome);
            }
          }).catch((cause) => {
            const outcome = workerRunProtocol.failed(
              admission.request,
              workerRunProtocol.executionFailure(cause, controller.signal)
            );
            const handoff = queue.settle(
              admission.request.id,
              outcome,
              z9.record(z9.string(), z9.json())
            );
            if (handoff.status === "accepted") {
              settledOutcomes.set(admission.request.id, outcome);
            }
          }).finally(() => {
            controllers.delete(admission.request.id);
            active.delete(admission.request.id);
            this.activeExecutions.delete(reservation);
          });
          active.set(admission.request.id, {
            reservation,
            promise: run
          });
          this.activeExecutions.set(reservation, run);
          continue;
        }
        if (admission.status === "unavailable") {
          settledOutcomes.set(admission.outcome.dispatchId, admission.outcome);
          continue;
        }
        if (admission.status === "complete") break;
        if (active.size === 0) {
          throw this.createError("The dispatch queue is waiting without an active graph.");
        }
        await Promise.race([...active.values()].map((entry) => entry.promise));
      }
    } finally {
      options.signal?.removeEventListener("abort", cancelActive);
    }
    const outcomes = queue.results();
    if (outcomes === void 0)
      throw this.createError("Dispatch stopped before all requests had named outcomes.");
    const orderedOutcomes = [];
    for (const outcome of outcomes) {
      if (outcome.status !== "completed") {
        orderedOutcomes.push(outcome);
        continue;
      }
      const settledOutcome = settledOutcomes.get(outcome.dispatchId);
      if (settledOutcome === void 0) {
        throw this.createError(
          `Completed dispatch ${outcome.dispatchId} lost its validated report handoff.`
        );
      }
      orderedOutcomes.push(settledOutcome);
    }
    return orderedOutcomes;
  }
};

// src/sdk/claude-agent/guarded-query-options.ts
var GuardedQueryOptions = class {
  build(props) {
    const preToolUse = props.preToolUse ?? ((input) => props.guard.preToolUse(input));
    return {
      cwd: props.cwd,
      model: props.model,
      ...props.systemPrompt === void 0 ? {} : { systemPrompt: props.systemPrompt },
      tools: [...props.builtInTools],
      disallowedTools: [...props.disallowedTools],
      ...Object.keys(props.mcpServers).length === 0 ? {} : { mcpServers: { ...props.mcpServers } },
      strictMcpConfig: true,
      settingSources: [],
      plugins: [],
      permissionMode: "default",
      hooks: { PreToolUse: [{ hooks: [(input) => preToolUse(input)] }] },
      canUseTool: (toolName, input) => props.guard.canUseTool(toolName, input),
      maxTurns: props.maxTurns,
      abortController: props.controller,
      persistSession: props.persistSession,
      ...props.resume === void 0 ? {} : { resume: props.resume }
    };
  }
};
var guardedQueryOptions = new GuardedQueryOptions();

// src/sdk/claude-agent/model-tiers.ts
import { readFileSync } from "node:fs";
import { join as join2 } from "node:path";
import { z as z12 } from "zod";

// src/sdk/instruction-catalog-core.ts
import { basename, dirname, isAbsolute as isAbsolute2, join, relative as relative2, resolve, sep as sep2 } from "node:path";
import { fileURLToPath } from "node:url";
import { z as z11 } from "zod";

// src/agents/agent-registry/agent-registry.ts
import { z as z10 } from "zod";

// src/agents/agent-frontmatter/agent-frontmatter.ts
import { parse as parseYaml2 } from "yaml";
var MissingFrontmatterError = class extends Error {
  name = "MissingFrontmatterError";
};
var YamlAgentFrontmatterParser = class {
  parse(markdown) {
    const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(markdown);
    if (match === null || match.index !== 0 || match[1] === void 0) {
      throw new MissingFrontmatterError("agent file has no leading --- frontmatter block");
    }
    const raw = parseYaml2(match[1]);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new MissingFrontmatterError("frontmatter is not a YAML mapping");
    }
    return AgentFrontmatterSchema.parse(raw);
  }
};
var agentFrontmatterParser = new YamlAgentFrontmatterParser();

// src/agents/agent-registry/agent-registry.ts
var AgentNameSchema = AgentFrontmatterSchema.shape.name;
var AgentVariantSchema = z10.strictObject({
  name: AgentNameSchema,
  extends: AgentNameSchema,
  description: AgentFrontmatterSchema.shape.description,
  model: ModelTierSchema,
  modelReason: z10.string().trim().min(1).optional()
});
var AgentVariantsSchema = z10.array(AgentVariantSchema);

// src/sdk/instruction-catalog-core.ts
var CatalogPropsSchema = z11.strictObject({
  moduleUrl: z11.string().min(1),
  env: z11.record(z11.string(), z11.string().optional())
});
var ResourceNameSchema = z11.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var ModulePackageHomeLocator = class {
  locate(props) {
    const parsed = CatalogPropsSchema.parse({ ...props, env: { ...props.env } });
    const override = parsed.env["FLIGHT_RULES_HOME"]?.trim();
    if (override) return override;
    const moduleDirectory = dirname(fileURLToPath(parsed.moduleUrl));
    if (basename(moduleDirectory) === "sdk") return resolve(moduleDirectory, "../..");
    const bindingParent = dirname(moduleDirectory);
    if (basename(bindingParent) === "sdk" && basename(dirname(bindingParent)) === "src") {
      return resolve(moduleDirectory, "../../..");
    }
    return resolve(moduleDirectory, "..");
  }
};
var packageHomeLocator = new ModulePackageHomeLocator();

// src/sdk/claude-agent/model-tiers.ts
var ModelTiersFileSchema = z12.string().transform((text) => JSON.parse(text)).pipe(ModelBindingsSchema);
var FileModelTierCatalogPropsSchema = z12.strictObject({
  moduleUrl: z12.string().min(1),
  env: z12.record(z12.string(), z12.string().optional())
});
var ModelTiersUnavailableError = class extends Error {
  name = "ModelTiersUnavailableError";
};
var FileModelTierCatalog = class {
  path;
  constructor(props) {
    const parsed = FileModelTierCatalogPropsSchema.parse({ ...props, env: { ...props.env } });
    this.path = join2(packageHomeLocator.locate(parsed), "adapters", "claude", "model-tiers.json");
  }
  load() {
    try {
      return ModelTiersFileSchema.parse(readFileSync(this.path, "utf8"));
    } catch (cause) {
      throw new ModelTiersUnavailableError(
        `The Claude model tier table at ${this.path} could not be loaded.`,
        { cause }
      );
    }
  }
};
var claudeModelTiers = new FileModelTierCatalog({
  moduleUrl: import.meta.url,
  env: process.env
});

// src/sdk/claude-agent/tool-policy.ts
import { existsSync, realpathSync } from "node:fs";
import { basename as basename2, dirname as dirname2, isAbsolute as isAbsolute3, join as join3, relative as relative3, resolve as resolve2, sep as sep3 } from "node:path";
import {
  createSdkMcpServer,
  tool
} from "@anthropic-ai/claude-agent-sdk";
import { z as z13 } from "zod";

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

// src/sdk/claude-agent/tool-policy.ts
var flightRulesHostServerName = "flight-rules-host";
var hostToolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
var disallowedBuiltInTools = ["Agent", "AskUserQuestion", "Skill", "ToolSearch"];
var unmappedBuiltInCapabilities = /* @__PURE__ */ new Map([
  ["Agent", "spawn"],
  ["Task", "spawn"],
  ["AskUserQuestion", "ask"]
]);
var pathInputKeys = ["file_path", "path", "notebook_path"];
var globInputKeys = /* @__PURE__ */ new Map([
  ["Glob", "pattern"],
  ["Grep", "glob"]
]);
var globMagic = /[*?[{]/;
var HostToolSchema = z13.object({
  name: z13.string().regex(hostToolNamePattern),
  description: z13.string().min(1),
  inputSchema: z13.record(
    z13.string(),
    z13.custom((value) => value instanceof z13.core.$ZodType)
  ),
  annotations: z13.strictObject({
    title: z13.string().optional(),
    readOnlyHint: z13.boolean().optional(),
    destructiveHint: z13.boolean().optional(),
    idempotentHint: z13.boolean().optional(),
    openWorldHint: z13.boolean().optional()
  }).optional(),
  handler: z13.custom((value) => typeof value === "function")
});
var WorkerToolGrantsSchema = z13.partialRecord(
  WorkerCapabilitySchema,
  z13.array(HostToolSchema)
);
var InvalidClaudeHostToolError = class extends WorkerDispatchConfigurationError {
  name = "InvalidClaudeHostToolError";
};
var RepositoryPathDeniedError = class extends CapabilityToolDeniedError {
  name = "RepositoryPathDeniedError";
  constructor(props) {
    super(
      props.capability === void 0 ? { toolName: props.toolName } : { toolName: props.toolName, capability: props.capability }
    );
    this.message = `The worker attempted ${props.toolName} on ${props.path}, outside the repository root ${props.repositoryRoot}.`;
  }
};
var HostToolExecutionTracker = class {
  pending = /* @__PURE__ */ new Set();
  firstFailure;
  track(execution) {
    const promise = execution();
    this.pending.add(promise);
    const forget = () => {
      this.pending.delete(promise);
    };
    promise.then(forget, forget);
    return promise;
  }
  recordFailure(cause) {
    this.firstFailure ??= { cause };
  }
  failure() {
    return this.firstFailure;
  }
  async waitForIdle() {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
};
var ClaudeToolGuardPropsSchema = z13.strictObject({
  allowedTools: z13.array(z13.string().min(1)),
  capabilities: z13.custom((value) => value instanceof Map),
  cwd: z13.string().min(1),
  repositoryRoot: z13.string().min(1),
  onDenied: z13.custom(
    (value) => typeof value === "function"
  )
});
var RepositoryConfinedToolGuard = class {
  allowedTools;
  capabilities;
  cwd;
  repositoryRoot;
  realRepositoryRoot;
  onDenied;
  constructor(props) {
    const parsed = ClaudeToolGuardPropsSchema.parse(props);
    this.allowedTools = new Set(parsed.allowedTools);
    this.capabilities = parsed.capabilities;
    this.cwd = parsed.cwd;
    this.repositoryRoot = parsed.repositoryRoot;
    this.realRepositoryRoot = this.realPath(resolve2(parsed.repositoryRoot));
    this.onDenied = parsed.onDenied;
  }
  async preToolUse(input) {
    if (input.hook_event_name !== "PreToolUse") return {};
    const denial = this.evaluate(input.tool_name, this.inputRecord(input.tool_input));
    if (denial === void 0) return {};
    this.onDenied(denial);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denial.message
      }
    };
  }
  async canUseTool(toolName, input) {
    const denial = this.evaluate(toolName, input);
    if (denial === void 0) return { behavior: "allow", updatedInput: input };
    this.onDenied(denial);
    return { behavior: "deny", message: denial.message, interrupt: true };
  }
  evaluate(toolName, input) {
    const capability = this.capabilities.get(toolName);
    if (!this.allowedTools.has(toolName)) {
      return new CapabilityToolDeniedError(
        capability === void 0 ? { toolName } : { toolName, capability }
      );
    }
    if (toolName.startsWith("mcp__")) return void 0;
    const escaped = this.escapingPath(toolName, input);
    if (escaped === void 0) return void 0;
    return new RepositoryPathDeniedError({
      toolName,
      capability,
      path: escaped,
      repositoryRoot: this.repositoryRoot
    });
  }
  inputRecord(value) {
    const parsed = z13.record(z13.string(), z13.unknown()).safeParse(value);
    return parsed.success ? parsed.data : {};
  }
  escapingPath(toolName, input) {
    for (const key of pathInputKeys) {
      const value = input[key];
      if (typeof value === "string" && this.isOutside(value)) return value;
    }
    const globKey = globInputKeys.get(toolName);
    const glob = globKey === void 0 ? void 0 : input[globKey];
    if (typeof glob === "string" && this.globEscapes(glob)) return glob;
    return void 0;
  }
  globEscapes(pattern) {
    if (pattern.split(/[\\/]/).includes("..")) return true;
    const magic = pattern.search(globMagic);
    const literalPrefix = magic === -1 ? pattern : pattern.slice(0, magic);
    return isAbsolute3(literalPrefix) && this.isOutside(literalPrefix);
  }
  isOutside(path) {
    if (path.startsWith("~")) return true;
    const location = relative3(this.realRepositoryRoot, this.realPath(resolve2(this.cwd, path)));
    return location === ".." || location.startsWith(`..${sep3}`) || isAbsolute3(location);
  }
  realPath(path) {
    let existing = path;
    const missing = [];
    while (!existsSync(existing)) {
      const parent = dirname2(existing);
      if (parent === existing) break;
      missing.unshift(basename2(existing));
      existing = parent;
    }
    return join3(existsSync(existing) ? realpathSync(existing) : existing, ...missing);
  }
};
var CapabilityScopedClaudeToolPolicy = class {
  capabilities;
  constructor() {
    const capabilities = new Map(unmappedBuiltInCapabilities);
    for (const capability of WorkerCapabilitySchema.options) {
      for (const name of claudeBuiltInTools.toolsFor(capability))
        capabilities.set(name, capability);
    }
    this.capabilities = capabilities;
  }
  validateGrants(grants) {
    this.assertValid(Object.values(grants).flat());
  }
  builtInToolsFor(definition, runtime) {
    const names = /* @__PURE__ */ new Set();
    for (const capability of this.effectiveCapabilities(definition, runtime)) {
      for (const name of claudeBuiltInTools.toolsFor(capability)) names.add(name);
    }
    return [...names];
  }
  hostToolsFor(definition, grants, runtime) {
    const tools = this.effectiveCapabilities(definition, runtime).flatMap((capability) => [
      ...grants[capability] ?? []
    ]);
    this.assertValid(tools);
    return tools;
  }
  allowlistFor(builtInTools, hostTools) {
    return [
      ...builtInTools,
      ...hostTools.map((hostTool) => `mcp__${flightRulesHostServerName}__${hostTool.name}`)
    ];
  }
  disallowedTools() {
    return [...disallowedBuiltInTools];
  }
  guardFor(props) {
    return new RepositoryConfinedToolGuard({ ...props, capabilities: this.capabilities });
  }
  serverFor(hostTools, run) {
    return createSdkMcpServer({
      name: flightRulesHostServerName,
      alwaysLoad: true,
      tools: hostTools.map(
        (hostTool) => tool(
          hostTool.name,
          hostTool.description,
          hostTool.inputSchema,
          (args) => run.tracker.track(() => this.invoke(hostTool, args, run)),
          hostTool.annotations === void 0 ? { alwaysLoad: true } : { annotations: hostTool.annotations, alwaysLoad: true }
        )
      )
    });
  }
  assertValid(tools) {
    const names = /* @__PURE__ */ new Set();
    for (const hostTool of tools) {
      if (!hostToolNamePattern.test(hostTool.name)) {
        throw new InvalidClaudeHostToolError(
          `Host tool name ${hostTool.name} must use letters, digits, underscores or hyphens (1-64 characters).`
        );
      }
      if (names.has(hostTool.name)) {
        throw new InvalidClaudeHostToolError(`Duplicate host tool name: ${hostTool.name}`);
      }
      names.add(hostTool.name);
    }
  }
  effectiveCapabilities(definition, runtime) {
    const registered = new Set(definition.frontmatter.capabilities);
    return WorkerCapabilitySchema.options.filter(
      (capability) => registered.has(capability) && runtime.permissions[capability]?.state === "available"
    );
  }
  async invoke(hostTool, args, run) {
    try {
      const result = await hostTool.handler(args, { signal: run.signal });
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result)
          }
        ]
      };
    } catch (cause) {
      run.tracker.recordFailure(cause);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: cause instanceof Error ? cause.message : String(cause)
          }
        ]
      };
    }
  }
};

// src/sdk/claude-agent/claude-agent-runtime.ts
var PartialModelBindingsSchema = ModelBindingsSchema.partial();
var ClaudeAgentRuntimePropsSchema = z14.strictObject({
  agents: z14.array(AgentDefinitionSchema).min(1),
  models: PartialModelBindingsSchema.optional(),
  toolGrants: WorkerToolGrantsSchema,
  observe: z14.custom(
    (value) => typeof value === "function"
  ),
  maxTurns: z14.int().positive().default(64),
  query: z14.custom((value) => typeof value === "function").optional()
});
var ClaudeAgentConfigurationError = class extends WorkerDispatchConfigurationError {
  name = "ClaudeAgentConfigurationError";
};
var ClaudeAgentExecutionError = class extends Error {
  name = "ClaudeAgentExecutionError";
};
var ClaudeAgentWorkerRuntime = class {
  models;
  toolGrants;
  maxTurns;
  query;
  toolPolicy = new CapabilityScopedClaudeToolPolicy();
  dispatcher;
  constructor(props) {
    const parsed = ClaudeAgentRuntimePropsSchema.safeParse(props);
    if (!parsed.success) {
      throw new ClaudeAgentConfigurationError(parsed.error.message);
    }
    const agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.toolGrants = parsed.data.toolGrants;
    this.maxTurns = parsed.data.maxTurns;
    this.query = parsed.data.query ?? claudeAgentQuery;
    this.toolPolicy.validateGrants(this.toolGrants);
    this.models = this.bindModels(
      agents,
      parsed.data.models ?? this.defaultModels(claudeModelTiers)
    );
    this.dispatcher = new QueuedWorkerDispatcher({
      agents,
      observe: parsed.data.observe,
      run: (admission, snapshot, signal) => this.runQuery(admission, snapshot, signal),
      createError: (message) => new ClaudeAgentConfigurationError(message)
    });
  }
  dispatch(request, options = {}) {
    return this.dispatcher.dispatch(request, options);
  }
  dispatchMany(requests, options) {
    return this.dispatcher.dispatchMany(requests, options);
  }
  defaultModels(catalog) {
    try {
      return catalog.load();
    } catch (cause) {
      throw new ClaudeAgentConfigurationError(
        cause instanceof Error ? cause.message : String(cause),
        { cause }
      );
    }
  }
  bindModels(agents, bindings) {
    const models = /* @__PURE__ */ new Map();
    for (const agent of agents) {
      const tier = agent.frontmatter.model;
      const model = bindings[tier];
      if (model === void 0) {
        throw new ClaudeAgentConfigurationError(`No model is bound for the ${tier} tier.`);
      }
      models.set(agent.frontmatter.name, model);
    }
    return models;
  }
  async runQuery(admission, snapshot, signal) {
    const { request, definition } = admission;
    const prepared = workerRunProtocol.prepare(admission);
    if (prepared.status === "rejected") return prepared.outcome;
    const model = this.models.get(definition.frontmatter.name);
    if (model === void 0) {
      throw new ClaudeAgentConfigurationError(
        `No model is bound for the ${request.agent} registration.`
      );
    }
    const builtInTools = this.toolPolicy.builtInToolsFor(definition, snapshot);
    const hostTools = this.toolPolicy.hostToolsFor(definition, this.toolGrants, snapshot);
    const controller = new AbortController();
    const relayCancellation = () => controller.abort(signal.reason);
    if (signal.aborted) relayCancellation();
    signal.addEventListener("abort", relayCancellation, { once: true });
    const tracker = new HostToolExecutionTracker();
    let denial;
    const guard = this.toolPolicy.guardFor({
      allowedTools: this.toolPolicy.allowlistFor(builtInTools, hostTools),
      cwd: request.context.cwd,
      repositoryRoot: request.context.repositoryRoot,
      onDenied: (error) => {
        denial ??= error;
        controller.abort(error);
      }
    });
    const options = guardedQueryOptions.build({
      cwd: request.context.cwd,
      model,
      systemPrompt: definition.body,
      builtInTools,
      disallowedTools: this.toolPolicy.disallowedTools(),
      mcpServers: hostTools.length === 0 ? {} : {
        [flightRulesHostServerName]: this.toolPolicy.serverFor(hostTools, {
          signal: controller.signal,
          tracker
        })
      },
      guard,
      maxTurns: this.maxTurns,
      controller,
      persistSession: false
    });
    let result;
    let queryFailure;
    try {
      for await (const message of this.query({ prompt: prepared.task, options })) {
        if (message.type === "result") result = message;
      }
    } catch (cause) {
      queryFailure = { cause };
    } finally {
      signal.removeEventListener("abort", relayCancellation);
      await tracker.waitForIdle();
    }
    if (signal.aborted) return workerRunProtocol.cancelled(request);
    if (denial !== void 0) {
      return workerRunProtocol.failed(request, workerRunProtocol.executionFailure(denial, signal));
    }
    const hostFailure = tracker.failure();
    if (hostFailure !== void 0) {
      return workerRunProtocol.failed(
        request,
        workerRunProtocol.executionFailure(hostFailure.cause, signal)
      );
    }
    if (result === void 0) {
      if (queryFailure === void 0) {
        throw new ClaudeAgentExecutionError("The Claude Agent SDK ended without a result message.");
      }
      throw queryFailure.cause instanceof Error ? queryFailure.cause : new ClaudeAgentExecutionError(String(queryFailure.cause), { cause: queryFailure.cause });
    }
    if (result.subtype === "success" && !result.is_error) {
      return workerRunProtocol.finish(request, result.result, prepared.mode);
    }
    return workerRunProtocol.failed(
      request,
      workerRunProtocol.executionFailure(
        new ClaudeAgentExecutionError(this.describeFailure(result)),
        signal
      )
    );
  }
  describeFailure(result) {
    if (result.subtype === "success") return result.result;
    if (result.subtype === "error_max_turns") {
      return `The worker stopped after reaching maxTurns (${this.maxTurns}) without a final report.`;
    }
    return `The Claude Agent SDK ended with ${result.subtype}: ${result.errors.join("; ")}`;
  }
};

// src/sdk/claude-agent/skill-runtime.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  createSdkMcpServer as createSdkMcpServer2,
  query as claudeAgentQuery2,
  tool as tool2
} from "@anthropic-ai/claude-agent-sdk";
import { z as z17 } from "zod";

// src/sdk/skill-runtime-core.ts
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual as isDeepStrictEqual3 } from "node:util";
import { z as z15 } from "zod";
var skillToolNames = {
  operation: "flight_rules_operation",
  dispatch: "flight_rules_dispatch",
  sibling: "flight_rules_sibling_skill",
  ask: "flight_rules_ask_human"
};
var PartialOperationSchema = z15.strictObject({
  operationId: z15.string().min(1),
  status: z15.literal("partial"),
  data: z15.unknown(),
  error: z15.strictObject({ name: z15.string().min(1), message: z15.string() })
});
var PartialOperationFailurePropsSchema = z15.strictObject({
  operations: z15.array(PartialOperationSchema).min(1)
});
var PartialOperationFailure = class extends Error {
  name = "PartialOperationFailure";
  operations;
  constructor(props) {
    const parsed = PartialOperationFailurePropsSchema.parse(props);
    super(parsed.operations.map(({ error }) => `${error.name}: ${error.message}`).join("; "));
    this.operations = parsed.operations;
  }
};
var InvalidSkillResumeError = class extends Error {
  name = "InvalidSkillResumeError";
};
var SkillConfigurationError = class extends Error {
  name = "SkillConfigurationError";
};
var CodedSkillError = class extends Error {
  name = "CodedSkillError";
  failureCode;
  constructor(props) {
    super(props.message);
    this.failureCode = props.failureCode;
  }
};
var DeepCallerContextComparison = class {
  matches(left, right) {
    return isDeepStrictEqual3(left, right);
  }
};
var callerContexts = new DeepCallerContextComparison();
var PendingPauseRegistry = class {
  pending = /* @__PURE__ */ new Map();
  siblingPauses = /* @__PURE__ */ new Map();
  register(entry) {
    const pause = {
      ...entry,
      pauseId: randomUUID(),
      state: "paused"
    };
    this.pending.set(pause.pauseId, pause);
    return pause;
  }
  /** Validates the request against its pause and reserves it so a concurrent resume cannot share it. */
  reserve(request) {
    const pause = this.pending.get(request.pauseId);
    if (pause === void 0 || pause.questionId !== request.questionId || !callerContexts.matches(pause.context, request.context) || pause.state !== "paused") {
      throw new InvalidSkillResumeError(
        "The pause, question or caller context is missing, stale or does not match."
      );
    }
    if (request.answer.trim().length === 0) {
      throw new InvalidSkillResumeError("A human answer is required to resume this question.");
    }
    pause.state = "resuming";
    return pause;
  }
  release(pause) {
    if (this.pending.get(pause.pauseId) === pause) pause.state = "paused";
  }
  consume(pause) {
    this.pending.delete(pause.pauseId);
  }
  /** Removes a paused skill for its own caller and cancels any sibling pause it was carrying. */
  cancel(context, pauseId) {
    const pause = this.pending.get(pauseId);
    if (pause === void 0 || pause.state !== "paused" || !callerContexts.matches(pause.context, context)) {
      throw new InvalidSkillResumeError(
        "The pause is missing or belongs to another caller context."
      );
    }
    this.pending.delete(pauseId);
    const sibling = this.siblingPauses.get(pause.runKey);
    if (sibling !== void 0) {
      this.siblingPauses.delete(pause.runKey);
      this.cancel(context, sibling.pauseId);
    }
    return pause;
  }
  carrySibling(runKey, paused) {
    this.siblingPauses.set(runKey, paused);
  }
  siblingOf(runKey) {
    return this.siblingPauses.get(runKey);
  }
  releaseSibling(runKey) {
    this.siblingPauses.delete(runKey);
  }
};
var FreshQuestionAccess = class {
  observe;
  constructor(props) {
    this.observe = props.observe;
  }
  async assertAvailable(caller) {
    const snapshot = RuntimeSnapshotSchema.parse(await this.observe(caller));
    if (!callerContexts.matches(snapshot.context, caller) || snapshot.ask.state !== "available") {
      throw new InvalidSkillResumeError(
        "Fresh question access is unavailable for the original caller context."
      );
    }
  }
};
var SkillExecution = class {
  partialOperations = [];
  active = /* @__PURE__ */ new Set();
  recordedPartials = /* @__PURE__ */ new Set();
  ignores;
  firstFailure;
  constructor(props = {}) {
    this.ignores = props.ignores ?? (() => false);
  }
  get failure() {
    return this.firstFailure;
  }
  async track(execution) {
    const promise = Promise.resolve().then(execution);
    this.active.add(promise);
    try {
      return await promise;
    } finally {
      this.active.delete(promise);
    }
  }
  async waitForIdle() {
    while (this.active.size > 0) await Promise.allSettled([...this.active]);
  }
  recordFailure(cause) {
    if (this.ignores(cause)) return;
    if (cause instanceof PartialOperationFailure && !this.recordedPartials.has(cause)) {
      this.recordedPartials.add(cause);
      this.partialOperations.push(...cause.operations);
    }
    this.firstFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  rejectDependentWork() {
    if (this.firstFailure !== void 0) throw this.firstFailure;
  }
  /** Runs one tool call as tracked work that refuses to start after a failure and records its own. */
  async run(execution) {
    return this.track(async () => {
      try {
        this.rejectDependentWork();
        return await execution();
      } catch (cause) {
        this.recordFailure(cause);
        throw cause;
      }
    });
  }
};
var SkillFailureReporter = class {
  failed(report) {
    const recorded = report.execution?.failure;
    const operations = report.execution?.partialOperations ?? [];
    return {
      status: "failed",
      context: report.context,
      invocationId: report.invocationId,
      failure: {
        code: this.codeFor(report.signal, recorded),
        message: this.messageFor(recorded, report.cause),
        ...operations.length > 0 ? { operations } : {}
      }
    };
  }
  cancelled(context, invocationId) {
    return {
      status: "failed",
      context,
      invocationId,
      failure: {
        code: "CANCELLED",
        message: "The caller cancelled this paused skill."
      }
    };
  }
  codeFor(signal, recorded) {
    if (signal?.aborted) return "CANCELLED";
    if (recorded === void 0) return "EXECUTION_FAILED";
    return recorded instanceof CodedSkillError ? recorded.failureCode : "TOOL_FAILED";
  }
  messageFor(recorded, cause) {
    if (recorded !== void 0) return recorded.message;
    return cause instanceof Error ? cause.message : String(cause);
  }
};
var skillFailures = new SkillFailureReporter();
var OperationEffectCapabilities = class {
  capabilityFor(effect) {
    if (effect === "read") return "read";
    if (effect === "write") return "edit";
    if (effect === "process") return "shell";
    return "web";
  }
};
var operationEffectCapabilities = new OperationEffectCapabilities();
var SkillAgentDefinitions = class {
  forSkill(instruction, observed) {
    return {
      frontmatter: {
        name: "skill-runtime",
        description: "Execute a canonical workflow skill.",
        model: "standard",
        capabilities: AgentFrontmatterSchema.shape.capabilities.parse(
          ["read", "edit", "shell", "web", "spawn", "ask"].filter(
            (capability) => observed.permissions[capability]?.state === "available"
          )
        )
      },
      body: instruction.contents
    };
  }
};
var skillAgentDefinitions = new SkillAgentDefinitions();
var SharedSkillToolHandlers = class {
  props;
  constructor(props) {
    this.props = props;
  }
  async operation(args) {
    const { context, operations, observe, execution } = this.props;
    execution.rejectDependentWork();
    return execution.track(async () => {
      try {
        const descriptor = operations.list().find((entry) => entry.id === args.operationId);
        if (descriptor === void 0) throw new Error(`Unknown operation: ${args.operationId}`);
        const fresh = RuntimeSnapshotSchema.parse(await observe(context));
        if (!callerContexts.matches(fresh.context, context)) {
          throw new SkillConfigurationError(
            "Operation evidence belongs to a different caller context."
          );
        }
        for (const effect of descriptor.effects) {
          const capability = operationEffectCapabilities.capabilityFor(effect);
          if (fresh.permissions[capability]?.state !== "available") {
            throw new CapabilityToolDeniedError({
              toolName: `operation:${args.operationId}`,
              capability
            });
          }
        }
        const result = await operations.invoke(args.operationId, args.input);
        if (result.status === "partial") {
          throw new PartialOperationFailure({
            operations: [
              {
                operationId: args.operationId,
                status: "partial",
                data: result.data,
                error: result.error
              }
            ]
          });
        }
        if (result.status === "error") {
          throw new Error(`${result.error.name}: ${result.error.message}`);
        }
        return result;
      } catch (cause) {
        execution.recordFailure(cause);
        throw cause;
      }
    });
  }
  async dispatch(args) {
    const { context, launch, agents, workers, observe, orchestration, execution, signal } = this.props;
    execution.rejectDependentWork();
    return execution.track(async () => {
      try {
        const request = DispatchRequestSchema.parse({
          id: args.dispatchId,
          agent: args.agent,
          context,
          input: args.input
        });
        const registration = agents.find(
          (candidate) => candidate.frontmatter.name === request.agent
        );
        if (registration === void 0) {
          const decision2 = orchestration.prepare(request, launch);
          if (decision2.status !== "ready") {
            throw new Error(`${decision2.failure.code}: ${decision2.failure.message}`);
          }
        }
        const fresh = RuntimeSnapshotSchema.parse(await observe(context, registration));
        if (!callerContexts.matches(fresh.context, context)) {
          throw new SkillConfigurationError(
            "Worker evidence belongs to a different caller context."
          );
        }
        const decision = orchestration.prepare(request, fresh);
        if (decision.status !== "ready") {
          throw new Error(`${decision.failure.code}: ${decision.failure.message}`);
        }
        const outcome = signal === void 0 ? await workers.dispatch(request) : await workers.dispatch(request, { signal });
        if (outcome.status !== "completed") {
          throw new Error(`${outcome.failure.code}: ${outcome.failure.message}`);
        }
        return outcome;
      } catch (cause) {
        execution.recordFailure(cause);
        throw cause;
      }
    });
  }
  /** Runs the sibling skill through the binding's `run` and returns its completed or paused result; a failed sibling throws. */
  async sibling(args, run, shouldRecord = () => true) {
    const { context, orchestration, execution } = this.props;
    execution.rejectDependentWork();
    const sibling = orchestration.sibling({
      context,
      skill: args.siblingSkill,
      input: args.input
    });
    return execution.track(async () => {
      try {
        const result = await run(sibling);
        if (result.status === "failed") throw this.siblingFailure(result);
        return result;
      } catch (cause) {
        if (shouldRecord(cause)) execution.recordFailure(cause);
        throw cause;
      }
    });
  }
  /** Re-checks the host's question policy for this caller and returns the question that must wait for a human. */
  async ask(args) {
    const { context, allowHumanQuestions, observe, orchestration, execution } = this.props;
    const questionId = randomUUID();
    const fresh = RuntimeSnapshotSchema.parse(await observe(context));
    const decision = orchestration.ask(
      { context, question: args.question, allowHumanQuestions },
      fresh
    );
    if (decision.status !== "awaiting-answer") {
      const failure = new Error(`${decision.failure.code}: ${decision.failure.message}`);
      execution.recordFailure(failure);
      throw failure;
    }
    return { questionId, question: args.question };
  }
  siblingFailure(result) {
    if (result.failure.operations !== void 0) {
      return new PartialOperationFailure({
        operations: result.failure.operations
      });
    }
    return new Error(result.failure.message);
  }
};

// src/sdk/claude-agent/skill-boundary.ts
import { z as z16 } from "zod";
var AssistantToolUsesSchema = z16.looseObject({
  type: z16.literal("assistant"),
  parent_tool_use_id: z16.string().nullish(),
  message: z16.looseObject({
    id: z16.string(),
    content: z16.array(
      z16.looseObject({ type: z16.string(), id: z16.string().optional(), name: z16.string().optional() })
    )
  })
});
var AskInputSchema = z16.looseObject({ question: z16.string().min(1) });
var ToolTurnObserver = class {
  turns = /* @__PURE__ */ new Map();
  turnByCall = /* @__PURE__ */ new Map();
  waiting = /* @__PURE__ */ new Map();
  closed = false;
  observe(message) {
    const parsed = AssistantToolUsesSchema.safeParse(message);
    if (!parsed.success || (parsed.data.parent_tool_use_id ?? null) !== null) return;
    const turnId = parsed.data.message.id;
    const calls = this.turns.get(turnId) ?? [];
    for (const block of parsed.data.message.content) {
      if (block.type !== "tool_use" || block.id === void 0) continue;
      calls.push({ id: block.id, name: block.name ?? "" });
      this.turnByCall.set(block.id, turnId);
    }
    this.turns.set(turnId, calls);
    for (const call of calls) {
      for (const resolve3 of this.waiting.get(call.id) ?? []) resolve3();
      this.waiting.delete(call.id);
    }
  }
  /** The calls made in the same turn as this one, or undefined when the model's turn never reached the host. */
  async turnOf(toolUseId) {
    if (!this.turnByCall.has(toolUseId) && !this.closed) {
      await new Promise((resolve3) => {
        this.waiting.set(toolUseId, [...this.waiting.get(toolUseId) ?? [], resolve3]);
      });
    }
    const turnId = this.turnByCall.get(toolUseId);
    if (turnId === void 0) return void 0;
    await new Promise((resolve3) => setImmediate(resolve3));
    return [...this.turns.get(turnId) ?? []];
  }
  close() {
    this.closed = true;
    for (const resolvers of this.waiting.values()) {
      for (const resolve3 of resolvers) resolve3();
    }
    this.waiting.clear();
  }
};
var QuestionBoundary = class {
  props;
  releasedAnswer;
  deferredQuestion;
  constructor(props) {
    this.props = props;
  }
  get deferred() {
    return this.deferredQuestion;
  }
  /** Hands back the human's answer once, only after the boundary released it for the resumed call. */
  takeAnswer() {
    const answer = this.releasedAnswer;
    this.releasedAnswer = void 0;
    return answer;
  }
  async preToolUse(input) {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (this.props.resumed?.toolUseId === input.tool_use_id) return this.handleQuestion(input);
    const turn = await this.props.turns.turnOf(input.tool_use_id);
    const isAloneTool = this.props.aloneTools.includes(input.tool_name);
    const sharesTurnWithAlone = turn?.some((call) => this.props.aloneTools.includes(call.name));
    if (turn === void 0 && isAloneTool) return this.refuse(input.tool_name);
    if (turn !== void 0 && turn.length > 1 && (isAloneTool || sharesTurnWithAlone)) {
      return this.refuse(input.tool_name);
    }
    if (input.tool_name !== this.props.askTool) return {};
    return this.handleQuestion(input);
  }
  async handleQuestion(input) {
    const parsed = AskInputSchema.safeParse(input.tool_input);
    if (!parsed.success) return this.deny("A human question needs a question text.");
    const resumed = this.props.resumed;
    if (resumed !== void 0 && resumed.toolUseId === input.tool_use_id) {
      this.releasedAnswer = resumed.answer;
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { question: parsed.data.question, answer: resumed.answer }
        }
      };
    }
    if ("answer" in parsed.data) return this.deny("Only the human caller can supply an answer.");
    try {
      const pending = await this.props.ask({ question: parsed.data.question });
      this.deferredQuestion = { ...pending, toolUseId: input.tool_use_id };
    } catch (cause) {
      return this.deny(cause instanceof Error ? cause.message : String(cause));
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" } };
  }
  refuse(toolName) {
    return this.deny(
      `${toolName} must be the only tool call in its turn. Other calls in this turn may already have run; call it alone.`
    );
  }
  deny(reason) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
  }
};

// src/sdk/claude-agent/skill-runtime.ts
var flightRulesServerName = "flight-rules";
var PartialModelBindingsSchema2 = ModelBindingsSchema.partial();
var ClaudeAgentSkillRuntimePropsSchema = z17.strictObject({
  instructions: z17.custom(
    (value) => typeof value === "object" && value !== null && "loadSkill" in value && typeof value.loadSkill === "function"
  ),
  agents: z17.array(AgentDefinitionSchema).min(1),
  models: PartialModelBindingsSchema2.optional(),
  operations: z17.custom(
    (value) => typeof value === "object" && value !== null && "invoke" in value && typeof value.invoke === "function" && "list" in value && typeof value.list === "function"
  ),
  workers: z17.custom(
    (value) => typeof value === "object" && value !== null && "dispatch" in value && typeof value.dispatch === "function"
  ),
  observe: z17.custom((value) => typeof value === "function"),
  toolGrants: z17.custom(
    (value) => typeof value === "function"
  ),
  maxTurns: z17.int().positive().default(64),
  query: z17.custom((value) => typeof value === "function").optional()
});
var ClaudeAgentSkillConfigurationError = class extends SkillConfigurationError {
  name = "ClaudeAgentSkillConfigurationError";
};
var NestedSkillPauseError = class extends CodedSkillError {
  name = "NestedSkillPauseError";
  constructor(props) {
    super({
      failureCode: "NESTED_PAUSE_UNSUPPORTED",
      message: `The sibling skill ${props.siblingSkill} paused for a human answer. A paused sibling cannot be carried by its parent skill, so the parent failed.`
    });
  }
};
var UnansweredQuestionError = class extends CodedSkillError {
  name = "UnansweredQuestionError";
  constructor() {
    super({
      failureCode: "QUESTION_NOT_PAUSED",
      message: "The human question was not paused, so there is no answer to return."
    });
  }
};
var ClaudeAgentSkillRuntime = class {
  instructions;
  agents;
  model;
  operations;
  workers;
  observe;
  toolGrants;
  maxTurns;
  query;
  pauses = new PendingPauseRegistry();
  questionAccess;
  toolPolicy = new CapabilityScopedClaudeToolPolicy();
  orchestration;
  constructor(props) {
    const parsed = ClaudeAgentSkillRuntimePropsSchema.safeParse(props);
    if (!parsed.success) throw new ClaudeAgentSkillConfigurationError(parsed.error.message);
    this.instructions = parsed.data.instructions;
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.operations = parsed.data.operations;
    this.workers = parsed.data.workers;
    this.observe = parsed.data.observe;
    this.toolGrants = parsed.data.toolGrants;
    this.maxTurns = parsed.data.maxTurns;
    this.query = parsed.data.query ?? claudeAgentQuery2;
    this.orchestration = new RegistryOrchestrationPolicy({ agents: this.agents });
    this.questionAccess = new FreshQuestionAccess({ observe: this.observe });
    this.model = this.standardModel(parsed.data.models);
  }
  async invoke(skill, context, input, options = {}) {
    const caller = CallerContextSchema.parse(context);
    const invocationId = randomUUID2();
    const allowHumanQuestions = options.allowHumanQuestions === true;
    let run;
    try {
      const instruction = this.instructions.loadSkill(skill);
      run = await this.prepareRun({ skill, caller, allowHumanQuestions, signal: options.signal });
      const prompt = `${instruction.contents}

## Invocation context
${JSON.stringify(caller)}

## Invocation input
${JSON.stringify(input)}`;
      return await this.execute(run, prompt, {
        caller,
        invocationId,
        skill,
        allowHumanQuestions,
        signal: options.signal
      });
    } catch (cause) {
      await this.settle(run);
      return skillFailures.failed({
        context: caller,
        invocationId,
        signal: options.signal,
        execution: run?.execution,
        cause
      });
    }
  }
  async resume(request) {
    const caller = CallerContextSchema.parse(request.context);
    const pending = this.pauses.reserve({ ...request, context: caller });
    let run;
    let continuationStarted = false;
    try {
      await this.questionAccess.assertAvailable(caller);
      run = await this.prepareRun({
        skill: pending.skill,
        caller,
        allowHumanQuestions: pending.allowHumanQuestions,
        signal: request.signal,
        resume: { session: pending.session, answer: request.answer }
      });
      this.pauses.consume(pending);
      continuationStarted = true;
      return await this.execute(run, this.noNewPrompt(), {
        caller,
        invocationId: pending.invocationId,
        skill: pending.skill,
        allowHumanQuestions: pending.allowHumanQuestions,
        signal: request.signal
      });
    } catch (cause) {
      await this.settle(run);
      if (!continuationStarted) this.pauses.release(pending);
      return skillFailures.failed({
        context: caller,
        invocationId: pending.invocationId,
        signal: request.signal,
        execution: run?.execution,
        cause
      });
    }
  }
  cancel(context, pauseId) {
    const caller = CallerContextSchema.parse(context);
    const pending = this.pauses.cancel(caller, pauseId);
    return skillFailures.cancelled(caller, pending.invocationId);
  }
  standardModel(bindings) {
    try {
      const model = (bindings ?? claudeModelTiers.load()).standard;
      if (model === void 0) throw new Error("No model is bound for the standard tier.");
      return model;
    } catch (cause) {
      throw new ClaudeAgentSkillConfigurationError(
        cause instanceof Error ? cause.message : String(cause),
        { cause }
      );
    }
  }
  /** The SDK needs a prompt even when a deferred call resumes; an empty stream sends no new user message. */
  noNewPrompt() {
    return (async function* () {
    })();
  }
  async prepareRun(request) {
    const { skill, caller, allowHumanQuestions, signal } = request;
    const instruction = this.instructions.loadSkill(skill);
    const observed = RuntimeSnapshotSchema.parse(await this.observe(caller));
    if (!callerContexts.matches(observed.context, caller)) {
      throw new ClaudeAgentSkillConfigurationError(
        "Runtime evidence belongs to a different caller context."
      );
    }
    const definition = skillAgentDefinitions.forSkill(instruction, observed);
    const builtInTools = this.toolPolicy.builtInToolsFor(definition, observed);
    const hostTools = this.toolPolicy.hostToolsFor(definition, this.toolGrants(caller), observed);
    const questionsOffered = allowHumanQuestions && observed.ask.state === "available";
    const controller = new AbortController();
    const relayCancellation = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayCancellation();
    signal?.addEventListener("abort", relayCancellation, { once: true });
    const execution = new SkillExecution();
    const hostTracker = new HostToolExecutionTracker();
    const turns = new ToolTurnObserver();
    const handlers = new SharedSkillToolHandlers({
      context: caller,
      allowHumanQuestions,
      launch: observed,
      agents: this.agents,
      operations: this.operations,
      workers: this.workers,
      observe: this.observe,
      orchestration: this.orchestration,
      execution,
      signal: controller.signal
    });
    const boundary = new QuestionBoundary({
      askTool: this.qualified(skillToolNames.ask),
      aloneTools: [this.qualified(skillToolNames.ask), this.qualified(skillToolNames.sibling)],
      turns,
      ask: (args) => handlers.ask(args),
      resumed: request.resume === void 0 ? void 0 : { toolUseId: request.resume.session.toolUseId, answer: request.resume.answer }
    });
    const sharedTools = this.sharedToolNames(questionsOffered);
    const guard = this.toolPolicy.guardFor({
      allowedTools: [
        ...this.toolPolicy.allowlistFor(builtInTools, hostTools),
        ...sharedTools.map((name) => this.qualified(name))
      ],
      cwd: caller.cwd,
      repositoryRoot: caller.repositoryRoot,
      onDenied: (error) => {
        execution.recordFailure(error);
        controller.abort(error);
      }
    });
    const options = guardedQueryOptions.build({
      cwd: caller.cwd,
      model: this.model,
      builtInTools,
      disallowedTools: this.toolPolicy.disallowedTools(),
      mcpServers: {
        [flightRulesServerName]: this.sharedServer({
          handlers,
          boundary,
          execution,
          questionsOffered,
          allowHumanQuestions,
          signal: controller.signal
        }),
        ...hostTools.length === 0 ? {} : {
          [flightRulesHostServerName]: this.toolPolicy.serverFor(hostTools, {
            signal: controller.signal,
            tracker: hostTracker
          })
        }
      },
      guard,
      preToolUse: async (input) => {
        if (execution.failure !== void 0) return this.denyAfterFailure(execution.failure);
        const denied = await guard.preToolUse(input);
        if (this.isDenial(denied)) return denied;
        return boundary.preToolUse(input);
      },
      maxTurns: this.maxTurns,
      controller,
      persistSession: true,
      ...request.resume === void 0 ? {} : { resume: request.resume.session.sessionId }
    });
    return {
      options,
      execution,
      hostTools: hostTracker,
      turns,
      boundary,
      controller,
      detach: () => signal?.removeEventListener("abort", relayCancellation)
    };
  }
  async execute(run, prompt, identity) {
    let result;
    let queryFailure;
    try {
      for await (const message of this.query({ prompt, options: run.options })) {
        run.turns.observe(message);
        if (message.type === "result") result = message;
      }
    } catch (cause) {
      queryFailure = { cause };
    } finally {
      await this.settle(run);
    }
    const hostFailure = run.hostTools.failure();
    if (hostFailure !== void 0) run.execution.recordFailure(hostFailure.cause);
    if (run.execution.failure !== void 0) throw run.execution.failure;
    if (identity.signal?.aborted)
      throw identity.signal.reason ?? new Error("The skill was cancelled.");
    if (result === void 0) {
      throw queryFailure?.cause ?? new ClaudeAgentExecutionError("The Claude Agent SDK ended without a result message.");
    }
    if (result.subtype === "success" && result.deferred_tool_use !== void 0) {
      return this.pause(run, result, identity);
    }
    if (result.subtype === "success" && !result.is_error) {
      return {
        status: "completed",
        context: identity.caller,
        invocationId: identity.invocationId,
        report: result.result
      };
    }
    throw new ClaudeAgentExecutionError(this.describeFailure(result));
  }
  pause(run, result, identity) {
    const deferredCall = result.deferred_tool_use;
    const question = run.boundary.deferred;
    if (deferredCall === void 0 || question === void 0 || deferredCall.id !== question.toolUseId) {
      throw new ClaudeAgentExecutionError(
        `The Claude Agent SDK deferred ${deferredCall?.name ?? "a tool call"} that this runtime did not pause.`
      );
    }
    const pause = this.pauses.register({
      context: identity.caller,
      invocationId: identity.invocationId,
      questionId: question.questionId,
      skill: identity.skill,
      allowHumanQuestions: identity.allowHumanQuestions,
      runKey: result.session_id,
      session: { sessionId: result.session_id, toolUseId: question.toolUseId }
    });
    return {
      status: "paused",
      context: identity.caller,
      invocationId: identity.invocationId,
      pauseId: pause.pauseId,
      questionId: question.questionId,
      question: question.question
    };
  }
  async settle(run) {
    if (run === void 0) return;
    run.turns.close();
    run.detach();
    await run.execution.waitForIdle();
    await run.hostTools.waitForIdle();
  }
  describeFailure(result) {
    if (result.subtype === "success") return result.result;
    if (result.subtype === "error_max_turns") {
      return `The skill stopped after reaching maxTurns (${this.maxTurns}) without a final answer.`;
    }
    return `The Claude Agent SDK ended with ${result.subtype}: ${result.errors.join("; ")}`;
  }
  qualified(toolName) {
    return `mcp__${flightRulesServerName}__${toolName}`;
  }
  sharedToolNames(questionsOffered) {
    return [
      skillToolNames.operation,
      skillToolNames.dispatch,
      skillToolNames.sibling,
      ...questionsOffered ? [skillToolNames.ask] : []
    ];
  }
  isDenial(output) {
    const specific = "hookSpecificOutput" in output ? output.hookSpecificOutput : void 0;
    return specific !== void 0 && "permissionDecision" in specific && specific.permissionDecision === "deny";
  }
  denyAfterFailure(failure) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `This skill already failed (${failure.message}); no further tool work runs.`
      }
    };
  }
  sharedServer(props) {
    const { handlers, boundary, execution } = props;
    const text = (value) => ({
      content: [
        { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }
      ]
    });
    const failed = (cause) => ({
      isError: true,
      content: [
        { type: "text", text: cause instanceof Error ? cause.message : String(cause) }
      ]
    });
    const tools = [
      tool2(
        skillToolNames.operation,
        "Run a launch-authorized shared flight-rules operation.",
        { operationId: z17.string(), input: z17.record(z17.string(), z17.unknown()) },
        async (args) => handlers.operation(args).then(text, failed),
        { alwaysLoad: true }
      ),
      tool2(
        skillToolNames.dispatch,
        "Dispatch one registered named worker under observed host grants.",
        { agent: z17.string(), dispatchId: z17.string(), input: z17.record(z17.string(), z17.json()) },
        async (args) => handlers.dispatch(args).then(text, failed),
        { alwaysLoad: true }
      ),
      tool2(
        skillToolNames.sibling,
        "Invoke another canonical skill with this same caller context. Call it alone in its turn.",
        { siblingSkill: z17.string(), input: z17.record(z17.string(), z17.json()) },
        async (args) => handlers.sibling(
          args,
          (sibling) => this.runSibling(sibling.skill, sibling.context, sibling.input, props)
        ).then(text, failed),
        { alwaysLoad: true }
      )
    ];
    const askTools = props.questionsOffered ? [
      tool2(
        skillToolNames.ask,
        "Pause this skill and wait for an actual answer from the human caller. Call it alone in its turn and never supply the answer field.",
        { question: z17.string().min(1), answer: z17.string().optional() },
        async () => {
          const answer = boundary.takeAnswer();
          if (answer === void 0) {
            const unanswered = new UnansweredQuestionError();
            execution.recordFailure(unanswered);
            return failed(unanswered);
          }
          return text(answer);
        },
        { alwaysLoad: true }
      )
    ] : [];
    return createSdkMcpServer2({
      name: flightRulesServerName,
      alwaysLoad: true,
      tools: [...tools, ...askTools]
    });
  }
  async runSibling(skill, context, input, props) {
    const result = await this.invoke(skill, context, input, {
      allowHumanQuestions: props.allowHumanQuestions,
      signal: props.signal
    });
    if (result.status !== "paused") return result;
    this.cancel(result.context, result.pauseId);
    throw new NestedSkillPauseError({ siblingSkill: skill });
  }
};
export {
  CapabilityToolDeniedError,
  ClaudeAgentConfigurationError,
  ClaudeAgentExecutionError,
  ClaudeAgentSkillConfigurationError,
  ClaudeAgentSkillRuntime,
  CapabilityScopedClaudeToolPolicy as ClaudeAgentToolPolicy,
  ClaudeAgentWorkerRuntime,
  FileModelTierCatalog,
  InvalidClaudeHostToolError,
  InvalidSkillResumeError,
  ModelTiersUnavailableError,
  NestedSkillPauseError,
  RepositoryPathDeniedError,
  UnansweredQuestionError,
  flightRulesHostServerName,
  flightRulesServerName
};
