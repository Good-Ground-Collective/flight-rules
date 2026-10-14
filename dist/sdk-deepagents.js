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
    const filesystem = !permissions.has("read") ? createMiddleware({ name: "FilesystemMiddleware" }) : createFilesystemMiddleware({ backend: new StateBackend(), tools: filesystemTools });
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

// src/sdk/deepagents/skill-runtime.ts
import { randomUUID } from "node:crypto";
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
import { z as z10 } from "zod";
var SkillRuntimePropsSchema = z10.strictObject({
  instructions: z10.custom(
    (value) => typeof value === "object" && value !== null && "loadSkill" in value && typeof value.loadSkill === "function"
  ),
  agents: z10.array(AgentDefinitionSchema).min(1),
  models: z10.strictObject({
    standard: z10.instanceof(BaseChatModel2),
    escalated: z10.instanceof(BaseChatModel2),
    expert: z10.instanceof(BaseChatModel2)
  }),
  operations: z10.custom(
    (value) => typeof value === "object" && value !== null && "invoke" in value && typeof value.invoke === "function" && "list" in value && typeof value.list === "function"
  ),
  workers: z10.custom(
    (value) => typeof value === "object" && value !== null && "dispatch" in value && typeof value.dispatch === "function"
  ),
  observe: z10.custom((value) => typeof value === "function"),
  toolGrants: z10.custom(
    (value) => typeof value === "function"
  ),
  checkpointer: z10.custom(
    (value) => typeof value === "object" && value !== null && "getTuple" in value && typeof value.getTuple === "function"
  ).default(() => new MemorySaver()),
  maxGraphSteps: z10.int().positive().default(128)
});
var PartialOperationSchema = z10.strictObject({
  operationId: z10.string().min(1),
  status: z10.literal("partial"),
  data: z10.unknown(),
  error: z10.strictObject({ name: z10.string().min(1), message: z10.string() })
});
var PartialOperationFailurePropsSchema = z10.strictObject({
  operations: z10.array(PartialOperationSchema).min(1)
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
var InFlightSkillToolExecutionTracker = class {
  active = /* @__PURE__ */ new Set();
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
};
var InvalidSkillResumeError = class extends Error {
  name = "InvalidSkillResumeError";
};
var DeepAgentsSkillConfigurationError = class extends Error {
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
  pending = /* @__PURE__ */ new Map();
  siblingPauses = /* @__PURE__ */ new Map();
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
    this.orchestration = new RegistryOrchestrationPolicy({ agents: this.agents });
  }
  async invoke(skill, context, input, options = {}) {
    const caller = CallerContextSchema.parse(context);
    const invocationId = randomUUID();
    const threadId = randomUUID();
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
      await execution.tools.waitForIdle();
      if (execution.failure !== void 0) throw execution.failure;
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
      await execution?.tools.waitForIdle();
      const interruption = isGraphInterrupt(cause) ? z10.array(z10.object({ id: z10.string().optional(), value: z10.unknown() })).safeParse(cause.interrupts) : this.questionInterruptionFromError(cause);
      const question = interruption.success ? z10.object({ questionId: z10.string(), question: z10.string() }).safeParse(interruption.data[0]?.value) : void 0;
      if (question?.success === true && options.allowHumanQuestions === true) {
        if (isGraphInterrupt(cause)) {
          const pauseId = randomUUID();
          this.pending.set(pauseId, {
            context: caller,
            invocationId,
            pauseId,
            questionId: question.data.questionId,
            threadId,
            skill,
            allowHumanQuestions: true,
            state: "paused"
          });
          return {
            status: "paused",
            context: caller,
            invocationId,
            pauseId,
            questionId: question.data.questionId,
            question: question.data.question
          };
        }
      }
      return {
        status: "failed",
        context: caller,
        invocationId,
        failure: {
          code: options.signal?.aborted ? "CANCELLED" : execution?.failure === void 0 ? "EXECUTION_FAILED" : "TOOL_FAILED",
          message: execution?.failure instanceof Error ? execution.failure.message : cause instanceof Error ? cause.message : String(cause),
          ...execution !== void 0 && execution.partialOperations.length > 0 ? { operations: execution.partialOperations } : {}
        }
      };
    }
  }
  async resume(request) {
    const caller = CallerContextSchema.parse(request.context);
    const pending = this.pending.get(request.pauseId);
    if (pending === void 0 || pending.questionId !== request.questionId || JSON.stringify(pending.context) !== JSON.stringify(caller) || pending.state !== "paused") {
      throw new InvalidSkillResumeError(
        "The pause, question or caller context is missing, stale or does not match."
      );
    }
    if (request.answer.trim().length === 0)
      throw new InvalidSkillResumeError("A human answer is required to resume this question.");
    pending.state = "resuming";
    let execution;
    let continuationStarted = false;
    try {
      const snapshot = RuntimeSnapshotSchema.parse(await this.observe(caller));
      if (JSON.stringify(snapshot.context) !== JSON.stringify(caller) || snapshot.ask.state !== "available") {
        throw new InvalidSkillResumeError(
          "Fresh question access is unavailable for the original caller context."
        );
      }
      execution = await this.createGraph(
        pending.skill,
        caller,
        pending.allowHumanQuestions,
        pending.threadId
      );
      this.pending.delete(request.pauseId);
      continuationStarted = true;
      const result = await execution.graph.invoke(
        new Command({ resume: { questionId: request.questionId, answer: request.answer } }),
        {
          configurable: { thread_id: pending.threadId },
          recursionLimit: this.maxGraphSteps,
          ...request.signal === void 0 ? {} : { signal: request.signal }
        }
      );
      await execution.tools.waitForIdle();
      if (execution.failure !== void 0) throw execution.failure;
      return this.result(
        execution.graph,
        result,
        caller,
        pending.invocationId,
        pending.threadId,
        pending.skill,
        pending.allowHumanQuestions
      );
    } catch (cause) {
      await execution?.tools.waitForIdle();
      if (!continuationStarted && this.pending.get(request.pauseId) === pending) {
        pending.state = "paused";
      }
      return {
        status: "failed",
        context: caller,
        invocationId: pending.invocationId,
        failure: {
          code: request.signal?.aborted ? "CANCELLED" : execution?.failure === void 0 ? "EXECUTION_FAILED" : "TOOL_FAILED",
          message: execution?.failure instanceof Error ? execution.failure.message : cause instanceof Error ? cause.message : String(cause),
          ...execution !== void 0 && execution.partialOperations.length > 0 ? { operations: execution.partialOperations } : {}
        }
      };
    }
  }
  cancel(context, pauseId) {
    const caller = CallerContextSchema.parse(context);
    const pending = this.pending.get(pauseId);
    if (pending === void 0 || pending.state !== "paused" || JSON.stringify(pending.context) !== JSON.stringify(caller)) {
      throw new InvalidSkillResumeError(
        "The pause is missing or belongs to another caller context."
      );
    }
    this.pending.delete(pauseId);
    const sibling = this.siblingPauses.get(pending.threadId);
    if (sibling !== void 0) {
      this.siblingPauses.delete(pending.threadId);
      this.cancel(caller, sibling.pauseId);
    }
    return {
      status: "failed",
      context: caller,
      invocationId: pending.invocationId,
      failure: { code: "CANCELLED", message: "The caller cancelled this paused skill." }
    };
  }
  async createGraph(skill, context, allowHumanQuestions, threadId) {
    const instruction = this.instructions.loadSkill(skill);
    const observed = RuntimeSnapshotSchema.parse(await this.observe(context));
    if (JSON.stringify(observed.context) !== JSON.stringify(context))
      throw new DeepAgentsSkillConfigurationError(
        "Runtime evidence belongs to a different caller context."
      );
    const grants = this.toolGrants(context);
    let executionFailure;
    const partialOperations = [];
    const recordedPartialFailures = /* @__PURE__ */ new Set();
    const tools = new InFlightSkillToolExecutionTracker();
    let propagatingSiblingQuestion = false;
    const recordExecutionFailure = (cause) => {
      if (isGraphInterrupt(cause)) return;
      if (cause instanceof PartialOperationFailure && !recordedPartialFailures.has(cause)) {
        recordedPartialFailures.add(cause);
        partialOperations.push(...cause.operations);
      }
      executionFailure = cause instanceof Error ? cause : new Error(String(cause));
    };
    const rejectDependentWork = () => {
      if (executionFailure !== void 0) throw executionFailure;
    };
    const shared = [
      tool2(
        async ({ operationId, input }) => {
          rejectDependentWork();
          return tools.track(async () => {
            try {
              const descriptor = this.operations.list().find((entry) => entry.id === operationId);
              if (descriptor === void 0) throw new Error(`Unknown operation: ${operationId}`);
              const fresh = RuntimeSnapshotSchema.parse(await this.observe(context));
              if (JSON.stringify(fresh.context) !== JSON.stringify(context)) {
                throw new DeepAgentsSkillConfigurationError(
                  "Operation evidence belongs to a different caller context."
                );
              }
              for (const effect of descriptor.effects) {
                const capability = this.permissionForEffect(effect);
                if (fresh.permissions[capability]?.state !== "available") {
                  throw new CapabilityToolDeniedError({
                    toolName: `operation:${operationId}`,
                    capability
                  });
                }
              }
              const result = await this.operations.invoke(operationId, input);
              if (result.status === "partial") {
                throw new PartialOperationFailure({
                  operations: [
                    {
                      operationId,
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
              recordExecutionFailure(cause);
              throw cause;
            }
          });
        },
        {
          name: "flight_rules_operation",
          description: "Run a launch-authorized shared flight-rules operation.",
          schema: z10.object({ operationId: z10.string(), input: z10.record(z10.string(), z10.unknown()) })
        }
      ),
      tool2(
        async ({ agent, dispatchId, input }) => {
          rejectDependentWork();
          return tools.track(async () => {
            try {
              const request = DispatchRequestSchema.parse({
                id: dispatchId,
                agent,
                context,
                input
              });
              const registration = this.agents.find(
                (candidate) => candidate.frontmatter.name === request.agent
              );
              if (registration === void 0) {
                const decision2 = this.orchestration.prepare(request, observed);
                if (decision2.status !== "ready")
                  throw new Error(`${decision2.failure.code}: ${decision2.failure.message}`);
              }
              const fresh = RuntimeSnapshotSchema.parse(await this.observe(context, registration));
              if (JSON.stringify(fresh.context) !== JSON.stringify(context)) {
                throw new DeepAgentsSkillConfigurationError(
                  "Worker evidence belongs to a different caller context."
                );
              }
              const decision = this.orchestration.prepare(request, fresh);
              if (decision.status !== "ready")
                throw new Error(`${decision.failure.code}: ${decision.failure.message}`);
              const outcome = await this.workers.dispatch(request);
              if (outcome.status !== "completed") {
                throw new Error(`${outcome.failure.code}: ${outcome.failure.message}`);
              }
              return outcome;
            } catch (cause) {
              recordExecutionFailure(cause);
              throw cause;
            }
          });
        },
        {
          name: "flight_rules_dispatch",
          description: "Dispatch one registered named worker under observed host grants.",
          schema: z10.object({
            agent: z10.string(),
            dispatchId: z10.string(),
            input: z10.record(z10.string(), z10.json())
          })
        }
      ),
      tool2(
        async ({ siblingSkill, input }) => {
          rejectDependentWork();
          const sibling = this.orchestration.sibling({ context, skill: siblingSkill, input });
          const pausedSibling = this.siblingPauses.get(threadId);
          if (pausedSibling !== void 0) {
            return tools.track(() => this.resumeSibling(threadId, pausedSibling));
          }
          return tools.track(async () => {
            try {
              const result = await AsyncLocalStorageProviderSingleton.getInstance().run(
                void 0,
                () => this.invoke(sibling.skill, sibling.context, sibling.input, {
                  allowHumanQuestions
                })
              );
              if (result.status === "paused") {
                this.siblingPauses.set(threadId, result);
                propagatingSiblingQuestion = true;
                return await this.resumeSibling(threadId, result);
              }
              if (result.status === "failed") {
                if (result.failure.operations !== void 0) {
                  throw new PartialOperationFailure({ operations: result.failure.operations });
                }
                throw new Error(result.failure.message);
              }
              return result;
            } catch (cause) {
              if (!propagatingSiblingQuestion && !isGraphInterrupt(cause)) {
                recordExecutionFailure(cause);
              }
              throw cause;
            }
          });
        },
        {
          name: "flight_rules_sibling_skill",
          description: "Invoke another canonical skill with this same caller context.",
          schema: z10.object({ siblingSkill: z10.string(), input: z10.record(z10.string(), z10.unknown()) })
        }
      )
    ];
    shared.push(
      tool2(
        async ({ question }) => {
          const questionId = randomUUID();
          const fresh = RuntimeSnapshotSchema.parse(await this.observe(context));
          const decision = this.orchestration.ask(
            { context, question, allowHumanQuestions },
            fresh
          );
          if (decision.status !== "awaiting-answer") {
            executionFailure = new Error(`${decision.failure.code}: ${decision.failure.message}`);
            throw executionFailure;
          }
          const answer = interrupt({ questionId, question });
          return answer;
        },
        {
          name: "flight_rules_ask_human",
          description: "Pause this skill and wait for an actual answer from the human caller.",
          schema: z10.object({ question: z10.string().min(1) })
        }
      )
    );
    const model = this.models.standard;
    const skillDefinition = {
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
    const suppliedHostTools = this.policy.toolsFor(skillDefinition, grants, observed);
    const trackToolExecution = async (execution) => tools.track(async () => {
      try {
        rejectDependentWork();
        return await execution();
      } catch (cause) {
        recordExecutionFailure(cause);
        throw cause;
      }
    });
    const subagents = this.policy.middlewareFor(
      model,
      skillDefinition,
      suppliedHostTools,
      trackToolExecution,
      (error) => {
        recordExecutionFailure(error);
      },
      shared.map((entry) => entry.name)
    );
    const questionBoundary = createMiddleware2({
      name: "FlightRulesQuestionBoundary",
      wrapModelCall: async (request, handler) => {
        const response = await handler(request);
        const calls = response.tool_calls ?? [];
        const question = calls.find((call) => call.name === "flight_rules_ask_human");
        const boundary = question ?? calls.find((call) => call.name === "flight_rules_sibling_skill");
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
      get failure() {
        return executionFailure;
      },
      partialOperations,
      tools
    };
  }
  permissionForEffect(effect) {
    switch (effect) {
      case "read":
        return "read";
      case "write":
        return "edit";
      case "process":
        return "shell";
      case "network":
        return "web";
    }
  }
  resumeSibling(threadId, paused) {
    const answerValue = interrupt({ questionId: paused.questionId, question: paused.question });
    const answer = z10.object({ questionId: z10.string(), answer: z10.string() }).parse(answerValue);
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
        this.siblingPauses.set(threadId, result);
        return this.resumeSibling(threadId, result);
      }
      this.siblingPauses.delete(threadId);
      if (result.status === "failed") {
        if (result.failure.operations !== void 0) {
          throw new PartialOperationFailure({ operations: result.failure.operations });
        }
        throw new Error(result.failure.message);
      }
      return result;
    });
  }
  questionInterruptionFromError(cause) {
    const schema = z10.array(z10.object({ id: z10.string().optional(), value: z10.unknown() }));
    if (!(cause instanceof Error)) return schema.safeParse(null);
    try {
      return schema.safeParse(JSON.parse(cause.message));
    } catch {
      return schema.safeParse(null);
    }
  }
  result(graph, result, context, invocationId, threadId, skill, allowHumanQuestions) {
    const graphResult = z10.record(z10.string(), z10.unknown()).parse(result);
    const messages = z10.array(z10.instanceof(BaseMessage)).parse(graphResult["messages"]);
    const interruptions = z10.array(z10.object({ value: z10.unknown() })).safeParse(graphResult["__interrupt__"]);
    const task = interruptions.success ? interruptions.data[0] : void 0;
    const question = task === void 0 ? void 0 : z10.object({ questionId: z10.string(), question: z10.string() }).safeParse(task.value);
    if (question?.success === true) {
      const pauseId = randomUUID();
      const value = question.data;
      this.pending.set(pauseId, {
        context,
        invocationId,
        pauseId,
        questionId: value.questionId,
        threadId,
        skill,
        allowHumanQuestions,
        state: "paused"
      });
      return {
        status: "paused",
        context,
        invocationId,
        pauseId,
        questionId: value.questionId,
        question: value.question
      };
    }
    const finalMessage = messages.toReversed().find((message) => isAIMessage2(message));
    return { status: "completed", context, invocationId, report: finalMessage?.content ?? "" };
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
