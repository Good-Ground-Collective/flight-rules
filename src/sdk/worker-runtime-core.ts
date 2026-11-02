import { z } from "zod";
import { AgentDefinitionSchema } from "../agents/agent-emitter/agent-emitter.schema.js";
import type { AgentDefinition } from "../agents/agent-registry/agent-registry.js";
import { BoundedDispatchQueue } from "../orchestration/dispatch-queue.js";
import {
  RuntimeSnapshotSchema,
  DispatchRequestSchema,
  type DispatchOutcome,
  type DispatchRequest,
  type OrchestrationFailure,
  type RuntimeSnapshot,
} from "../orchestration/orchestration.schema.js";
import {
  WorkerReportCodec,
  ReportModeSchema,
  type ReportMode,
  type ValidatedWorkerReport,
} from "./report-codec.js";

export const WorkerCapabilitySchema = z.enum(["read", "edit", "shell", "web", "spawn", "ask"]);
export type WorkerCapability = z.infer<typeof WorkerCapabilitySchema>;

const CapabilityToolDeniedPropsSchema = z.strictObject({
  toolName: z.string().min(1),
  capability: WorkerCapabilitySchema.optional(),
});

export class CapabilityToolDeniedError extends Error {
  override name = "CapabilityToolDeniedError";
  readonly capability: WorkerCapability | undefined;

  constructor(props: z.input<typeof CapabilityToolDeniedPropsSchema>) {
    const parsed = CapabilityToolDeniedPropsSchema.parse(props);
    super(
      parsed.capability === undefined
        ? `The worker attempted unregistered tool ${parsed.toolName}.`
        : `The worker attempted ${parsed.toolName} without an effective ${parsed.capability} grant.`,
    );
    this.capability = parsed.capability;
  }
}

export class WorkerDispatchConfigurationError extends Error {
  override name = "WorkerDispatchConfigurationError";
}

export interface DispatchOptions {
  signal?: AbortSignal;
}

export interface BatchDispatchOptions extends DispatchOptions {
  maxConcurrent: number;
}

export interface WorkerRuntimeContract {
  dispatch(
    request: DispatchRequest,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>>;
  dispatchMany(
    requests: DispatchRequest[],
    options: BatchDispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>[]>;
}

export type AdmittedDispatch = Extract<
  ReturnType<BoundedDispatchQueue["admit"]>,
  { status: "ready" }
>;

export type WorkerRunCallback = (
  admission: AdmittedDispatch,
  snapshot: RuntimeSnapshot,
  signal: AbortSignal,
) => Promise<DispatchOutcome<ValidatedWorkerReport>>;

export type PreparedWorkerRun =
  | { status: "ready"; mode: ReportMode; prompt: string }
  | { status: "rejected"; outcome: DispatchOutcome<ValidatedWorkerReport> };

/** Report-mode parsing, prompt assembly and failure mapping shared by every worker runtime binding. */
export interface WorkerRunProtocol {
  prepare(admission: AdmittedDispatch): PreparedWorkerRun;
  cancelled(request: DispatchRequest): DispatchOutcome<ValidatedWorkerReport>;
  failed(
    request: DispatchRequest,
    failure: OrchestrationFailure,
  ): DispatchOutcome<ValidatedWorkerReport>;
  finish(
    request: DispatchRequest,
    finalText: string,
    mode: ReportMode,
  ): DispatchOutcome<ValidatedWorkerReport>;
  executionFailure(cause: unknown, signal: AbortSignal): OrchestrationFailure;
}

export class StandardWorkerRunProtocol implements WorkerRunProtocol {
  private readonly reports = new WorkerReportCodec();

  prepare(admission: AdmittedDispatch): PreparedWorkerRun {
    const { request, definition } = admission;
    const parsedMode = ReportModeSchema.safeParse({
      agent: request.agent,
      mode: request.input.mode,
    });
    if (!parsedMode.success) {
      return {
        status: "rejected",
        outcome: this.failed(request, {
          code: "INVALID_REPORT",
          message: parsedMode.error.message,
          remedy:
            "Choose a report mode supported by the named worker registration before dispatch.",
        }),
      };
    }

    const mode = parsedMode.data;
    const prompt = [
      definition.body.trim(),
      "## Dispatch context",
      JSON.stringify(request.context),
      "## Dispatch input",
      JSON.stringify(request.input),
      `Return the canonical final fenced YAML report for mode ${mode.mode}.`,
    ].join("\n\n");
    return { status: "ready", mode, prompt };
  }

  cancelled(request: DispatchRequest): DispatchOutcome<ValidatedWorkerReport> {
    return this.failed(request, this.cancellationFailure());
  }

  failed(
    request: DispatchRequest,
    failure: OrchestrationFailure,
  ): DispatchOutcome<ValidatedWorkerReport> {
    return {
      status: "failed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      failure,
    };
  }

  finish(
    request: DispatchRequest,
    finalText: string,
    mode: ReportMode,
  ): DispatchOutcome<ValidatedWorkerReport> {
    let report: ValidatedWorkerReport;
    try {
      report = this.reports.parse(finalText, mode);
    } catch (cause) {
      return this.failed(request, {
        code: "INVALID_REPORT",
        message: cause instanceof Error ? cause.message : String(cause),
        remedy:
          "Obtain a final report matching the named worker mode; do not infer success from tool activity.",
      });
    }
    return {
      status: "completed",
      dispatchId: request.id,
      agent: request.agent,
      context: request.context,
      report,
    };
  }

  executionFailure(cause: unknown, signal: AbortSignal): OrchestrationFailure {
    if (signal.aborted) return this.cancellationFailure();
    if (cause instanceof CapabilityToolDeniedError) {
      const capability = cause.capability;
      return {
        code: capability === undefined ? "CAPABILITY_UNKNOWN" : "CAPABILITY_DENIED",
        capability,
        message: cause.message,
        remedy: "Refresh effective host grants and provide only tools the host can enforce.",
      };
    }
    return {
      code: "EXECUTION_FAILED",
      message: cause instanceof Error ? cause.message : String(cause),
      remedy: "Inspect the provider or host tool failure, then retry only when the caller chooses.",
    };
  }

  private cancellationFailure(): OrchestrationFailure {
    return {
      code: "CANCELLED",
      message: "The caller cancelled this worker and graph execution has stopped.",
      remedy: "Start a new invocation only when the caller chooses to resume.",
    };
  }
}

export const workerRunProtocol: WorkerRunProtocol = new StandardWorkerRunProtocol();

const QueuedWorkerDispatcherPropsSchema = z.strictObject({
  agents: z.array(AgentDefinitionSchema).min(1),
  observe: z.custom<(request: DispatchRequest) => Promise<RuntimeSnapshot>>(
    (value) => typeof value === "function",
  ),
  run: z.custom<WorkerRunCallback>((value) => typeof value === "function"),
  createError: z.custom<(message: string) => Error>((value) => typeof value === "function"),
});

export type QueuedWorkerDispatcherProps = z.input<typeof QueuedWorkerDispatcherPropsSchema>;

/** Admits, observes, queues and settles worker dispatches under current host evidence; the binding supplies only how one admitted worker runs. */
export class QueuedWorkerDispatcher implements WorkerRuntimeContract {
  private readonly agents: AgentDefinition[];
  private readonly observe: (request: DispatchRequest) => Promise<RuntimeSnapshot>;
  private readonly run: WorkerRunCallback;
  private readonly createError: (message: string) => Error;
  private readonly activeExecutions = new Map<symbol, Promise<void>>();

  constructor(props: QueuedWorkerDispatcherProps) {
    const parsed = QueuedWorkerDispatcherPropsSchema.parse(props);
    this.agents = parsed.agents;
    this.observe = parsed.observe;
    this.run = parsed.run;
    this.createError = parsed.createError;
  }

  async dispatch(
    request: DispatchRequest,
    options: DispatchOptions = {},
  ): Promise<DispatchOutcome<ValidatedWorkerReport>> {
    const [outcome] = await this.dispatchMany([request], {
      maxConcurrent: 1,
      ...options,
    });
    if (outcome === undefined)
      throw this.createError("Single dispatch completed without an outcome.");
    return outcome;
  }

  async dispatchMany(
    requests: DispatchRequest[],
    options: BatchDispatchOptions,
  ): Promise<DispatchOutcome<ValidatedWorkerReport>[]> {
    const validatedRequests = z.array(DispatchRequestSchema).parse(requests);
    const queue = new BoundedDispatchQueue({
      agents: this.agents,
      requests: validatedRequests,
      maxConcurrent: options.maxConcurrent,
    });
    const active = new Map<string, { reservation: symbol; promise: Promise<void> }>();
    const controllers = new Map<string, AbortController>();
    const settledOutcomes = new Map<string, DispatchOutcome<ValidatedWorkerReport>>();
    let wakeCancellationWait!: () => void;
    const cancellationWait = new Promise<void>((resolve) => {
      wakeCancellationWait = resolve;
    });
    const cancelActive = () => {
      wakeCancellationWait();
      queue.cancel();
      for (const controller of controllers.values()) controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", cancelActive, { once: true });

    try {
      while (queue.results() === undefined) {
        if (options.signal?.aborted) cancelActive();

        const next = queue.pending();
        if (next === undefined) {
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
        const refreshedSnapshot: RuntimeSnapshot = {
          ...snapshot,
          limits: {
            ...snapshot.limits,
            activeWorkers: snapshot.limits.activeWorkers + foreignReservations,
          },
        };
        if (
          active.size === 0 &&
          foreignReservations > 0 &&
          snapshot.limits.maxConcurrent !== null &&
          refreshedSnapshot.limits.activeWorkers >= snapshot.limits.maxConcurrent
        ) {
          await Promise.race([Promise.race(this.activeExecutions.values()), cancellationWait]);
          continue;
        }
        const admission = queue.admit(refreshedSnapshot, []);
        if (admission.status === "ready") {
          const controller = new AbortController();
          controllers.set(admission.request.id, controller);
          const reservation = Symbol(admission.request.id);
          const run = Promise.resolve()
            .then(() => this.run(admission, snapshot, controller.signal))
            .then((outcome) => {
              const handoff = queue.settle(
                admission.request.id,
                outcome,
                z.record(z.string(), z.json()),
              );
              if (handoff.status === "accepted") {
                settledOutcomes.set(admission.request.id, outcome);
              }
            })
            .catch((cause: unknown) => {
              const outcome = workerRunProtocol.failed(
                admission.request,
                workerRunProtocol.executionFailure(cause, controller.signal),
              );
              const handoff = queue.settle(
                admission.request.id,
                outcome,
                z.record(z.string(), z.json()),
              );
              if (handoff.status === "accepted") {
                settledOutcomes.set(admission.request.id, outcome);
              }
            })
            .finally(() => {
              controllers.delete(admission.request.id);
              active.delete(admission.request.id);
              this.activeExecutions.delete(reservation);
            });
          active.set(admission.request.id, {
            reservation,
            promise: run,
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
    if (outcomes === undefined)
      throw this.createError("Dispatch stopped before all requests had named outcomes.");
    const orderedOutcomes: DispatchOutcome<ValidatedWorkerReport>[] = [];
    for (const outcome of outcomes) {
      if (outcome.status !== "completed") {
        orderedOutcomes.push(outcome);
        continue;
      }
      const settledOutcome = settledOutcomes.get(outcome.dispatchId);
      if (settledOutcome === undefined) {
        throw this.createError(
          `Completed dispatch ${outcome.dispatchId} lost its validated report handoff.`,
        );
      }
      orderedOutcomes.push(settledOutcome);
    }
    return orderedOutcomes;
  }
}
