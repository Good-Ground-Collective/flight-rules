// src/sdk/deepagents/deepagents-runtime.ts
import { createDeepAgent } from "deepagents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { tool } from "langchain";
import { z as z9 } from "zod";

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
import { z as z7 } from "zod";
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

// src/sdk/report-codec.ts
var reportText = OrchestrationTextSchema;
var JsonReportValueSchema = z7.json();
var InternalResearchSchema = z7.strictObject({
  files: z7.array(z7.strictObject({ path: reportText, why: reportText })),
  patterns: z7.array(reportText),
  integrationPoints: z7.array(reportText),
  risks: z7.array(reportText)
});
var ExternalResearchSchema = z7.strictObject({
  answer: reportText,
  sources: z7.array(z7.strictObject({ url: z7.url(), title: reportText })),
  exampleUsage: reportText.nullable(),
  caveats: z7.array(reportText)
});
var ResearchReportSchema = z7.strictObject({
  summary: reportText,
  confidence: z7.enum(["low", "med", "high"]),
  internal: InternalResearchSchema.optional(),
  external: ExternalResearchSchema.optional()
});
var EvidenceSchema = z7.strictObject({
  dir: reportText,
  items: z7.array(
    z7.strictObject({
      path: reportText,
      kind: z7.enum(["image", "video", "text"]),
      phase: z7.enum(["before", "after"]),
      caption: reportText
    })
  )
});
var QaReproduceSchema = z7.discriminatedUnion("reproduced", [
  z7.strictObject({
    summary: reportText,
    reproduced: z7.literal(true),
    needs: z7.array(reportText).optional(),
    steps: z7.array(reportText),
    after: z7.array(reportText),
    rootCause: reportText,
    trapForQA: reportText,
    fixedWhen: z7.array(reportText),
    evidence: EvidenceSchema,
    openQuestions: z7.array(reportText).optional()
  }),
  z7.strictObject({
    summary: reportText,
    reproduced: z7.literal(false),
    reason: reportText,
    needs: z7.array(reportText).optional(),
    evidence: EvidenceSchema,
    openQuestions: z7.array(reportText).optional()
  })
]);
var QaVerifySchema = z7.strictObject({
  summary: reportText,
  items: z7.array(
    z7.strictObject({
      item: reportText,
      verdict: z7.enum(["PASS", "FAIL", "UNVERIFIABLE"]),
      evidence: reportText
    })
  ),
  evidence: EvidenceSchema,
  verified: z7.boolean(),
  needs: z7.array(reportText).optional(),
  openQuestions: z7.array(reportText).optional()
}).refine(
  (report) => report.verified === report.items.every((item) => item.verdict === "PASS"),
  "verified must agree with every item verdict"
);
var WriterFindingSchema = z7.strictObject({
  excerpt: reportText,
  location: reportText,
  mandate: reportText,
  problem: reportText,
  suggestion: reportText
});
var WriterFeedbackSchema = z7.strictObject({
  summary: reportText,
  verdict: z7.enum(["CLEAN", "MINOR", "HEAVY"]),
  findings: z7.array(WriterFindingSchema),
  strengths: z7.array(reportText),
  openQuestions: z7.array(reportText).optional()
});
var WriterChangeSchema = z7.strictObject({
  before: reportText,
  after: reportText,
  mandate: reportText,
  why: reportText
});
var WriterRewriteSchema = z7.strictObject({
  summary: reportText,
  verdict: z7.enum(["CLEAN", "MINOR", "HEAVY"]),
  changes: z7.array(WriterChangeSchema).optional(),
  rewritten: reportText.optional(),
  preserved: z7.array(reportText),
  openQuestions: z7.array(reportText).optional()
}).refine(
  (report) => report.changes === void 0 !== (report.rewritten === void 0),
  "rewrite reports must contain either file changes or inline rewritten text"
);
var WriterAuthorSchema = z7.strictObject({
  summary: reportText,
  whatWasChanged: z7.array(reportText.max(256)).min(1).max(5),
  whyWasItChanged: reportText,
  otsMaterials: reportText,
  openQuestions: z7.array(reportText).optional()
});
var ReportModeSchema = z7.union([
  z7.strictObject({ agent: z7.literal("code-implementation"), mode: z7.literal("implement") }),
  z7.strictObject({
    agent: z7.literal("code-implementation-escalated"),
    mode: z7.literal("implement")
  }),
  z7.strictObject({ agent: z7.literal("code-verifier"), mode: z7.literal("verify") }),
  z7.strictObject({
    agent: z7.literal("research-agent"),
    mode: z7.enum(["internal", "external", "mixed"])
  }),
  z7.strictObject({ agent: z7.literal("qa-engineer"), mode: z7.literal("reproduce") }),
  z7.strictObject({ agent: z7.literal("qa-engineer"), mode: z7.literal("verify") }),
  z7.strictObject({ agent: z7.literal("qa-engineer-verify"), mode: z7.literal("verify") }),
  z7.strictObject({ agent: z7.literal("tech-writer"), mode: z7.literal("feedback") }),
  z7.strictObject({ agent: z7.literal("tech-writer"), mode: z7.literal("rewrite") }),
  z7.strictObject({ agent: z7.literal("tech-writer"), mode: z7.literal("author") })
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
    return z7.string().transform((input, context) => {
      const blocks = [...input.matchAll(/```yaml\s*\r?\n([\s\S]*?)\r?\n```/gi)];
      const block = blocks.at(0);
      const before = block === void 0 ? "" : input.slice(0, block.index);
      const after = block === void 0 ? input : input.slice(block.index + block[0].length);
      if (blocks.length !== 1 || block === void 0 || after.trim() !== "" || before.trim() !== "" && mode.agent !== "research-agent" || before.includes("```")) {
        context.addIssue({
          code: "custom",
          message: "Return one final fenced YAML report; only research reports may have prose before it"
        });
        return z7.NEVER;
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
        return z7.NEVER;
      }
    }).pipe(JsonReportValueSchema).pipe(z7.preprocess((report) => report, this.schemaFor(mode)));
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

// src/sdk/deepagents/tool-policy.ts
import { createFilesystemMiddleware, createSubAgentMiddleware, StateBackend } from "deepagents";
import { createMiddleware } from "langchain";
import { z as z8 } from "zod";
var WorkerCapabilitySchema = z8.enum(["read", "edit", "shell", "web", "spawn", "ask"]);
var CapabilityToolDeniedPropsSchema = z8.strictObject({
  toolName: z8.string().min(1),
  capability: WorkerCapabilitySchema.optional()
});
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
    for (const tool2 of tools) {
      if (names.has(tool2.name))
        throw new InvalidDeepAgentsToolRegistrationError(`Duplicate host tool name: ${tool2.name}`);
      if (filesystemCapabilities.has(tool2.name)) {
        throw new InvalidDeepAgentsToolRegistrationError(
          `Host tools cannot replace reserved Deep Agents tool ${tool2.name}.`
        );
      }
      names.add(tool2.name);
    }
    return tools;
  }
  middlewareFor(model, definition, hostTools, trackExecution, onCapabilityDenied) {
    const permissions = new Set(definition.frontmatter.capabilities);
    const filesystemTools = [
      ...permissions.has("read") ? ["read_file", "ls", "glob", "grep"] : [],
      ...permissions.has("read") && permissions.has("edit") ? ["write_file", "edit_file", "delete"] : []
    ];
    const filesystem = !permissions.has("read") ? createMiddleware({ name: "FilesystemMiddleware" }) : createFilesystemMiddleware({ backend: new StateBackend(), tools: filesystemTools });
    const subagents = createSubAgentMiddleware({
      defaultModel: model,
      defaultTools: [],
      subagents: [],
      generalPurposeAgent: false
    });
    const allowedToolNames = /* @__PURE__ */ new Set([...hostTools.map((tool2) => tool2.name), ...filesystemTools]);
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
          const error = new CapabilityToolDeniedError({ toolName: name, capability });
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
var ModelInstancesSchema = z9.strictObject({
  standard: z9.instanceof(BaseChatModel),
  escalated: z9.instanceof(BaseChatModel),
  expert: z9.instanceof(BaseChatModel)
});
var DeepAgentsRuntimePropsSchema = z9.strictObject({
  agents: z9.array(AgentDefinitionSchema).min(1),
  models: ModelInstancesSchema,
  toolGrants: z9.record(
    z9.string(),
    z9.array(
      z9.custom(
        (value) => typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "invoke" in value && typeof value.invoke === "function"
      )
    )
  ),
  observe: z9.custom(
    (value) => typeof value === "function"
  ),
  maxGraphSteps: z9.int().positive().default(64)
});
var DeepAgentsConfigurationError = class extends Error {
  name = "DeepAgentsConfigurationError";
};
var LangChainDeepAgentsWorkerRuntime = class {
  agents;
  models;
  toolGrants;
  observe;
  maxGraphSteps;
  toolPolicy = new CapabilityScopedDeepAgentsToolPolicy();
  reports = new WorkerReportCodec();
  activeExecutions = /* @__PURE__ */ new Map();
  constructor(props) {
    const parsed = DeepAgentsRuntimePropsSchema.safeParse(props);
    if (!parsed.success) {
      throw new DeepAgentsConfigurationError(parsed.error.message);
    }
    this.agents = parsed.data.agents.map((agent) => AgentDefinitionSchema.parse(agent));
    this.models = Object.freeze({ ...parsed.data.models });
    this.toolGrants = parsed.data.toolGrants;
    this.observe = parsed.data.observe;
    this.maxGraphSteps = parsed.data.maxGraphSteps;
    const tiers = new Set(this.agents.map((agent) => agent.frontmatter.model));
    for (const tier of tiers) {
      if (this.models[tier] === void 0) {
        throw new DeepAgentsConfigurationError(`No model instance is bound for the ${tier} tier.`);
      }
    }
  }
  async dispatch(request, options = {}) {
    const [outcome] = await this.dispatchMany([request], { maxConcurrent: 1, ...options });
    if (outcome === void 0)
      throw new DeepAgentsConfigurationError("Single dispatch completed without an outcome.");
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
          const run = Promise.resolve().then(() => this.runGraph(admission, snapshot, controller.signal)).then((outcome) => {
            const handoff = queue.settle(
              admission.request.id,
              outcome,
              z9.record(z9.string(), z9.json())
            );
            if (handoff.status === "accepted") {
              settledOutcomes.set(admission.request.id, outcome);
            }
          }).catch((cause) => {
            const failure = this.executionFailure(cause, controller.signal);
            const outcome = {
              status: "failed",
              dispatchId: admission.request.id,
              agent: admission.request.agent,
              context: admission.request.context,
              failure
            };
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
          active.set(admission.request.id, { reservation, promise: run });
          this.activeExecutions.set(reservation, run);
          continue;
        }
        if (admission.status === "unavailable") {
          settledOutcomes.set(admission.outcome.dispatchId, admission.outcome);
          continue;
        }
        if (admission.status === "complete") break;
        if (active.size === 0) {
          throw new DeepAgentsConfigurationError(
            "The dispatch queue is waiting without an active graph."
          );
        }
        await Promise.race([...active.values()].map((entry) => entry.promise));
      }
    } finally {
      options.signal?.removeEventListener("abort", cancelActive);
    }
    const outcomes = queue.results();
    if (outcomes === void 0)
      throw new DeepAgentsConfigurationError(
        "Dispatch stopped before all requests had named outcomes."
      );
    const orderedOutcomes = [];
    for (const outcome of outcomes) {
      if (outcome.status !== "completed") {
        orderedOutcomes.push(outcome);
        continue;
      }
      const settledOutcome = settledOutcomes.get(outcome.dispatchId);
      if (settledOutcome === void 0) {
        throw new DeepAgentsConfigurationError(
          `Completed dispatch ${outcome.dispatchId} lost its validated report handoff.`
        );
      }
      orderedOutcomes.push(settledOutcome);
    }
    return orderedOutcomes;
  }
  async runGraph(admission, snapshot, signal) {
    const { request, definition } = admission;
    const parsedMode = ReportModeSchema.safeParse({
      agent: request.agent,
      mode: request.input.mode
    });
    if (!parsedMode.success) {
      return {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: {
          code: "INVALID_REPORT",
          message: parsedMode.error.message,
          remedy: "Choose a report mode supported by the named worker registration before dispatch."
        }
      };
    }
    const mode = parsedMode.data;
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
        { name: hostTool.name, description: hostTool.description, schema: hostTool.schema }
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
    const prompt = [
      definition.body.trim(),
      "## Dispatch context",
      JSON.stringify(request.context),
      "## Dispatch input",
      JSON.stringify(request.input),
      `Return the canonical final fenced YAML report for mode ${mode.mode}.`
    ].join("\n\n");
    let result;
    try {
      result = await graph.invoke(
        { messages: [new HumanMessage(prompt)] },
        { recursionLimit: this.maxGraphSteps, signal, callbacks: [modelTracker] }
      );
    } catch (cause) {
      if (capabilityFailure !== void 0) {
        return {
          status: "failed",
          dispatchId: request.id,
          agent: request.agent,
          context: request.context,
          failure: this.executionFailure(capabilityFailure, signal)
        };
      }
      throw cause;
    } finally {
      await modelTracker.waitForIdle();
    }
    if (signal.aborted) {
      return {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: {
          code: "CANCELLED",
          message: "The caller cancelled this worker and graph execution has stopped.",
          remedy: "Start a new invocation only when the caller chooses to resume."
        }
      };
    }
    const finalMessage = result.messages.toReversed().find((message) => isAIMessage(message));
    if (finalMessage === void 0 || typeof finalMessage.content !== "string") {
      throw new DeepAgentsConfigurationError("Deep Agents returned no final text report.");
    }
    let report;
    try {
      report = this.reports.parse(finalMessage.content, mode);
    } catch (cause) {
      const rejected = {
        code: "INVALID_REPORT",
        message: cause instanceof Error ? cause.message : String(cause),
        remedy: "Obtain a final report matching the named worker mode; do not infer success from tool activity."
      };
      return {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: rejected
      };
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
    if (signal.aborted) {
      return {
        code: "CANCELLED",
        message: "The caller cancelled this worker and graph execution has stopped.",
        remedy: "Start a new invocation only when the caller chooses to resume."
      };
    }
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
};
export {
  CapabilityToolDeniedError,
  DeepAgentsConfigurationError,
  CapabilityScopedDeepAgentsToolPolicy as DeepAgentsToolPolicy,
  LangChainDeepAgentsWorkerRuntime as DeepAgentsWorkerRuntime,
  InvalidDeepAgentsToolRegistrationError,
  flightRulesAbortSignalConfigKey
};
