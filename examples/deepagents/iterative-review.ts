import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EvidenceReviewPlanner,
  FileReviewPolicy,
  JsonReviewCodec,
  ReviewSchema,
  ValidatedReviewVerifier,
  reviewContract,
} from "@good-ground-collective/flight-rules/review";
import {
  instructionCatalog,
  MapOperationRegistry,
  type CallerContext,
  type RuntimeSnapshot,
  type ImplementationRun,
  VerifiedImplementationLoop,
} from "@good-ground-collective/flight-rules/sdk";
import {
  DeepAgentsWorkerRuntime,
  LangChainDeepAgentsSkillRuntime,
  type DeepAgentsWorkerRuntimeContract,
} from "@good-ground-collective/flight-rules/sdk/deepagents";

let blockedModelRequests = 0;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  void input;
  void init;
  blockedModelRequests += 1;
  throw new Error("The deterministic consumer proof does not permit model network requests.");
};

const reviewRepo = mkdtempSync(join(tmpdir(), "flight-rules-review-context-"));
writeFileSync(
  join(reviewRepo, "CODE-REVIEW.md"),
  "Review context loaded from the trusted commit.\n",
);
execFileSync("git", ["init", "-q"], { cwd: reviewRepo });
execFileSync(
  "git",
  [
    "-c",
    "user.name=Consumer proof",
    "-c",
    "user.email=consumer@example.invalid",
    "add",
    "CODE-REVIEW.md",
  ],
  { cwd: reviewRepo },
);
execFileSync(
  "git",
  [
    "-c",
    "user.name=Consumer proof",
    "-c",
    "user.email=consumer@example.invalid",
    "commit",
    "-q",
    "-m",
    "trusted review context",
  ],
  { cwd: reviewRepo },
);
const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: reviewRepo,
  encoding: "utf8",
}).trim();
const codeEvidence = {
  kind: "code" as const,
  commit_sha: headSha,
  path: "src/review-entry.ts",
  line: 18,
};
const finding = {
  id: "f-0000000001",
  path: "src/review-entry.ts",
  line: 18,
  label: "question",
  type: "clarify",
  blocking: true,
  severity: "major",
  subject: "Confirm the review entry handles empty evidence",
  discussion: "The changed branch appears to treat an empty evidence set as complete.",
  details: "Explain the intended empty-evidence behavior or update the branch.",
  resolved_when: "The behavior is explained and the relevant code evidence is checked.",
};
const record = {
  v: 1,
  schema_revision: 1,
  finding,
  status: "open" as const,
  evidence: [],
};
const makeReview = (priorFindings: object[]) =>
  ReviewSchema.parse({
    contract_version: 1,
    schema_revision: 1,
    head_sha: headSha,
    review_complete: true,
    summary: "Review of the evidence handling change.",
    outcome: priorFindings.length === 0 ? "CHANGES_NEEDED" : "APPROVED",
    outcome_reason:
      priorFindings.length === 0
        ? "One clarification remains."
        : "Accepted evidence resolves the clarification.",
    remaining_risk: "The example uses deterministic scripted model turns.",
    findings: [],
    prior_findings: priorFindings,
  });
const toReport = (review: object) => `\`\`\`yaml\n${stringifyYaml(review)}\`\`\``;
const parseReport = (report: unknown) => {
  if (typeof report !== "string" || !report.startsWith("```yaml\n") || !report.endsWith("```")) {
    throw new Error("The scripted graph returned an invalid action-mode report.");
  }
  return contract.parse(parseYaml(report.slice(8, -3)));
};

class ScriptedReviewModel extends BaseChatModel {
  private turn = 0;

  constructor() {
    super({});
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, never, BaseChatModelCallOptions> {
    void tools;
    void kwargs;
    return this as unknown as Runnable<BaseLanguageModelInput, never, BaseChatModelCallOptions>;
  }

  override _llmType(): string {
    return "scripted-review-example";
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    void options;
    void runManager;
    const message =
      this.turn++ === 0
        ? new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "flight_rules_ask_human",
                args: { question: "Should the empty evidence case be treated as complete?" },
                id: "review-question",
                type: "tool_call",
              },
            ],
          })
        : new AIMessage({
            content: toReport(
              this.turn === 2
                ? makeReview([
                    {
                      id: finding.id,
                      status: "still_open",
                      reason:
                        "The actual human answer was recorded; the clarification remains open pending independently accepted code evidence.",
                    },
                  ])
                : makeReview([
                    {
                      id: finding.id,
                      status: "resolved",
                      reason: "The accepted explanation matches the reviewed branch.",
                      evidence: [codeEvidence],
                    },
                  ]),
            ),
            response_metadata: { scriptedTurn: this.turn },
          });
    return {
      generations: [{ text: typeof message.content === "string" ? message.content : "", message }],
    };
  }
}

class ScriptedWorkerModel extends BaseChatModel {
  private readonly verifierTurns: boolean[] = [];
  readonly workerEvents: string[] = [];

  constructor() {
    super({});
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, never, BaseChatModelCallOptions> {
    void tools;
    void kwargs;
    return this as unknown as Runnable<BaseLanguageModelInput, never, BaseChatModelCallOptions>;
  }

  override _llmType(): string {
    return "scripted-implementation-example";
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    void options;
    void runManager;
    const prompt = String(messages.find((message) => message.getType() === "human")?.content ?? "");
    if (prompt.includes("code-verifier agent")) {
      this.workerEvents.push("code-verifier");
      const pass = this.verifierTurns.length > 0;
      this.verifierTurns.push(pass);
      const response = `\`\`\`yaml\n${stringifyYaml({
        summary: pass
          ? "The directed retry meets the criterion."
          : "The first implementation needs a focused correction.",
        criteria: [
          {
            criterion: "Implementation matches contract.",
            verdict: pass ? "PASS" : "FAIL",
            evidence: pass
              ? "The independent graph pass checked the corrected fixture."
              : "The verifier found that the first report did not cover the empty input.",
          },
        ],
        verified: pass,
      })}\`\`\``;
      return { generations: [{ text: response, message: new AIMessage({ content: response }) }] };
    }

    const retry = prompt.includes('"verifierFailures"');
    this.workerEvents.push(retry ? "directed-implementation-retry" : "implementation");
    const response = `\`\`\`yaml\n${stringifyYaml({
      summary: retry
        ? "Applied the verifier's directed correction."
        : "Completed the first implementation pass.",
      filesChanged: [
        {
          path: "fixture.ts",
          why: retry
            ? "Handled the verifier's empty-input finding."
            : "Implemented the example contract.",
        },
      ],
      testsRun: [
        {
          command: "scripted fixture check",
          result: retry ? "passed on retry" : "initial evidence captured",
        },
      ],
      approach: retry
        ? "The retry addresses the verifier's itemized failure."
        : "The first pass intentionally leaves a verifier finding.",
    })}\`\`\``;
    return { generations: [{ text: response, message: new AIMessage({ content: response }) }] };
  }
}

const context: CallerContext = {
  runId: "iterative-review-example",
  taskId: "review-consumer-proof",
  cwd: process.cwd(),
  repositoryRoot: process.cwd(),
  baseRef: headSha,
  skill: "autonomous-code-review",
  attempt: 1,
};
const allowed = {
  state: "available" as const,
  evidence: "The deterministic example grants this capability.",
};
const snapshot = (caller: CallerContext, agent: string | null = null): RuntimeSnapshot => ({
  context: caller,
  host: { name: "scripted-example", version: "1" },
  observedAt: new Date().toISOString(),
  agent,
  spawn: allowed,
  ask: allowed,
  permissions: {
    read: allowed,
    edit: allowed,
    shell: allowed,
    web: allowed,
    spawn: allowed,
    ask: allowed,
  },
  limits: {
    maxConcurrent: 1,
    activeWorkers: 0,
    currentDepth: 0,
    maxDepth: 1,
    source: "scripted example",
  },
});
const skillWorkers: DeepAgentsWorkerRuntimeContract = {
  dispatch: async () => {
    throw new Error("The example does not dispatch a worker.");
  },
  dispatchMany: async () => [],
};
const model = new ScriptedReviewModel();
const runtime = new LangChainDeepAgentsSkillRuntime({
  instructions: instructionCatalog,
  agents: instructionCatalog.listAgents().map((name) => instructionCatalog.loadAgent(name)),
  models: { standard: model, escalated: model, expert: model },
  operations: new MapOperationRegistry({ operations: [] }),
  workers: skillWorkers,
  observe: async (caller) => snapshot(caller),
  toolGrants: () => ({ read: [] }),
});

const policy = new FileReviewPolicy();
const loadedPolicy = policy.load({ paths: ["src/review-entry.ts"] });
const repositoryContext = policy.repository({ cwd: reviewRepo, trustedRef: headSha });
if (
  !repositoryContext.sources.some(
    ({ path, contents }) => path === "CODE-REVIEW.md" && contents.includes("trusted commit"),
  )
) {
  throw new Error("The installed review context was not loaded from the pinned trusted commit.");
}
const contract = reviewContract;
const codec = new JsonReviewCodec();
const planner = new EvidenceReviewPlanner({
  verifier: new ValidatedReviewVerifier({
    verified: [JSON.stringify(codeEvidence)],
    authorizedDecisions: [],
    dismissals: [],
  }),
});
const priorRecord = contract.record(record);
const prompt = {
  mode: "action",
  head_sha: headSha,
  prior_findings: [priorRecord],
  policy: loadedPolicy.method,
};
const paused = await runtime.invoke("autonomous-code-review", context, prompt, {
  allowHumanQuestions: true,
});
if (paused.status !== "paused")
  throw new Error(`Expected a question pause, received ${paused.status}.`);
const answered = await runtime.resume({
  context,
  pauseId: paused.pauseId,
  questionId: paused.questionId,
  answer:
    "Yes. Empty evidence means the code path has no evidence to verify and remains incomplete.",
});
if (answered.status !== "completed")
  throw new Error(
    `Expected a completed first pass, received ${answered.status}: ${answered.status === "failed" ? answered.failure.message : "paused"}`,
  );
const firstReview = parseReport(answered.report);
const firstPlan = await planner.plan({ review: firstReview, records: [priorRecord], headSha });
if (firstPlan.records[0]?.status !== "open")
  throw new Error("The clarification must remain open after the question answer.");

const second = await runtime.invoke(
  "autonomous-code-review",
  { ...context, attempt: 2 },
  {
    ...prompt,
    pass: 2,
    accepted_evidence: codeEvidence,
    prior_findings: firstPlan.records,
  },
);
if (second.status !== "completed")
  throw new Error(`Expected a completed evidence pass, received ${second.status}.`);
const secondReview = parseReport(second.report);
const finalPlan = await planner.plan({ review: secondReview, records: firstPlan.records, headSha });
if (finalPlan.records[0]?.status !== "resolved" || finalPlan.outcome !== "APPROVED") {
  throw new Error(
    `The evidence checked pass did not resolve the finding: ${finalPlan.problems.join("; ")}`,
  );
}

const marker = codec.finding(finalPlan.records[0]);
if (codec.readFindings({ body: marker, authorId: 10, trustedAuthorIds: [10] }).length !== 1) {
  throw new Error("The final stored finding could not be read from its canonical marker.");
}

const workerModel = new ScriptedWorkerModel();
const workers = new DeepAgentsWorkerRuntime({
  agents: instructionCatalog.listAgents().map((name) => instructionCatalog.loadAgent(name)),
  models: { standard: workerModel, escalated: workerModel, expert: workerModel },
  toolGrants: {},
  observe: async (request) => snapshot(request.context, request.agent),
  maxGraphSteps: 12,
});
const implementationLoop = new VerifiedImplementationLoop();
let implementationRun: ImplementationRun = {
  context: {
    runId: context.runId,
    taskId: context.taskId,
    cwd: context.cwd,
    repositoryRoot: context.repositoryRoot,
    baseRef: context.baseRef,
    skill: "execute-work",
  },
  criteria: ["Implementation matches contract."],
  implementationInput: { ticket: "scripted worker graph proof" },
  history: [],
};
const implementation = implementationLoop.next(implementationRun);
if (implementation.status !== "implement")
  throw new Error("Expected an initial implementation dispatch.");
const initialImplementation = await workers.dispatch(implementation.request);
if (initialImplementation.status !== "completed")
  throw new Error(`Initial implementation failed: ${JSON.stringify(initialImplementation)}`);
const firstVerification = implementationLoop.verify(implementationRun, {
  request: implementation.request,
  outcome: initialImplementation,
});
if (firstVerification.status !== "verify")
  throw new Error(
    `Expected independent verification after implementation: ${JSON.stringify(firstVerification)}`,
  );
const failedVerification = await workers.dispatch(firstVerification.request);
implementationRun = {
  ...implementationRun,
  history: [
    {
      implementation: { request: implementation.request, outcome: initialImplementation },
      verification: { request: firstVerification.request, outcome: failedVerification },
    },
  ],
};
const retry = implementationLoop.next(implementationRun);
if (retry.status !== "implement" || !("verifierFailures" in retry.request.input)) {
  throw new Error("Expected the verifier's directed failure to reach the retry.");
}
const retriedImplementation = await workers.dispatch(retry.request);
const retryVerification = implementationLoop.verify(implementationRun, {
  request: retry.request,
  outcome: retriedImplementation,
});
if (retryVerification.status !== "verify")
  throw new Error("Expected independent verification of the retry.");
const passedVerification = await workers.dispatch(retryVerification.request);
implementationRun = {
  ...implementationRun,
  history: [
    ...implementationRun.history,
    {
      implementation: { request: retry.request, outcome: retriedImplementation },
      verification: { request: retryVerification.request, outcome: passedVerification },
    },
  ],
};
const workerFinal = implementationLoop.next(implementationRun);
if (workerFinal.status !== "verified")
  throw new Error("The independent verifier did not pass the retry.");

console.log(
  JSON.stringify(
    {
      execution: "deterministic SDK graph with scripted model; no provider calls",
      canonicalSkill: paused.question,
      policyCharters: loadedPolicy.charters.map(({ id }) => id),
      trustedRepositoryContext: repositoryContext.sources.map(({ path }) => path),
      contract: "validated on both passes",
      codec: "round trip passed",
      questionAnswerBoundary: "resumed original checkpoint",
      firstPassFinding: firstPlan.records[0]?.status,
      acceptedEvidence: codeEvidence,
      finalPassFinding: finalPlan.records[0]?.status,
      outcome: finalPlan.outcome,
      installedWorkerScenario: {
        graphStepsPerDispatch: "bounded at 12",
        canonicalRegistrations: instructionCatalog.listAgents(),
        events: workerModel.workerEvents,
        finalState: workerFinal.status,
      },
      blockedModelRequests,
    },
    null,
    2,
  ),
);
rmSync(reviewRepo, { recursive: true, force: true });
