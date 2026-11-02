import { mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestHost } from "../../pr/pull-request-host/pull-request-host.js";
import { DefaultPrOperations } from "../pr-operations.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
  OperationInputError,
} from "../operation-registry.js";

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "flight-rules-pr-ops-"));
  roots.push(root);
  await writeFile(join(root, "capture.png"), "fixture");
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hostFixture = (): PullRequestHost => ({
  createPullRequest: vi.fn().mockResolvedValue({ number: 12, url: "https://github.com/o/r/pull/12" }),
  commentOnPullRequest: vi.fn().mockResolvedValue({ url: "https://github.com/o/r/pull/12#issuecomment-2" }),
  listOpenPullRequestsForTickets: vi.fn().mockResolvedValue([
    { ticket: "KAN-31", number: 12, url: "https://github.com/o/r/pull/12", headRefName: "feat/KAN-31-x", baseRefName: "main", title: "feat(KAN-31): x" },
  ]),
  defaultBranch: vi.fn().mockResolvedValue("main"),
  requestReviewers: vi.fn().mockResolvedValue({ number: 12, requested: ["alice"], failed: [{ login: "bob", error: "not found" }] }),
  listReviewThreads: vi.fn(),
  replyToReviewThread: vi.fn(),
});

const registryFor = (cwd: string, host: PullRequestHost, allowedEffects: Array<"read" | "write" | "network" | "process"> = ["read", "write", "network", "process"]) =>
  new MapOperationRegistry({
    operations: new DefaultPrOperations({ cwd, getHost: () => host }).operations(),
    policy: new LaunchOperationAccessPolicy({ allowedEffects }),
  });

describe("shared PR operations", () => {
  it("exposes all six routes and uses the existing host for create, comment, and list", async () => {
    const cwd = await makeRoot();
    const host = hostFixture();
    const registry = registryFor(cwd, host);
    expect(registry.list().map(({ id, cli }) => [id, cli.path])).toEqual([
      ["pr-create", ["pr", "create"]],
      ["pr-comment", ["pr", "comment"]],
      ["pr-list", ["pr", "list"]],
      ["pr-threads", ["pr", "threads"]],
      ["pr-thread-reply", ["pr", "thread-reply"]],
      ["pr-request-review", ["pr", "request-review"]],
    ]);
    const create = await registry.invoke("pr-create", {
      type: "feat", scope: "KAN-31", description: "add support", why: "Because.", what: ["Added it."],
      base: "main", head: "feat/KAN-31-add-support", attach: ["./capture.png#Screen"],
    });
    expect(create).toEqual({ status: "success", data: { number: 12, url: "https://github.com/o/r/pull/12" } });
    expect(vi.mocked(host.createPullRequest)).toHaveBeenCalledWith(expect.objectContaining({
      type: "feat", scope: "KAN-31", description: "add support", whatWasChanged: ["Added it."],
      whyWasItChanged: "Because.", baseBranch: "main", headBranch: "feat/KAN-31-add-support",
    }), { attach: ["./capture.png#Screen"] });

    const body = "line one\r\n  preserve trailing spaces  \n";
    expect(await registry.invoke("pr-comment", { number: 12, body, attach: [] })).toEqual({
      status: "success", data: { url: "https://github.com/o/r/pull/12#issuecomment-2" },
    });
    expect(vi.mocked(host.commentOnPullRequest)).toHaveBeenCalledWith(12, body, { attach: [] });
    expect(await registry.invoke("pr-list", { ticket: ["KAN-31"] })).toEqual({
      status: "success", data: await host.listOpenPullRequestsForTickets(["KAN-31"]),
    });
  });

  it("validates PR numbers, reviewers, ticket IDs, and template constraints before the host", async () => {
    const cwd = await makeRoot();
    const host = hostFixture();
    const registry = registryFor(cwd, host);
    for (const [id, input] of [
      ["pr-comment", { number: 0, body: "x" }],
      ["pr-request-review", { number: 2, reviewer: [] }],
      ["pr-request-review", { number: -1, reviewer: ["alice"] }],
      ["pr-threads", { number: 0 }],
      ["pr-threads", { number: 1, trustedAuthors: [""] }],
      ["pr-thread-reply", { threadId: "", body: "x" }],
      ["pr-thread-reply", { threadId: "PRRT_1", body: "" }],
      ["pr-thread-reply", { threadId: "PRRT_1" }],
      ["pr-thread-reply", { body: "x" }],
      ["pr-list", { ticket: [""] }],
      ["pr-list", { ticket: [] }],
      ["pr-create", { type: "invalid", scope: "x", description: "x", why: "x", what: ["x"], base: "main", head: "topic" }],
    ] as const) {
      await expect(registry.invoke(id, input)).rejects.toBeInstanceOf(OperationInputError);
    }
    expect(host.createPullRequest).not.toHaveBeenCalled();
    expect(host.commentOnPullRequest).not.toHaveBeenCalled();
    expect(host.listOpenPullRequestsForTickets).not.toHaveBeenCalled();
    expect(host.requestReviewers).not.toHaveBeenCalled();
    expect(host.listReviewThreads).not.toHaveBeenCalled();
    expect(host.replyToReviewThread).not.toHaveBeenCalled();
  });

  it("passes trusted authors to the host and validates the threads result", async () => {
    const host = hostFixture();
    const result = {
      pullRequest: { number: 12, url: "u", title: "t", body: "b", headRefName: "h", headRefOid: "o", baseRefName: "main", authorLogin: "dev" },
      threads: [{
        id: "T1", path: "a.ts", line: null, originalLine: 4, isResolved: false, isOutdated: true,
        commentsTruncated: false, finding: null, markerError: "bad marker",
        comments: [{ id: "C1", url: "u", authorLogin: "bot", authorType: "Bot" as const, body: "x", createdAt: "2026-01-01T00:00:00Z" }],
      }],
    };
    vi.mocked(host.listReviewThreads).mockResolvedValue(result);
    const registry = registryFor(await makeRoot(), host, ["read", "network", "process"]);
    expect(await registry.invoke("pr-threads", { number: 12, trustedAuthors: ["bot"] })).toEqual({ status: "success", data: result });
    expect(host.listReviewThreads).toHaveBeenCalledWith(12, { trustedAuthors: ["bot"] });
    await registry.invoke("pr-threads", { number: 12 });
    expect(host.listReviewThreads).toHaveBeenLastCalledWith(12, { trustedAuthors: [] });
  });

  it("replies in a review thread through the host and returns the new comment", async () => {
    const host = hostFixture();
    vi.mocked(host.replyToReviewThread).mockResolvedValue({ id: "PRRC_1", url: "https://github.com/o/r/pull/12#discussion_r1" });
    const registry = registryFor(await makeRoot(), host);
    const body = "line one\r\n  keep spaces  \n";
    expect(await registry.invoke("pr-thread-reply", { threadId: "PRRT_1", body })).toEqual({
      status: "success", data: { id: "PRRC_1", url: "https://github.com/o/r/pull/12#discussion_r1" },
    });
    expect(host.replyToReviewThread).toHaveBeenCalledWith("PRRT_1", body);
    expect(registry.list().find(({ id }) => id === "pr-thread-reply")?.effects).toEqual(["write", "network", "process"]);
    expect(registry.list().map(({ id }) => id).filter((id) => /resolve/.test(id))).toEqual([]);
  });

  it("denies thread replies without the write grant before the host", async () => {
    const host = hostFixture();
    const registry = registryFor(await makeRoot(), host, ["read", "network", "process"]);
    expect(await registry.invoke("pr-thread-reply", { threadId: "PRRT_1", body: "x" })).toMatchObject({
      status: "error", error: { name: "OperationAccessDeniedError" },
    });
    expect(host.replyToReviewThread).not.toHaveBeenCalled();
  });

  it("denies mutations before host calls and rejects missing or symlinked-out attachments", async () => {
    const cwd = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "flight-rules-pr-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.png"), "secret");
    await symlink(join(outside, "secret.png"), join(cwd, "linked.png"));
    const host = hostFixture();
    const denied = registryFor(cwd, host, ["read", "network", "process"]);
    expect(await denied.invoke("pr-comment", { number: 12, body: "write" })).toMatchObject({
      status: "error", error: { name: "OperationAccessDeniedError" },
    });
    const allowed = registryFor(cwd, host);
    for (const attach of ["./missing.png#Missing", "./linked.png#Outside"]) {
      expect(await allowed.invoke("pr-comment", { number: 12, body: "write", attach: [attach] })).toMatchObject({
        status: "error", error: { name: "PullRequestAttachmentPathError" },
      });
    }
    expect(host.commentOnPullRequest).not.toHaveBeenCalled();
  });

  it("returns per-reviewer partial outcomes for CLI failure handling without retrying", async () => {
    const cwd = await makeRoot();
    const host = hostFixture();
    const response = await registryFor(cwd, host).invoke("pr-request-review", {
      number: 12, reviewer: ["alice", "bob"],
    });
    expect(response).toEqual({
      status: "partial",
      data: { number: 12, requested: ["alice"], failed: [{ login: "bob", error: "not found" }] },
      error: { name: "ReviewerRequestPartialFailure", message: "reviewer request failed for: bob" },
    });
    expect(host.requestReviewers).toHaveBeenCalledTimes(1);
    expect(host.requestReviewers).toHaveBeenCalledWith(12, ["alice", "bob"]);
  });
});
