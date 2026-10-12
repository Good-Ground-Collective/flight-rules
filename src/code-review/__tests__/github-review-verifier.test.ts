import { describe, expect, it, vi } from "vitest";
import { GitHubReviewVerifier } from "../github-review-verifier.js";
import { ActionableFindingSchema } from "../review.schema.js";

const head = "a".repeat(40);
const finding = ActionableFindingSchema.parse({
  id: "f-0000000001",
  type: "decide",
  label: "question",
  path: "src/auth.ts",
  line: 12,
  blocking: true,
  severity: "major",
  subject: "Allow support writes?",
  discussion: "This expands access.",
  details: "Choose approve or decline; remove access if declined.",
  resolved_when: "An eligible human answers and the implementation is verified.",
  decision_owner: "policy",
  decision_options: [
    { id: "approve", description: "Permit writes." },
    { id: "decline", description: "Keep read-only." },
  ],
});
const comment = {
  id: 10,
  user: { id: 20, login: "owner", type: "User" },
  issue_url: "https://api.github.com/repos/org/repo/issues/1",
  body: "Keep support read-only.",
};
const api = (overrides: Record<string, unknown> = {}) => ({
  get: vi.fn(async (path: string) => {
    if (path in overrides) return overrides[path];
    if (path.endsWith("/permission")) return { permission: "write" };
    return comment;
  }),
  graphql: vi.fn(async () => ({
    data: {
      node: {
        isResolved: true,
        resolvedBy: { databaseId: 20, actorType: "User" },
        pullRequest: { number: 1, repository: { nameWithOwner: "org/repo" } },
      },
    },
  })),
});
const verifier = (client = api(), props = {}) =>
  new GitHubReviewVerifier({
    repo: "org/repo",
    prNumber: 1,
    prAuthorId: 30,
    api: client,
    ...props,
  });

describe("GitHub provenance and decision authority", () => {
  it("accepts an independent repository writer and rejects bots or the author", async () => {
    const answer = { comment_id: 10, author_id: 20, option_id: "decline" };
    expect(await verifier().authorize(answer, finding)).toBe(true);
    expect(await verifier(api(), { prAuthorId: 20 }).authorize(answer, finding)).toBe(false);
    const bot = api({
      "/repos/org/repo/issues/comments/10": { ...comment, user: { ...comment.user, type: "Bot" } },
    });
    expect(await verifier(bot).authorize(answer, finding)).toBe(false);
  });
  it("requires an explicit mapping when configured and does not fall back from a mapped role", async () => {
    const answer = { comment_id: 10, author_id: 20, option_id: "decline" };
    expect(await verifier(api(), { requireMapping: true }).authorize(answer, finding)).toBe(false);
    expect(
      await verifier(api(), { owners: { policy: ["someone-else"] } }).authorize(answer, finding),
    ).toBe(false);
    expect(
      await verifier(api(), { owners: { policy: ["OWNER"] } }).authorize(answer, finding),
    ).toBe(true);
  });
  it("rejects invalid options, spoofed authors and references to another PR", async () => {
    expect(
      await verifier().authorize({ comment_id: 10, author_id: 20, option_id: "invented" }, finding),
    ).toBe(false);
    expect(
      await verifier().authorize({ comment_id: 10, author_id: 21, option_id: "decline" }, finding),
    ).toBe(false);
    const otherPr = api({
      "/repos/org/repo/issues/comments/10": {
        ...comment,
        issue_url: "https://api.github.com/repos/org/repo/issues/2",
      },
      "/repos/org/repo/pulls/comments/10": {
        ...comment,
        issue_url: "https://api.github.com/repos/org/repo/issues/2",
      },
    });
    expect(
      await verifier(otherPr).authorize(
        { comment_id: 10, author_id: 20, option_id: "decline" },
        finding,
      ),
    ).toBe(false);
    expect(
      await verifier().verify(
        {
          kind: "github_comment",
          comment_id: 10,
          url: "https://github.com/org/repo/pull/2#issuecomment-10",
        },
        head,
      ),
    ).toBe(false);
  });
  it("requires successful CI on the reviewed head, not an earlier green commit", async () => {
    const client = api({
      "/repos/org/repo/check-runs/11": {
        head_sha: head,
        status: "completed",
        conclusion: "success",
      },
    });
    expect(
      await verifier(client).verify(
        { kind: "check_run", check_run_id: 11, commit_sha: head },
        head,
      ),
    ).toBe(true);
    expect(
      await verifier(client).verify(
        { kind: "check_run", check_run_id: 11, commit_sha: "b".repeat(40) },
        head,
      ),
    ).toBe(false);
    const failed = api({
      "/repos/org/repo/check-runs/11": {
        head_sha: head,
        status: "completed",
        conclusion: "failure",
      },
    });
    expect(
      await verifier(failed).verify(
        { kind: "check_run", check_run_id: 11, commit_sha: head },
        head,
      ),
    ).toBe(false);
  });
  it("checks resolver identity and PR provenance; local executor evidence is rejected by this adapter", async () => {
    expect(
      await verifier().dismissal({ kind: "thread_resolution", thread_id: "thread", author_id: 20 }),
    ).toBe(true);
    expect(
      await verifier().dismissal({ kind: "thread_resolution", thread_id: "thread", author_id: 30 }),
    ).toBe(false);
    expect(
      await verifier().dismissal({ kind: "thread_resolution", thread_id: "thread", author_id: 21 }),
    ).toBe(false);
    expect(
      await verifier().verify(
        {
          kind: "verification",
          commit_sha: head,
          command: "npm test",
          result: "passed",
          report_url: "https://example.com/report",
        },
        head,
      ),
    ).toBe(false);
  });
});
