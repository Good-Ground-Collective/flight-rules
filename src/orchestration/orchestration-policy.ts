import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AgentDefinitionSchema } from "../agents/agent-emitter/agent-emitter.schema.js";
import type { AgentDefinition } from "../agents/agent-registry/agent-registry.js";
import {
  DispatchRequestSchema,
  QuestionRequestSchema,
  RuntimeSnapshotSchema,
  SiblingSkillRequestSchema,
  type DispatchRequest,
  type OrchestrationFailure,
  type QuestionRequest,
  type RuntimeSnapshot,
  type SiblingSkillRequest,
} from "./orchestration.schema.js";

const RegistryOrchestrationPolicyPropsSchema = z.strictObject({
  agents: z
    .array(AgentDefinitionSchema)
    .min(1)
    .refine(
      (agents) => new Set(agents.map((agent) => agent.frontmatter.name)).size === agents.length,
      "duplicate agent name",
    ),
});
export type DispatchDecision =
  | { status: "ready"; request: DispatchRequest; definition: AgentDefinition }
  | { status: "unavailable"; failure: OrchestrationFailure };
export type QuestionDecision =
  | { status: "awaiting-answer"; request: QuestionRequest }
  | { status: "unavailable"; failure: OrchestrationFailure };

export interface OrchestrationPolicy {
  prepare(request: DispatchRequest, runtime: RuntimeSnapshot): DispatchDecision;
  ask(request: QuestionRequest, runtime: RuntimeSnapshot): QuestionDecision;
  sibling(request: SiblingSkillRequest): SiblingSkillRequest;
}

/** Plans native dispatch from registry names and scoped evidence without executing tools or granting permissions. */
export class RegistryOrchestrationPolicy implements OrchestrationPolicy {
  private readonly agents: Map<string, AgentDefinition>;

  constructor(props: z.infer<typeof RegistryOrchestrationPolicyPropsSchema>) {
    this.agents = new Map(
      RegistryOrchestrationPolicyPropsSchema.parse(props).agents.map((agent) => [
        agent.frontmatter.name,
        agent,
      ]),
    );
  }

  prepare(request: DispatchRequest, runtime: RuntimeSnapshot): DispatchDecision {
    const input = DispatchRequestSchema.parse(request);
    const snapshot = RuntimeSnapshotSchema.parse(runtime);
    const definition = this.agents.get(input.agent);
    if (definition === undefined) {
      return {
        status: "unavailable",
        failure: {
          code: "UNKNOWN_AGENT",
          message: `No registered agent named ${input.agent}.`,
          remedy: "Install or load the named registration before dispatch.",
        },
      };
    }
    if (!isDeepStrictEqual(input.context, snapshot.context) || snapshot.agent !== input.agent) {
      return {
        status: "unavailable",
        failure: {
          code: "CONTEXT_MISMATCH",
          message: "Runtime evidence belongs to another context or worker.",
          remedy:
            "Observe effective access for this named worker in this task, checkout and attempt.",
        },
      };
    }
    if (
      definition.frontmatter.sandbox !== undefined ||
      definition.frontmatter.dispatch !== undefined
    ) {
      return {
        status: "unavailable",
        failure: {
          code: "UNSUPPORTED_AGENT_SETTINGS",
          message:
            "Explicit worker sandbox or dispatch restrictions need an enforcing runtime binding.",
          remedy:
            "Provide an adapter that can enforce the declared restrictions before dispatch; do not drop them.",
        },
      };
    }
    if (snapshot.spawn.state !== "available") {
      return {
        status: "unavailable",
        failure: {
          code: "DISPATCH_UNAVAILABLE",
          capability: "spawn",
          message: snapshot.spawn.evidence,
          remedy: snapshot.spawn.remedy,
        },
      };
    }

    const { maxConcurrent, activeWorkers, currentDepth, maxDepth } = snapshot.limits;
    if (maxConcurrent === null || maxDepth === null) {
      return {
        status: "unavailable",
        failure: {
          code: "LIMITS_UNKNOWN",
          message: "Concurrency or nesting capacity has not been established.",
          remedy:
            "Read the host limits or provide a documented conservative adapter bound with its provenance.",
        },
      };
    }
    if (currentDepth >= maxDepth) {
      return {
        status: "unavailable",
        failure: {
          code: "DEPTH_EXCEEDED",
          message: `A child at depth ${currentDepth + 1} exceeds the bound ${maxDepth}.`,
          remedy: "Invoke orchestration in a supported caller context with remaining worker depth.",
        },
      };
    }
    if (activeWorkers >= maxConcurrent) {
      return {
        status: "unavailable",
        failure: {
          code: "CAPACITY_EXHAUSTED",
          message: `All ${maxConcurrent} worker slots are occupied or disabled.`,
          remedy:
            "Wait for a worker to finish, refresh current usage, then plan the remaining work.",
        },
      };
    }

    const required = new Set([
      ...definition.frontmatter.capabilities,
      ...(input.requiredCapabilities ?? []),
    ]);
    for (const capability of required) {
      const permission = snapshot.permissions[capability];
      if (permission === undefined || permission.state !== "available") {
        return {
          status: "unavailable",
          failure: {
            code: permission?.state === "denied" ? "CAPABILITY_DENIED" : "CAPABILITY_UNKNOWN",
            capability,
            message:
              permission?.evidence ?? `No effective worker access evidence for ${capability}.`,
            remedy:
              permission?.remedy ??
              `Establish ${capability} access for this worker and working directory before dispatch.`,
          },
        };
      }
    }
    return { status: "ready", request: input, definition: AgentDefinitionSchema.parse(definition) };
  }

  ask(request: QuestionRequest, runtime: RuntimeSnapshot): QuestionDecision {
    const input = QuestionRequestSchema.parse(request);
    const snapshot = RuntimeSnapshotSchema.parse(runtime);
    if (!isDeepStrictEqual(input.context, snapshot.context)) {
      return {
        status: "unavailable",
        failure: {
          code: "CONTEXT_MISMATCH",
          message: "Question capability evidence belongs to another caller context.",
          remedy: "Refresh capability evidence for this caller before asking.",
        },
      };
    }
    if (!input.allowHumanQuestions) {
      return {
        status: "unavailable",
        failure: {
          code: "QUESTIONS_DISABLED",
          capability: "ask",
          message: "This invocation is unattended or has not opted into human questions.",
          remedy: "Return the unresolved question to the caller as a named failure; do not prompt.",
        },
      };
    }
    if (snapshot.ask.state !== "available") {
      return {
        status: "unavailable",
        failure: {
          code: "QUESTIONS_UNAVAILABLE",
          capability: "ask",
          message: snapshot.ask.evidence,
          remedy: snapshot.ask.remedy,
        },
      };
    }
    return { status: "awaiting-answer", request: input };
  }

  sibling(request: SiblingSkillRequest): SiblingSkillRequest {
    return SiblingSkillRequestSchema.parse(request);
  }
}
