import { describe, expect, it } from "vitest";
import type { CallerContext } from "../../orchestration/orchestration.schema.js";
import {
  CodedSkillError,
  InvalidSkillResumeError,
  PartialOperationFailure,
  PendingPauseRegistry,
  SkillExecution,
  skillFailures,
  type PausedSkillResult,
} from "../skill-runtime-core.js";

const context: CallerContext = {
  runId: "core",
  taskId: "pauses",
  cwd: "/repo",
  repositoryRoot: "/repo",
  baseRef: "main",
  skill: "test",
  attempt: 1,
};

function entry(runKey: string) {
  return {
    context,
    invocationId: `invocation-${runKey}`,
    questionId: `question-${runKey}`,
    skill: "guided-code-review",
    allowHumanQuestions: true,
    runKey,
    session: runKey,
  };
}

function resumeRequest(pause: { pauseId: string; questionId: string }) {
  return { context, pauseId: pause.pauseId, questionId: pause.questionId, answer: "Yes" };
}

describe("pending pause registry", () => {
  it("reserves a pause once and lets a failed continuation release it", () => {
    const registry = new PendingPauseRegistry<string>();
    const pause = registry.register(entry("a"));

    const reserved = registry.reserve(resumeRequest(pause));
    expect(reserved).toBe(pause);
    expect(() => registry.reserve(resumeRequest(pause))).toThrow(InvalidSkillResumeError);

    registry.release(reserved);
    expect(registry.reserve(resumeRequest(pause))).toBe(pause);
    registry.consume(pause);
    expect(() => registry.reserve(resumeRequest(pause))).toThrow(InvalidSkillResumeError);
  });

  it("rejects stale questions, foreign callers and blank answers without reserving", () => {
    const registry = new PendingPauseRegistry<string>();
    const pause = registry.register(entry("a"));

    expect(() => registry.reserve({ ...resumeRequest(pause), questionId: "stale" })).toThrow(
      "missing, stale or does not match",
    );
    expect(() =>
      registry.reserve({ ...resumeRequest(pause), context: { ...context, attempt: 2 } }),
    ).toThrow("missing, stale or does not match");
    expect(() => registry.reserve({ ...resumeRequest(pause), answer: " " })).toThrow(
      "human answer is required",
    );
    expect(pause.state).toBe("paused");
  });

  it("cancels a pause together with the sibling pause it carries", () => {
    const registry = new PendingPauseRegistry<string>();
    const parent = registry.register(entry("parent"));
    const sibling = registry.register(entry("sibling"));
    const carried: PausedSkillResult = {
      status: "paused",
      context,
      invocationId: sibling.invocationId,
      pauseId: sibling.pauseId,
      questionId: sibling.questionId,
      question: "May I continue?",
    };
    registry.carrySibling("parent", carried);
    expect(registry.siblingOf("parent")).toBe(carried);

    registry.cancel(context, parent.pauseId);

    expect(registry.siblingOf("parent")).toBeUndefined();
    expect(() => registry.reserve(resumeRequest(sibling))).toThrow(InvalidSkillResumeError);
    expect(() => registry.cancel(context, parent.pauseId)).toThrow(InvalidSkillResumeError);
  });

  it("refuses to cancel a pause that a resume has reserved", () => {
    const registry = new PendingPauseRegistry<string>();
    const pause = registry.register(entry("a"));
    registry.reserve(resumeRequest(pause));

    expect(() => registry.cancel(context, pause.pauseId)).toThrow(InvalidSkillResumeError);
  });
});

describe("skill execution and failure reporting", () => {
  it("keeps the first recorded failure and every distinct partial write", async () => {
    const execution = new SkillExecution();
    const partial = new PartialOperationFailure({
      operations: [
        {
          operationId: "create",
          status: "partial",
          data: { id: 1 },
          error: { name: "E", message: "m" },
        },
      ],
    });

    await expect(execution.run(async () => Promise.reject(partial))).rejects.toBe(partial);
    execution.recordFailure(partial);
    await expect(execution.run(async () => "never")).rejects.toBe(partial);

    expect(execution.partialOperations).toHaveLength(1);
    expect(execution.failure).toBe(partial);
  });

  it("reports cancellation before a recorded failure and honours a coded failure", () => {
    const aborted = new AbortController();
    aborted.abort();
    const execution = new SkillExecution();
    execution.recordFailure(new CodedSkillError({ failureCode: "CUSTOM", message: "coded" }));
    const base = { context, invocationId: "i", execution, cause: new Error("cause") };

    expect(skillFailures.failed({ ...base, signal: aborted.signal }).failure.code).toBe(
      "CANCELLED",
    );
    expect(skillFailures.failed(base).failure).toMatchObject({ code: "CUSTOM", message: "coded" });
    expect(skillFailures.failed({ ...base, execution: undefined }).failure).toMatchObject({
      code: "EXECUTION_FAILED",
      message: "cause",
    });
  });

  it("ignores failures its binding treats as control flow", () => {
    const execution = new SkillExecution({ ignores: (cause) => cause === "interrupt" });

    execution.recordFailure("interrupt");

    expect(execution.failure).toBeUndefined();
  });
});
