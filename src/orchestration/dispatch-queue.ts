import { z } from "zod";
import { AgentDefinitionSchema } from "../agents/agent-emitter/agent-emitter.schema.js";
import { RegistryOrchestrationPolicy, type DispatchDecision } from "./orchestration-policy.js";
import {
  DispatchRequestSchema,
  RuntimeSnapshotSchema,
  type DispatchOutcome,
  type DispatchRequest,
  type RuntimeSnapshot,
} from "./orchestration.schema.js";
import { ValidatedReportHandoff, type ReportHandoffResult } from "./report-handoff.js";

const DispatchQueuePropsSchema = z.strictObject({
  agents: z.array(AgentDefinitionSchema).min(1),
  requests: z
    .array(DispatchRequestSchema)
    .refine(
      (requests) => new Set(requests.map((request) => request.id)).size === requests.length,
      "dispatch IDs must be unique",
    ),
  maxConcurrent: z.int().positive(),
});
const ObservedDispatchIdsSchema = z
  .array(z.string().min(1))
  .refine((ids) => new Set(ids).size === ids.length, "observed dispatch IDs must be unique");
export type DispatchAdmission =
  | Extract<DispatchDecision, { status: "ready" }>
  | { status: "unavailable"; outcome: DispatchOutcome<never> }
  | { status: "waiting"; dispatchIds: string[] }
  | { status: "complete"; outcomes: DispatchOutcome<unknown>[] };

export interface DispatchQueue {
  pending(): DispatchRequest | undefined;
  admit(runtime: RuntimeSnapshot, observedDispatchIds: string[]): DispatchAdmission;
  settle<T>(dispatchId: string, outcome: unknown, schema: z.ZodType<T>): ReportHandoffResult<T>;
  cancel(): void;
  results(): DispatchOutcome<unknown>[] | undefined;
}

export class InvalidDispatchQueueStateError extends Error {
  override name = "InvalidDispatchQueueStateError";
}

/** Reserves slots synchronously; native adapters execute requests and acknowledge released host capacity. */
export class BoundedDispatchQueue implements DispatchQueue {
  private readonly policy: RegistryOrchestrationPolicy;
  private readonly reports = new ValidatedReportHandoff();
  private readonly requests: DispatchRequest[];
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, DispatchRequest>();
  private readonly outcomes = new Map<string, DispatchOutcome<unknown>>();
  private cursor = 0;
  private batchSealed = false;

  constructor(props: z.infer<typeof DispatchQueuePropsSchema>) {
    const input = DispatchQueuePropsSchema.parse(props);
    this.policy = new RegistryOrchestrationPolicy({ agents: input.agents });
    this.requests = input.requests;
    this.maxConcurrent = input.maxConcurrent;
  }

  pending(): DispatchRequest | undefined {
    const request = this.requests[this.cursor];
    return request === undefined ? undefined : DispatchRequestSchema.parse(request);
  }

  admit(runtime: RuntimeSnapshot, observedDispatchIds: string[]): DispatchAdmission {
    const complete = this.results();
    if (complete !== undefined) return { status: "complete", outcomes: complete };
    if (
      this.active.size > 0 &&
      (this.batchSealed ||
        this.active.size >= this.maxConcurrent ||
        this.cursor === this.requests.length)
    ) {
      this.batchSealed = true;
      return { status: "waiting", dispatchIds: [...this.active.keys()] };
    }
    const request = this.pending();
    if (request === undefined)
      throw new InvalidDispatchQueueStateError("Unsettled queue has no pending or active requests");
    const snapshot = RuntimeSnapshotSchema.parse(runtime);
    const observed = ObservedDispatchIdsSchema.parse(observedDispatchIds);
    if (
      observed.some((id) => !this.active.has(id)) ||
      observed.length > snapshot.limits.activeWorkers
    ) {
      throw new InvalidDispatchQueueStateError(
        "Observed local dispatches must be active reservations included in the host worker count",
      );
    }

    const unobservedReservations = this.active.size - observed.length;
    const decision = this.policy.prepare(request, {
      ...snapshot,
      limits: {
        ...snapshot.limits,
        activeWorkers: snapshot.limits.activeWorkers + unobservedReservations,
      },
    });
    if (
      decision.status === "unavailable" &&
      decision.failure.code === "CAPACITY_EXHAUSTED" &&
      this.active.size > 0
    ) {
      this.batchSealed = true;
      return { status: "waiting", dispatchIds: [...this.active.keys()] };
    }

    this.cursor++;
    if (decision.status === "unavailable") {
      const outcome: DispatchOutcome<never> = {
        status: "unavailable",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: decision.failure,
      };
      this.outcomes.set(request.id, structuredClone(outcome));
      return { status: "unavailable", outcome };
    }
    this.active.set(request.id, DispatchRequestSchema.parse(request));
    if (this.active.size === this.maxConcurrent) this.batchSealed = true;
    return decision;
  }

  settle<T>(dispatchId: string, outcome: unknown, schema: z.ZodType<T>): ReportHandoffResult<T> {
    const request = this.active.get(dispatchId);
    if (request === undefined)
      throw new InvalidDispatchQueueStateError(`No active reservation for ${dispatchId}`);
    const result = this.reports.accept(request, outcome, schema);
    if (result.status === "rejected") return result;

    this.outcomes.set(dispatchId, structuredClone(result.outcome));
    this.active.delete(dispatchId);
    this.batchSealed = this.active.size > 0;
    return result;
  }

  cancel(): void {
    for (const request of this.requests.slice(this.cursor)) {
      this.outcomes.set(request.id, {
        status: "failed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        failure: {
          code: "CANCELLED",
          message: "The caller cancelled queued work before dispatch.",
          remedy: "Start a new invocation only when the caller chooses to resume.",
        },
      });
    }
    this.cursor = this.requests.length;
    this.batchSealed = this.active.size > 0;
  }

  results(): DispatchOutcome<unknown>[] | undefined {
    if (this.outcomes.size !== this.requests.length) return undefined;
    return this.requests.map((request) => {
      const outcome = this.outcomes.get(request.id);
      if (outcome === undefined)
        throw new InvalidDispatchQueueStateError(`Missing terminal outcome for ${request.id}`);
      return structuredClone(outcome);
    });
  }
}
