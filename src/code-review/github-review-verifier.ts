import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { ReviewVerifier } from "./review-planner.js";
import type { ActionableFinding, DecisionAnswer, ReviewEvidence } from "./review.schema.js";

const GhReviewGitHubApiPropsSchema = z.strictObject({
  cwd: z.string().min(1).optional(),
  env: z
    .custom<NodeJS.ProcessEnv>(
      (value): value is NodeJS.ProcessEnv =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .optional(),
});

export interface ReviewGitHubApi {
  get(path: string): Promise<unknown>;
  graphql(query: string, variables: Record<string, string | number>): Promise<unknown>;
}
export class GhReviewGitHubApi implements ReviewGitHubApi {
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(props: z.input<typeof GhReviewGitHubApiPropsSchema> = {}) {
    const parsed = GhReviewGitHubApiPropsSchema.parse(props);
    this.cwd = parsed.cwd ?? process.cwd();
    this.env = props.env ?? process.env;
  }

  async get(path: string): Promise<unknown> {
    return this.run(["api", path]);
  }
  async graphql(query: string, variables: Record<string, string | number>): Promise<unknown> {
    return this.run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      ...Object.entries(variables).flatMap(([key, value]) => [
        typeof value === "number" ? "-F" : "-f",
        `${key}=${value}`,
      ]),
    ]);
  }
  private async run(args: string[]): Promise<unknown> {
    const { stdout } = await promisify(execFile)("gh", args, {
      maxBuffer: 20_000_000,
      cwd: this.cwd,
      env: this.env,
    });
    return JSON.parse(stdout);
  }
}
const GitHubReviewVerifierPropsSchema = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  prNumber: z.number().int().positive(),
  prAuthorId: z.number().int().positive(),
  owners: z.record(z.string(), z.array(z.string().min(1))).default({}),
  requireMapping: z.boolean().default(false),
});
export type GitHubReviewVerifierProps = z.input<typeof GitHubReviewVerifierPropsSchema> & {
  api?: ReviewGitHubApi;
};
const UserSchema = z.looseObject({ id: z.number(), login: z.string(), type: z.string() });
const CommentSchema = z.looseObject({
  id: z.number(),
  user: UserSchema,
  issue_url: z.string().optional(),
  pull_request_url: z.string().optional(),
  body: z.string(),
});

/** Checks GitHub artifact provenance and authority; the reviewer still judges the answer's meaning. */
export class GitHubReviewVerifier implements ReviewVerifier {
  private readonly props: z.output<typeof GitHubReviewVerifierPropsSchema>;
  private readonly api: ReviewGitHubApi;

  constructor(props: GitHubReviewVerifierProps) {
    const { api, ...values } = props;
    this.props = GitHubReviewVerifierPropsSchema.parse(values);
    this.api = api ?? new GhReviewGitHubApi();
  }

  async verify(evidence: ReviewEvidence, headSha: string): Promise<boolean> {
    if (evidence.kind === "document") return true;
    if (evidence.kind === "verification") return false;
    if (evidence.kind === "github_comment") {
      const comment = await this.comment(evidence.comment_id, evidence.url);
      return comment !== undefined;
    }
    if (evidence.kind === "thread_resolution") return this.dismissal(evidence);
    if (evidence.kind === "commit") return this.reaches(evidence.sha, headSha);
    if (evidence.kind === "check_run") {
      if (evidence.commit_sha !== headSha) return false;
      const check = z
        .looseObject({
          head_sha: z.string(),
          status: z.string(),
          conclusion: z.string().nullable(),
        })
        .parse(await this.api.get(`/repos/${this.props.repo}/check-runs/${evidence.check_run_id}`));
      return (
        check.head_sha === headSha && check.status === "completed" && check.conclusion === "success"
      );
    }
    if (!(await this.reaches(evidence.commit_sha, headSha))) return false;
    return (
      (evidence.commit_sha === headSha ||
        (await this.hasLine(evidence.path, evidence.line, evidence.commit_sha))) &&
      (await this.hasLine(evidence.path, evidence.line, headSha))
    );
  }

  async authorize(answer: DecisionAnswer, finding: ActionableFinding): Promise<boolean> {
    if (
      finding.type !== "decide" ||
      !finding.decision_options.some((option) => option.id === answer.option_id)
    )
      return false;
    const comment = await this.comment(answer.comment_id);
    if (
      comment === undefined ||
      comment.user.id !== answer.author_id ||
      comment.user.type !== "User" ||
      !comment.body.trim()
    )
      return false;
    const owners = this.props.owners[finding.decision_owner];
    if (owners !== undefined)
      return owners.some((login) => login.toLowerCase() === comment.user.login.toLowerCase());
    if (this.props.requireMapping || comment.user.id === this.props.prAuthorId) return false;
    const permission = z
      .looseObject({ permission: z.string() })
      .parse(
        await this.api.get(
          `/repos/${this.props.repo}/collaborators/${encodeURIComponent(comment.user.login)}/permission`,
        ),
      );
    return ["write", "maintain", "admin"].includes(permission.permission);
  }

  async dismissal(evidence: ReviewEvidence): Promise<boolean> {
    if (evidence.kind !== "thread_resolution" || evidence.author_id === this.props.prAuthorId)
      return false;
    const result = z
      .looseObject({
        data: z.looseObject({
          node: z
            .looseObject({
              isResolved: z.boolean(),
              resolvedBy: z
                .looseObject({ databaseId: z.number(), actorType: z.string() })
                .nullable(),
              pullRequest: z.looseObject({
                number: z.number(),
                repository: z.looseObject({ nameWithOwner: z.string() }),
              }),
            })
            .nullable(),
        }),
      })
      .parse(
        await this.api.graphql(
          "query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { isResolved resolvedBy { actorType: __typename ... on User { databaseId } } pullRequest { number repository { nameWithOwner } } } } }",
          { id: evidence.thread_id },
        ),
      );
    const thread = result.data.node;
    return (
      thread !== null &&
      thread.isResolved &&
      thread.resolvedBy?.actorType === "User" &&
      thread.resolvedBy.databaseId === evidence.author_id &&
      thread.pullRequest.number === this.props.prNumber &&
      thread.pullRequest.repository.nameWithOwner.toLowerCase() === this.props.repo.toLowerCase()
    );
  }

  /** True when `sha` is the head or an ancestor of it, so the head contains that commit. */
  private async reaches(sha: string, headSha: string): Promise<boolean> {
    if (sha === headSha) return true;
    const comparison = z
      .looseObject({ status: z.string() })
      .parse(await this.api.get(`/repos/${this.props.repo}/compare/${sha}...${headSha}`));
    return ["ahead", "identical"].includes(comparison.status);
  }

  /** True when `ref` has `path` as a file with at least `line` lines. */
  private async hasLine(path: string, line: number, ref: string): Promise<boolean> {
    const file = z
      .looseObject({ type: z.string(), encoding: z.string(), content: z.string() })
      .parse(
        await this.api.get(
          `/repos/${this.props.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
        ),
      );
    if (file.type !== "file" || file.encoding !== "base64") return false;
    const text = Buffer.from(file.content, "base64").toString("utf8");
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return line <= lines;
  }

  private async comment(
    id: number,
    url?: string,
  ): Promise<z.infer<typeof CommentSchema> | undefined> {
    if (
      url !== undefined &&
      !url
        .toLowerCase()
        .startsWith(
          `https://github.com/${this.props.repo.toLowerCase()}/pull/${this.props.prNumber}#`,
        )
    )
      return undefined;
    const endpoints = url?.includes("#discussion_r")
      ? ["pulls/comments"]
      : url?.includes("#issuecomment-")
        ? ["issues/comments"]
        : ["issues/comments", "pulls/comments"];
    for (const endpoint of endpoints) {
      try {
        const comment = CommentSchema.parse(
          await this.api.get(`/repos/${this.props.repo}/${endpoint}/${id}`),
        );
        const expected = `https://api.github.com/repos/${this.props.repo.toLowerCase()}`;
        if (
          comment.id === id &&
          (comment.issue_url?.toLowerCase() === `${expected}/issues/${this.props.prNumber}` ||
            comment.pull_request_url?.toLowerCase() === `${expected}/pulls/${this.props.prNumber}`)
        )
          return comment;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}
