import { z } from "zod";
import { FileReviewPolicy, type ReviewPolicy } from "../code-review/review-policy.js";
import {
  GhReviewGitHubApi,
  GitHubReviewVerifier,
  type ReviewGitHubApi,
} from "../code-review/github-review-verifier.js";
import { EvidenceReviewPlanner } from "../code-review/review-planner.js";
import { JsonReviewCodec } from "../code-review/review-codec.js";
import { reviewContract } from "../code-review/review-contract.js";
import {
  FindingRecordSchema,
  HeadShaSchema,
  ReviewSchema,
  ReviewStateSchema,
  StoredFindingSchema,
} from "../code-review/review.schema.js";
import type { OperationDescriptor } from "./operation-registry.js";
import type { OperationEffect } from "./operation.schema.js";

const ReviewOperationsPropsSchema = z.strictObject({
  cwd: z.string().min(1),
  policy: z
    .custom<ReviewPolicy>(
      (value): value is ReviewPolicy =>
        typeof value === "object" && value !== null && "repository" in value && "load" in value,
    )
    .optional(),
  api: z
    .custom<ReviewGitHubApi>(
      (value): value is ReviewGitHubApi =>
        typeof value === "object" && value !== null && "get" in value && "graphql" in value,
    )
    .optional(),
});

const JsonValueSchema = z.json();
const schemaInput = z.strictObject({ transport: z.boolean().default(false) });
const reviewInput = z.strictObject({ review: JsonValueSchema });
const reviewOutput = ReviewSchema;
const stateInput = z.strictObject({ state: JsonValueSchema });
const stateOutput = z.string();
const contextInput = z.strictObject({
  trustedRef: HeadShaSchema,
  contextPath: z.string().min(1).default("CODE-REVIEW.md"),
});
const contextOutput = z.object({
  trustedRef: HeadShaSchema,
  contextPath: z.string(),
  sources: z.array(z.object({ path: z.string(), contents: z.string() })),
  missing: z.array(z.string()),
});
const planInput = z.strictObject({
  number: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  review: JsonValueSchema,
  records: z.array(JsonValueSchema),
  owners: z.record(z.string(), z.array(z.string())).default({}),
  requireMapping: z.boolean().default(false),
});
const renderInput = z.strictObject({
  review: JsonValueSchema,
  records: z.array(FindingRecordSchema),
  outcome: z.string(),
  problems: z.array(z.string()),
});
const renderOutput = z.object({
  headSha: z.string(),
  outcome: z.string(),
  problems: z.array(z.string()),
  findings: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      path: z.string(),
      line: z.number(),
      body: z.string(),
    }),
  ),
});
const planOutput = z.object({
  review: ReviewSchema,
  records: z.array(FindingRecordSchema),
  informational: z.array(StoredFindingSchema),
  outcome: z.enum(["APPROVED", "CHANGES_NEEDED", "ESCALATE", "INCOMPLETE"]),
  problems: z.array(z.string()),
});

export interface ReviewOperations {
  operations(): OperationDescriptor[];
}

/** Keeps the review lifecycle shared while pinning repository reads to the host's launch checkout. */
export class DefaultReviewOperations implements ReviewOperations {
  private readonly cwd: string;
  private readonly policy: ReviewPolicy;
  private readonly api: ReviewGitHubApi;

  constructor(props: z.input<typeof ReviewOperationsPropsSchema>) {
    const parsed = ReviewOperationsPropsSchema.parse(props);
    this.cwd = parsed.cwd;
    this.policy = parsed.policy ?? new FileReviewPolicy();
    this.api = parsed.api ?? new GhReviewGitHubApi();
  }

  operations(): OperationDescriptor[] {
    return [
      this.descriptor(
        "review-schema",
        "Return the canonical full or model-facing review contract schema.",
        ["read", "process"],
        ["review", "schema"],
        schemaInput,
        JsonValueSchema,
        ({ transport }) => {
          const schemas = reviewContract.schemas();
          return JsonValueSchema.parse(
            JSON.parse(JSON.stringify(transport ? schemas.transport : schemas.full)),
          );
        },
      ),
      this.descriptor(
        "review-validate",
        "Validate and normalize a review against the canonical contract.",
        ["read", "process"],
        ["review", "validate"],
        reviewInput,
        reviewOutput,
        ({ review }) => reviewContract.parse(review),
      ),
      this.descriptor(
        "review-render",
        "Render persisted findings from a validated review plan.",
        ["read", "process"],
        ["review", "render"],
        renderInput,
        renderOutput,
        ({ review, records, outcome, problems }) => {
          const parsedReview = reviewContract.parse(review);
          const codec = new JsonReviewCodec();
          return {
            headSha: parsedReview.head_sha,
            outcome,
            problems,
            findings: records.map((record) => ({
              id: record.finding.id,
              status: record.status,
              path: record.finding.path,
              line: record.finding.line,
              body: codec.render(record),
            })),
          };
        },
      ),
      this.descriptor(
        "review-state",
        "Validate a persisted review state index and return its canonical marker.",
        ["read", "process"],
        ["review", "state"],
        stateInput,
        stateOutput,
        ({ state }) => new JsonReviewCodec().state(ReviewStateSchema.parse(state)),
      ),
      this.descriptor(
        "review-context",
        "Read repository review rules from a pinned commit in the launch checkout.",
        ["read", "process"],
        ["review", "context"],
        contextInput,
        contextOutput,
        ({ trustedRef, contextPath }) =>
          this.policy.repository({ cwd: this.cwd, trustedRef, contextPath }),
      ),
      this.descriptor(
        "review-plan",
        "Plan review transitions after checking current GitHub head and evidence authority.",
        ["read", "network", "process"],
        ["review", "plan"],
        planInput,
        planOutput,
        async ({ number, repo, review, records, owners, requireMapping }) => {
          const pullRequest = z
            .looseObject({
              head: z.looseObject({ sha: HeadShaSchema }),
              user: z.looseObject({ id: z.number().int().positive() }),
            })
            .parse(await this.api.get(`/repos/${repo}/pulls/${number}`));
          const planner = new EvidenceReviewPlanner({
            verifier: new GitHubReviewVerifier({
              api: this.api,
              repo,
              prNumber: number,
              prAuthorId: pullRequest.user.id,
              owners,
              requireMapping,
            }),
          });

          return planner.plan({ review, records, headSha: pullRequest.head.sha });
        },
      ),
    ];
  }

  private descriptor<TInput, TOutput>(
    id: string,
    description: string,
    effects: OperationEffect[],
    path: string[],
    inputSchema: z.ZodType<TInput>,
    outputSchema: z.ZodType<TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): OperationDescriptor<TInput, TOutput> {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler,
    };
  }
}
