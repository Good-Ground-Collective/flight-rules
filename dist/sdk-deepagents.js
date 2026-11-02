// src/sdk/deepagents/deepagents-runtime.ts
import { createDeepAgent } from "deepagents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { tool } from "langchain";
import { z as z10 } from "zod";

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
    const cancellationWait = new Promise((resolve) => {
      wakeCancellationWait = resolve;
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

// src/sdk/deepagents/tool-policy.ts
import { createFilesystemMiddleware, createSubAgentMiddleware, StateBackend } from "deepagents";
import { createMiddleware } from "langchain";
var flightRulesAbortSignalConfigKey = "flightRulesAbortSignal";
var filesystemCapabilities = /* @__PURE__ */ new Map([
  ["ls", "read"],
  ["read_file", "read"],
  ["glob", "read"],
  ["grep", "read"],
  ["write_file", "edit"],
  ["edit_file", "edit"],
  ["delete", "edit"],
  ["execute", "shell"],
  ["task", "spawn"]
]);
var InvalidDeepAgentsToolRegistrationError = class extends Error {
  name = "InvalidDeepAgentsToolRegistrationError";
};
var CapabilityScopedDeepAgentsToolPolicy = class {
  toolsFor(definition, grants, runtime) {
    const capabilities = new Set(definition.frontmatter.capabilities);
    const tools = [...WorkerCapabilitySchema.options].flatMap((capability) => {
      if (!capabilities.has(capability)) return [];
      if (runtime.permissions[capability]?.state !== "available") return [];
      return [...grants[capability] ?? []];
    });
    const names = /* @__PURE__ */ new Set();
    for (const tool3 of tools) {
      if (names.has(tool3.name))
        throw new InvalidDeepAgentsToolRegistrationError(`Duplicate host tool name: ${tool3.name}`);
      if (filesystemCapabilities.has(tool3.name)) {
        throw new InvalidDeepAgentsToolRegistrationError(
          `Host tools cannot replace reserved Deep Agents tool ${tool3.name}.`
        );
      }
      names.add(tool3.name);
    }
    return tools;
  }
  middlewareFor(model, definition, hostTools, trackExecution, onCapabilityDenied, additionalToolNames = []) {
    const permissions = new Set(definition.frontmatter.capabilities);
    const filesystemTools = [
      ...permissions.has("read") ? ["read_file", "ls", "glob", "grep"] : [],
      ...permissions.has("read") && permissions.has("edit") ? ["write_file", "edit_file", "delete"] : []
    ];
    const filesystem = !permissions.has("read") ? createMiddleware({ name: "FilesystemMiddleware" }) : createFilesystemMiddleware({
      backend: new StateBackend(),
      tools: filesystemTools
    });
    const subagents = createSubAgentMiddleware({
      defaultModel: model,
      defaultTools: [],
      subagents: [],
      generalPurposeAgent: false
    });
    const allowedToolNames = /* @__PURE__ */ new Set([
      ...hostTools.map((tool3) => tool3.name),
      ...additionalToolNames,
      ...filesystemTools
    ]);
    return [
      filesystem,
      createMiddleware({ name: subagents.name }),
      createMiddleware({
        name: "FlightRulesCapabilityGuard",
        wrapModelCall: async (request, handler) => {
          const response = await handler(request);
          for (const call of response.tool_calls ?? []) {
            if (!allowedToolNames.has(call.name)) {
              const error = new CapabilityToolDeniedError({
                toolName: call.name,
                capability: filesystemCapabilities.get(call.name)
              });
              onCapabilityDenied(error);
              throw error;
            }
          }
          return response;
        },
        wrapToolCall: async (request, handler) => {
          const name = request.toolCall.name;
          const capability = filesystemCapabilities.get(name);
          if (allowedToolNames.has(name) && capability === void 0) {
            return trackExecution(() => Promise.resolve(handler(request)));
          }
          if (capability !== void 0 && permissions.has(capability) && capability !== "shell" && capability !== "spawn") {
            return trackExecution(() => Promise.resolve(handler(request)));
          }
          const error = new CapabilityToolDeniedError({
            toolName: name,
            capability
          });
          onCapabilityDenied(error);
          throw error;
        }
      })
    ];
  }
};

// src/sdk/deepagents/deepagents-runtime.ts
var InFlightModelTracker = class extends BaseCallbackHandler {
  name = "FlightRulesModelExecutionTracker";
  activeRuns = /* @__PURE__ */ new Set();
  nextExecution = 0;
  idleWaiters = [];
  handleChatModelStart(_model, _messages, runId) {
    this.activeRuns.add(runId);
  }
  handleLLMEnd(_result, runId) {
    this.finishRun(runId);
  }
  handleLLMError(_error, runId) {
    this.finishRun(runId);
  }
  async track(execution) {
    const executionId = /* @__PURE__ */ Symbol(`tool-${this.nextExecution++}`);
    this.activeRuns.add(executionId);
    try {
      return await execution();
    } finally {
      this.finishRun(executionId);
    }
  }
  waitForIdle() {
    if (this.activeRuns.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  finishRun(runId) {
    this.activeRuns.delete(runId);
    if (this.activeRuns.size === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
};
var ModelInstancesSchema = z10.strictObject({
  standard: z10.instanceof(BaseChatModel),
  escalated: z10.instanceof(BaseChatModel),
  expert: z10.instanceof(BaseChatModel)
});
var DeepAgentsRuntimePropsSchema = z10.strictObject({
  agents: z10.array(AgentDefinitionSchema).min(1),
  models: ModelInstancesSchema,
  toolGrants: z10.record(
    z10.string(),
    z10.array(
      z10.custom(
        (value) => typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "invoke" in value && typeof value.invoke === "function"
      )
    )
  ),
  observe: z10.custom(
    (value) => typeof value === "function"
  ),
  maxGraphSteps: z10.int().positive().default(64)
});
var DeepAgentsConfigurationError = class extends WorkerDispatchConfigurationError {
  name = "DeepAgentsConfigurationError";
};
var LangChainDeepAgentsWorkerRuntime = class {
  agents;
  models;
  toolGrants;
  maxGraphSteps;
  toolPolicy = new CapabilityScopedDeepAgentsToolPolicy();
  dispatcher;
  constructor(props) {
    const parsed = DeepAgentsRuntimePropsSchema.safeParse(props);
    if (!parsed.success) {
      throw new DeepAgentsConfigurationError(parsed.error.message);
    }
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.models = Object.freeze({ ...parsed.data.models });
    this.toolGrants = parsed.data.toolGrants;
    this.maxGraphSteps = parsed.data.maxGraphSteps;
    const tiers = new Set(this.agents.map((agent) => agent.frontmatter.model));
    for (const tier of tiers) {
      if (this.models[tier] === void 0) {
        throw new DeepAgentsConfigurationError(`No model instance is bound for the ${tier} tier.`);
      }
    }
    this.dispatcher = new QueuedWorkerDispatcher({
      agents: this.agents,
      observe: parsed.data.observe,
      run: (admission, snapshot, signal) => this.runGraph(admission, snapshot, signal),
      createError: (message) => new DeepAgentsConfigurationError(message)
    });
  }
  dispatch(request, options = {}) {
    return this.dispatcher.dispatch(request, options);
  }
  dispatchMany(requests, options) {
    return this.dispatcher.dispatchMany(requests, options);
  }
  async runGraph(admission, snapshot, signal) {
    const { request, definition } = admission;
    const prepared = workerRunProtocol.prepare(admission);
    if (prepared.status === "rejected") return prepared.outcome;
    const model = this.models[definition.frontmatter.model];
    const hostTools = this.toolPolicy.toolsFor(definition, this.toolGrants, snapshot);
    const modelTracker = new InFlightModelTracker();
    const trackedTools = hostTools.map(
      (hostTool) => tool(
        (input, runtime) => {
          const hostRuntime = {
            ...runtime,
            signal: new AbortController().signal,
            configurable: {
              ...runtime.configurable,
              [flightRulesAbortSignalConfigKey]: signal
            }
          };
          return modelTracker.track(() => hostTool.invoke(input, hostRuntime));
        },
        {
          name: hostTool.name,
          description: hostTool.description,
          schema: hostTool.schema
        }
      )
    );
    let capabilityFailure;
    const middleware = this.toolPolicy.middlewareFor(
      model,
      definition,
      hostTools,
      (execution) => modelTracker.track(execution),
      (error) => {
        capabilityFailure = error;
      }
    );
    const graph = createDeepAgent({
      model,
      tools: trackedTools,
      middleware,
      name: request.agent
    });
    let result;
    try {
      result = await graph.invoke(
        { messages: [new HumanMessage(prepared.prompt)] },
        {
          recursionLimit: this.maxGraphSteps,
          signal,
          callbacks: [modelTracker]
        }
      );
    } catch (cause) {
      if (capabilityFailure !== void 0) {
        return workerRunProtocol.failed(
          request,
          workerRunProtocol.executionFailure(capabilityFailure, signal)
        );
      }
      throw cause;
    } finally {
      await modelTracker.waitForIdle();
    }
    if (signal.aborted) return workerRunProtocol.cancelled(request);
    const finalMessage = result.messages.toReversed().find((message) => isAIMessage(message));
    if (finalMessage === void 0 || typeof finalMessage.content !== "string") {
      throw new DeepAgentsConfigurationError("Deep Agents returned no final text report.");
    }
    return workerRunProtocol.finish(request, finalMessage.content, prepared.mode);
  }
};

// src/sdk/deepagents/skill-runtime.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { Command, interrupt, isGraphInterrupt, MemorySaver } from "@langchain/langgraph";
import {
  BaseMessage,
  HumanMessage as HumanMessage2,
  isAIMessage as isAIMessage2
} from "@langchain/core/messages";
import { BaseChatModel as BaseChatModel2 } from "@langchain/core/language_models/chat_models";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { createDeepAgent as createDeepAgent2 } from "deepagents";
import { createMiddleware as createMiddleware2, tool as tool2 } from "langchain";
import { z as z12 } from "zod";

// src/sdk/skill-runtime-core.ts
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual as isDeepStrictEqual3 } from "node:util";
import { z as z11 } from "zod";
var skillToolNames = {
  operation: "flight_rules_operation",
  dispatch: "flight_rules_dispatch",
  sibling: "flight_rules_sibling_skill",
  ask: "flight_rules_ask_human"
};
var PartialOperationSchema = z11.strictObject({
  operationId: z11.string().min(1),
  status: z11.literal("partial"),
  data: z11.unknown(),
  error: z11.strictObject({ name: z11.string().min(1), message: z11.string() })
});
var PartialOperationFailurePropsSchema = z11.strictObject({
  operations: z11.array(PartialOperationSchema).min(1)
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

// src/sdk/deepagents/skill-runtime.ts
var SkillRuntimePropsSchema = z12.strictObject({
  instructions: z12.custom(
    (value) => typeof value === "object" && value !== null && "loadSkill" in value && typeof value.loadSkill === "function"
  ),
  agents: z12.array(AgentDefinitionSchema).min(1),
  models: z12.strictObject({
    standard: z12.instanceof(BaseChatModel2),
    escalated: z12.instanceof(BaseChatModel2),
    expert: z12.instanceof(BaseChatModel2)
  }),
  operations: z12.custom(
    (value) => typeof value === "object" && value !== null && "invoke" in value && typeof value.invoke === "function" && "list" in value && typeof value.list === "function"
  ),
  workers: z12.custom(
    (value) => typeof value === "object" && value !== null && "dispatch" in value && typeof value.dispatch === "function"
  ),
  observe: z12.custom((value) => typeof value === "function"),
  toolGrants: z12.custom(
    (value) => typeof value === "function"
  ),
  checkpointer: z12.custom(
    (value) => typeof value === "object" && value !== null && "getTuple" in value && typeof value.getTuple === "function"
  ).default(() => new MemorySaver()),
  maxGraphSteps: z12.int().positive().default(128)
});
var DeepAgentsSkillConfigurationError = class extends SkillConfigurationError {
  name = "DeepAgentsSkillConfigurationError";
};
var LangChainDeepAgentsSkillRuntime = class {
  instructions;
  agents;
  models;
  operations;
  workers;
  observe;
  toolGrants;
  checkpointer;
  maxGraphSteps;
  pauses = new PendingPauseRegistry();
  questionAccess;
  policy = new CapabilityScopedDeepAgentsToolPolicy();
  orchestration;
  constructor(props) {
    const parsed = SkillRuntimePropsSchema.safeParse(props);
    if (!parsed.success) throw new DeepAgentsSkillConfigurationError(parsed.error.message);
    this.instructions = parsed.data.instructions;
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.models = parsed.data.models;
    this.operations = parsed.data.operations;
    this.workers = parsed.data.workers;
    this.observe = parsed.data.observe;
    this.toolGrants = parsed.data.toolGrants;
    this.checkpointer = parsed.data.checkpointer;
    this.maxGraphSteps = parsed.data.maxGraphSteps;
    this.orchestration = new RegistryOrchestrationPolicy({
      agents: this.agents
    });
    this.questionAccess = new FreshQuestionAccess({ observe: this.observe });
  }
  async invoke(skill, context, input, options = {}) {
    const caller = CallerContextSchema.parse(context);
    const invocationId = randomUUID2();
    const threadId = randomUUID2();
    let execution;
    try {
      const instruction = this.instructions.loadSkill(skill);
      execution = await this.createGraph(
        skill,
        caller,
        options.allowHumanQuestions === true,
        threadId
      );
      const result = await execution.graph.invoke(
        {
          messages: [
            new HumanMessage2(
              `${instruction.contents}

## Invocation context
${JSON.stringify(caller)}

## Invocation input
${JSON.stringify(input)}`
            )
          ]
        },
        {
          configurable: { thread_id: threadId },
          recursionLimit: this.maxGraphSteps,
          ...options.signal === void 0 ? {} : { signal: options.signal }
        }
      );
      await execution.run.waitForIdle();
      if (execution.run.failure !== void 0) throw execution.run.failure;
      return this.result(
        execution.graph,
        result,
        caller,
        invocationId,
        threadId,
        skill,
        options.allowHumanQuestions === true
      );
    } catch (cause) {
      await execution?.run.waitForIdle();
      const interruption = isGraphInterrupt(cause) ? z12.array(
        z12.object({
          id: z12.string().optional(),
          value: z12.unknown()
        })
      ).safeParse(cause.interrupts) : this.questionInterruptionFromError(cause);
      const question = interruption.success ? z12.object({
        questionId: z12.string(),
        question: z12.string()
      }).safeParse(interruption.data[0]?.value) : void 0;
      if (question?.success === true && options.allowHumanQuestions === true && isGraphInterrupt(cause)) {
        const pause = this.pauses.register({
          context: caller,
          invocationId,
          questionId: question.data.questionId,
          skill,
          allowHumanQuestions: true,
          runKey: threadId,
          session: threadId
        });
        return {
          status: "paused",
          context: caller,
          invocationId,
          pauseId: pause.pauseId,
          questionId: question.data.questionId,
          question: question.data.question
        };
      }
      return skillFailures.failed({
        context: caller,
        invocationId,
        signal: options.signal,
        execution: execution?.run,
        cause
      });
    }
  }
  async resume(request) {
    const caller = CallerContextSchema.parse(request.context);
    const pending = this.pauses.reserve({ ...request, context: caller });
    let execution;
    let continuationStarted = false;
    try {
      await this.questionAccess.assertAvailable(caller);
      execution = await this.createGraph(
        pending.skill,
        caller,
        pending.allowHumanQuestions,
        pending.session
      );
      this.pauses.consume(pending);
      continuationStarted = true;
      const result = await execution.graph.invoke(
        new Command({
          resume: {
            questionId: request.questionId,
            answer: request.answer
          }
        }),
        {
          configurable: { thread_id: pending.session },
          recursionLimit: this.maxGraphSteps,
          ...request.signal === void 0 ? {} : { signal: request.signal }
        }
      );
      await execution.run.waitForIdle();
      if (execution.run.failure !== void 0) throw execution.run.failure;
      return this.result(
        execution.graph,
        result,
        caller,
        pending.invocationId,
        pending.session,
        pending.skill,
        pending.allowHumanQuestions
      );
    } catch (cause) {
      await execution?.run.waitForIdle();
      if (!continuationStarted) this.pauses.release(pending);
      return skillFailures.failed({
        context: caller,
        invocationId: pending.invocationId,
        signal: request.signal,
        execution: execution?.run,
        cause
      });
    }
  }
  cancel(context, pauseId) {
    const caller = CallerContextSchema.parse(context);
    const pending = this.pauses.cancel(caller, pauseId);
    return skillFailures.cancelled(caller, pending.invocationId);
  }
  async createGraph(skill, context, allowHumanQuestions, threadId) {
    const instruction = this.instructions.loadSkill(skill);
    const observed = RuntimeSnapshotSchema.parse(await this.observe(context));
    if (JSON.stringify(observed.context) !== JSON.stringify(context))
      throw new DeepAgentsSkillConfigurationError(
        "Runtime evidence belongs to a different caller context."
      );
    const grants = this.toolGrants(context);
    const run = new SkillExecution({ ignores: isGraphInterrupt });
    let propagatingSiblingQuestion = false;
    const handlers = new SharedSkillToolHandlers({
      context,
      allowHumanQuestions,
      launch: observed,
      agents: this.agents,
      operations: this.operations,
      workers: this.workers,
      observe: this.observe,
      orchestration: this.orchestration,
      execution: run
    });
    const shared = [
      tool2(async ({ operationId, input }) => handlers.operation({ operationId, input }), {
        name: skillToolNames.operation,
        description: "Run a launch-authorized shared flight-rules operation.",
        schema: z12.object({
          operationId: z12.string(),
          input: z12.record(z12.string(), z12.unknown())
        })
      }),
      tool2(
        async ({ agent, dispatchId, input }) => handlers.dispatch({ agent, dispatchId, input }),
        {
          name: skillToolNames.dispatch,
          description: "Dispatch one registered named worker under observed host grants.",
          schema: z12.object({
            agent: z12.string(),
            dispatchId: z12.string(),
            input: z12.record(z12.string(), z12.json())
          })
        }
      ),
      tool2(
        async ({ siblingSkill, input }) => handlers.sibling(
          { siblingSkill, input },
          async (sibling) => {
            const pausedSibling = this.pauses.siblingOf(threadId);
            if (pausedSibling !== void 0) {
              return this.resumeSibling(threadId, pausedSibling);
            }
            const result = await AsyncLocalStorageProviderSingleton.getInstance().run(
              void 0,
              () => this.invoke(sibling.skill, sibling.context, sibling.input, {
                allowHumanQuestions
              })
            );
            if (result.status === "paused") {
              this.pauses.carrySibling(threadId, result);
              propagatingSiblingQuestion = true;
              return await this.resumeSibling(threadId, result);
            }
            return result;
          },
          (cause) => !propagatingSiblingQuestion && !isGraphInterrupt(cause)
        ),
        {
          name: skillToolNames.sibling,
          description: "Invoke another canonical skill with this same caller context.",
          schema: z12.object({
            siblingSkill: z12.string(),
            input: z12.record(z12.string(), z12.unknown())
          })
        }
      ),
      tool2(
        async ({ question }) => {
          const pending = await handlers.ask({ question });
          return interrupt({
            questionId: pending.questionId,
            question: pending.question
          });
        },
        {
          name: skillToolNames.ask,
          description: "Pause this skill and wait for an actual answer from the human caller.",
          schema: z12.object({ question: z12.string().min(1) })
        }
      )
    ];
    const model = this.models.standard;
    const skillDefinition = skillAgentDefinitions.forSkill(instruction, observed);
    const suppliedHostTools = this.policy.toolsFor(skillDefinition, grants, observed);
    const subagents = this.policy.middlewareFor(
      model,
      skillDefinition,
      suppliedHostTools,
      (execution) => run.run(execution),
      (error) => {
        run.recordFailure(error);
      },
      shared.map((entry) => entry.name)
    );
    const questionBoundary = createMiddleware2({
      name: "FlightRulesQuestionBoundary",
      wrapModelCall: async (request, handler) => {
        const response = await handler(request);
        const calls = response.tool_calls ?? [];
        const question = calls.find((call) => call.name === skillToolNames.ask);
        const boundary = question ?? calls.find((call) => call.name === skillToolNames.sibling);
        if (boundary !== void 0) {
          response.tool_calls = [boundary];
        }
        return response;
      }
    });
    const middleware = [
      createMiddleware2({ name: "FilesystemMiddleware" }),
      ...subagents.slice(1),
      questionBoundary
    ];
    return {
      graph: createDeepAgent2({
        name: instruction.name,
        model,
        tools: [...shared, ...suppliedHostTools],
        checkpointer: this.checkpointer,
        middleware
      }),
      run
    };
  }
  resumeSibling(threadId, paused) {
    const answerValue = interrupt({
      questionId: paused.questionId,
      question: paused.question
    });
    const answer = z12.object({ questionId: z12.string(), answer: z12.string() }).parse(answerValue);
    if (answer.questionId !== paused.questionId) {
      throw new InvalidSkillResumeError("The answer belongs to another sibling question.");
    }
    return this.resume({
      context: paused.context,
      pauseId: paused.pauseId,
      questionId: paused.questionId,
      answer: answer.answer
    }).then((result) => {
      if (result.status === "paused") {
        this.pauses.carrySibling(threadId, result);
        return this.resumeSibling(threadId, result);
      }
      this.pauses.releaseSibling(threadId);
      return result;
    });
  }
  questionInterruptionFromError(cause) {
    const schema = z12.array(z12.object({ id: z12.string().optional(), value: z12.unknown() }));
    if (!(cause instanceof Error)) return schema.safeParse(null);
    try {
      return schema.safeParse(JSON.parse(cause.message));
    } catch {
      return schema.safeParse(null);
    }
  }
  result(graph, result, context, invocationId, threadId, skill, allowHumanQuestions) {
    const graphResult = z12.record(z12.string(), z12.unknown()).parse(result);
    const messages = z12.array(z12.instanceof(BaseMessage)).parse(graphResult["messages"]);
    const interruptions = z12.array(z12.object({ value: z12.unknown() })).safeParse(graphResult["__interrupt__"]);
    const task = interruptions.success ? interruptions.data[0] : void 0;
    const question = task === void 0 ? void 0 : z12.object({ questionId: z12.string(), question: z12.string() }).safeParse(task.value);
    if (question?.success === true) {
      const pause = this.pauses.register({
        context,
        invocationId,
        questionId: question.data.questionId,
        skill,
        allowHumanQuestions,
        runKey: threadId,
        session: threadId
      });
      return {
        status: "paused",
        context,
        invocationId,
        pauseId: pause.pauseId,
        questionId: question.data.questionId,
        question: question.data.question
      };
    }
    const finalMessage = messages.toReversed().find((message) => isAIMessage2(message));
    return {
      status: "completed",
      context,
      invocationId,
      report: finalMessage?.content ?? ""
    };
  }
};
export {
  CapabilityToolDeniedError,
  DeepAgentsConfigurationError,
  DeepAgentsSkillConfigurationError,
  LangChainDeepAgentsSkillRuntime as DeepAgentsSkillRuntime,
  CapabilityScopedDeepAgentsToolPolicy as DeepAgentsToolPolicy,
  LangChainDeepAgentsWorkerRuntime as DeepAgentsWorkerRuntime,
  InvalidDeepAgentsToolRegistrationError,
  InvalidSkillResumeError,
  LangChainDeepAgentsSkillRuntime,
  flightRulesAbortSignalConfigKey
};
