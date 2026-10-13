import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FileAgentRegistry } from "../../agents/agent-registry/agent-registry.js";
import { BoundedDispatchQueue } from "../dispatch-queue.js";
import type { DispatchRequest, RuntimeSnapshot } from "../orchestration.schema.js";

const agents = new FileAgentRegistry().load(
  fileURLToPath(new URL("../../../agents", import.meta.url)),
);
const context = {
  runId: "research",
  taskId: "epic",
  cwd: "/repo",
  repositoryRoot: "/repo",
  baseRef: "main",
  skill: "break-down-work",
  attempt: 1,
};
const reportSchema = z.strictObject({ findings: z.array(z.string()) });
const available = { state: "available", evidence: "Effective runtime observation" } as const;
function requests(count: number): DispatchRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `brief-${index}`,
    agent: "research-agent",
    context,
    input: { focus: `Separate concern ${index}`, mode: "internal", depth: "deep" },
  }));
}
function runtime(limits: Partial<RuntimeSnapshot["limits"]> = {}): RuntimeSnapshot {
  return {
    context,
    agent: "research-agent",
    host: { name: "fixture", version: "1" },
    observedAt: "2026-10-13T00:00:00Z",
    spawn: available,
    ask: available,
    permissions: { read: available, shell: available, web: available },
    limits: {
      maxConcurrent: 2,
      activeWorkers: 0,
      currentDepth: 0,
      maxDepth: 1,
      source: "Fixture host",
      ...limits,
    },
  };
}
function finish(queue: BoundedDispatchQueue, request: DispatchRequest): void {
  expect(
    queue.settle(
      request.id,
      {
        status: "completed",
        dispatchId: request.id,
        agent: request.agent,
        context: request.context,
        report: { findings: [request.id] },
      },
      reportSchema,
    ).status,
  ).toBe("accepted");
}

describe("bounded dispatch queue", () => {
  it.each([
    [0, 2],
    [1, 2],
    [2, 2],
    [7, 2],
    [4, 1],
    [8, 3],
  ])("runs %i briefs with a cap of %i and preserves input order", (count, capacity) => {
    const briefs = requests(count);
    const queue = new BoundedDispatchQueue({ agents, requests: briefs, maxConcurrent: capacity });
    let active: DispatchRequest[] = [];
    const launched: string[] = [];
    const batchSizes: number[] = [];
    for (let step = 0; step < count * 3 + 1; step++) {
      const decision = queue.admit(runtime({ maxConcurrent: capacity }), []);
      if (decision.status === "complete") {
        expect(decision.outcomes.map((outcome) => outcome.dispatchId)).toEqual(
          briefs.map((brief) => brief.id),
        );
        break;
      }
      if (decision.status === "ready") {
        active.push(decision.request);
        launched.push(decision.request.id);
        expect(decision.request.input).toEqual(
          briefs.find((brief) => brief.id === decision.request.id)?.input,
        );
        expect(decision.definition.frontmatter.model).toBe("escalated");
        expect(active.length).toBeLessThanOrEqual(capacity);
        continue;
      }
      expect(decision.status).toBe("waiting");
      batchSizes.push(active.length);
      for (const request of active.toReversed()) finish(queue, request);
      active = [];
    }
    expect(launched).toEqual(briefs.map((brief) => brief.id));
    expect(queue.results()).toHaveLength(count);
    expect(batchSizes).toEqual(
      Array.from({ length: Math.ceil(count / capacity) }, (_, index) =>
        Math.min(capacity, count - index * capacity),
      ),
    );
  });

  it("uses the smaller host/caller cap and does not refill a partially completed batch", () => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(4), maxConcurrent: 3 });
    const first = queue.admit(runtime(), []);
    const second = queue.admit(runtime(), []);
    if (first.status !== "ready" || second.status !== "ready")
      throw new Error("expected two admissions");
    expect(queue.admit(runtime(), []).status).toBe("waiting");
    finish(queue, second.request);
    expect(queue.admit(runtime(), [])).toEqual({
      status: "waiting",
      dispatchIds: [first.request.id],
    });
    finish(queue, first.request);
    expect(queue.admit(runtime({ maxConcurrent: 1 }), []).status).toBe("ready");
    expect(queue.admit(runtime({ maxConcurrent: 1 }), []).status).toBe("waiting");
  });

  it("accounts for changing external usage and launches absent from host usage", () => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(3), maxConcurrent: 5 });
    const first = queue.admit(runtime({ maxConcurrent: 3, activeWorkers: 1 }), []);
    if (first.status !== "ready") throw new Error("expected admission");
    // One newly observed external worker fills capacity; our unobserved reservation still counts.
    expect(queue.admit(runtime({ maxConcurrent: 3, activeWorkers: 2 }), []).status).toBe("waiting");
    finish(queue, first.request);
    // External usage dropped; the next batch can proceed against the fresh snapshot.
    expect(queue.admit(runtime({ maxConcurrent: 3, activeWorkers: 1 }), []).status).toBe("ready");
  });

  it("does not double-count reservations already included in host usage", () => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(3), maxConcurrent: 3 });
    const first = queue.admit(runtime(), []);
    if (first.status !== "ready") throw new Error("expected admission");
    expect(queue.admit(runtime({ activeWorkers: 1 }), [first.request.id]).status).toBe("ready");
    expect(queue.admit(runtime({ activeWorkers: 2 }), []).status).toBe("waiting");
  });

  it.each([
    [{ maxConcurrent: 0 }, "CAPACITY_EXHAUSTED"],
    [{ maxConcurrent: null }, "LIMITS_UNKNOWN"],
    [{ activeWorkers: 2 }, "CAPACITY_EXHAUSTED"],
    [{ maxDepth: null }, "LIMITS_UNKNOWN"],
    [{ currentDepth: 1 }, "DEPTH_EXCEEDED"],
  ])("returns a named outcome before launch for %j", (limits, code) => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(1), maxConcurrent: 2 });
    expect(queue.admit(runtime(limits), [])).toMatchObject({
      status: "unavailable",
      outcome: {
        status: "unavailable",
        dispatchId: "brief-0",
        failure: { code, remedy: expect.any(String) },
      },
    });
    expect(queue.results()).toHaveLength(1);
  });

  it("rejects invalid numeric limits and inconsistent observation IDs without admitting work", () => {
    const briefs = requests(2);
    for (const maxConcurrent of [0, -1, 1.5, NaN])
      expect(() => new BoundedDispatchQueue({ agents, requests: briefs, maxConcurrent })).toThrow();
    expect(
      () =>
        new BoundedDispatchQueue({ agents, requests: [...briefs, ...briefs], maxConcurrent: 2 }),
    ).toThrow("unique");
    const queue = new BoundedDispatchQueue({ agents, requests: briefs, maxConcurrent: 2 });
    expect(() => queue.admit(runtime({ activeWorkers: -1 }), [])).toThrow();
    expect(() => queue.admit(runtime(), ["unknown"])).toThrow("active reservations");
    const first = queue.admit(runtime(), []);
    if (first.status !== "ready") throw new Error("expected admission");
    expect(() => queue.admit(runtime(), [first.request.id])).toThrow("host worker count");
    expect(() =>
      queue.admit(runtime({ activeWorkers: 2 }), [first.request.id, first.request.id]),
    ).toThrow("unique");
    expect(queue.pending()?.id).toBe("brief-1");
  });

  it("keeps a reservation when the outcome belongs to another dispatch or has an invalid role report", () => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(2), maxConcurrent: 1 });
    const first = queue.admit(runtime(), []);
    if (first.status !== "ready") throw new Error("expected admission");
    const outcome = {
      status: "completed",
      dispatchId: "foreign",
      agent: first.request.agent,
      context,
      report: { findings: [] },
    };
    expect(queue.settle(first.request.id, outcome, reportSchema)).toMatchObject({
      failure: { code: "INVALID_HANDOFF" },
    });
    expect(
      queue.settle(
        first.request.id,
        { ...outcome, dispatchId: first.request.id, report: { summary: "done" } },
        reportSchema,
      ),
    ).toMatchObject({ failure: { code: "INVALID_REPORT" } });
    expect(queue.admit(runtime(), []).status).toBe("waiting");
    finish(queue, first.request);
    expect(() => finish(queue, first.request)).toThrow("No active reservation");
    expect(queue.admit(runtime(), []).status).toBe("ready");
  });

  it("cancels queued work but retains running reservations until the adapter acknowledges release", () => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(3), maxConcurrent: 2 });
    const first = queue.admit(runtime(), []);
    if (first.status !== "ready") throw new Error("expected admission");
    queue.cancel();
    expect(queue.pending()).toBeUndefined();
    expect(queue.results()).toBeUndefined();
    expect(queue.admit(runtime(), [])).toEqual({
      status: "waiting",
      dispatchIds: [first.request.id],
    });
    finish(queue, first.request);
    expect(queue.results()).toMatchObject([
      { status: "completed", dispatchId: "brief-0" },
      { status: "failed", dispatchId: "brief-1", failure: { code: "CANCELLED" } },
      { status: "failed", dispatchId: "brief-2", failure: { code: "CANCELLED" } },
    ]);
  });

  it("keeps failed workers attached to their request without manufacturing findings", () => {
    const queue = new BoundedDispatchQueue({ agents, requests: requests(1), maxConcurrent: 1 });
    const first = queue.admit(runtime(), []);
    if (first.status !== "ready") throw new Error("expected admission");
    const failure = {
      code: "EXECUTION_FAILED",
      message: "Host refused launch",
      remedy: "Inspect the host denial",
    };
    queue.settle(
      first.request.id,
      {
        status: "failed",
        dispatchId: first.request.id,
        agent: first.request.agent,
        context,
        failure,
      },
      reportSchema,
    );
    expect(queue.results()).toEqual([
      {
        status: "failed",
        dispatchId: first.request.id,
        agent: first.request.agent,
        context,
        failure,
      },
    ]);
  });

  it("rejects another task context and isolates stored briefs/results from caller mutation", () => {
    const briefs = requests(2);
    const queue = new BoundedDispatchQueue({ agents, requests: briefs, maxConcurrent: 1 });
    const original = briefs[0];
    if (!original) throw new Error("missing request");
    original.input.focus = "mutated";
    const pending = queue.pending();
    if (!pending) throw new Error("missing pending request");
    pending.input.focus = "also mutated";
    const first = queue.admit(runtime(), []);
    if (first.status !== "ready") throw new Error("expected admission");
    expect(first.request.input.focus).toBe("Separate concern 0");
    finish(queue, first.request);
    expect(
      queue.admit({ ...runtime(), context: { ...context, taskId: "other" } }, []),
    ).toMatchObject({ outcome: { failure: { code: "CONTEXT_MISMATCH" } } });
    const results = queue.results();
    results?.pop();
    expect(queue.results()).toHaveLength(2);
  });
});
