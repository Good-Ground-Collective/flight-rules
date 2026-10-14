import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { PullRequestTemplateSchema } from "../git/pr-template/pr-template.js";
import { SemanticTypeSchema } from "../git/semantic-types.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { OperationDescriptor } from "./operation-registry.js";
import type { OperationEffect } from "./operation.schema.js";

const propsSchema = z.strictObject({
  cwd: z.string().min(1),
  getHost: z.custom<() => PullRequestHost>((value) => typeof value === "function"),
});
const createInput = z.strictObject({
  type: SemanticTypeSchema,
  scope: z.string().min(1),
  description: z.string().min(1),
  why: z.string().min(1),
  what: z.array(z.string().min(1).max(256)).min(1).max(5),
  ots: z.string().min(1).optional(),
  base: z.string().min(1),
  head: z.string().min(1),
  ticketId: z.string().min(1).optional(),
  ticketUrl: z.url().optional(),
  reviewer: z.array(z.string()).default([]),
  label: z.array(z.string()).default([]),
  attach: z.array(z.string()).default([]),
});
const commentInput = z.strictObject({
  number: z.number().int().positive(),
  body: z.string(),
  attach: z.array(z.string()).default([]),
});
const listInput = z.strictObject({ ticket: z.array(z.string().min(1)).min(1) });
const reviewInput = z.strictObject({
  number: z.number().int().positive(),
  reviewer: z.array(z.string().min(1)).min(1),
});
const createdSchema = z.object({ number: z.number().int().positive(), url: z.string().url() });
const commentResultSchema = z.object({ url: z.string() });
const openPullRequestSchema = z.object({
  ticket: z.string(),
  number: z.number(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  title: z.string(),
});
const reviewerResultSchema = z.object({
  number: z.number().int().positive(),
  requested: z.array(z.string()),
  failed: z.array(z.object({ login: z.string(), error: z.string() })),
});

export interface PrOperations {
  operations(): OperationDescriptor[];
}

export class PullRequestAttachmentPathError extends Error {
  override name = "PullRequestAttachmentPathError";
}

/** Shares pull-request behavior between CLI and operation transports, binding file access to launch cwd. */
export class DefaultPrOperations implements PrOperations {
  private readonly cwd: string;
  private readonly launchRoot: string;
  private readonly launchDevice: number;
  private readonly launchInode: number;
  private readonly getHost: () => PullRequestHost;

  constructor(props: z.input<typeof propsSchema>) {
    const parsed = propsSchema.parse(props);
    this.cwd = resolve(parsed.cwd);
    this.launchRoot = realpathSync(this.cwd);
    const launchStat = statSync(this.launchRoot);
    this.launchDevice = launchStat.dev;
    this.launchInode = launchStat.ino;
    this.getHost = parsed.getHost;
  }

  operations(): OperationDescriptor[] {
    const effects: OperationEffect[] = ["write", "network", "process"];
    return [
      this.descriptor("pr-create", "Create a pull request from the validated PR template.", ["write", "network", "process"], ["pr", "create"], createInput, createdSchema, async (input) => {
        const template = PullRequestTemplateSchema.parse({
          type: input.type,
          scope: input.scope,
          description: input.description,
          whyWasItChanged: input.why,
          whatWasChanged: input.what,
          baseBranch: input.base,
          headBranch: input.head,
          ...(input.ots === undefined ? {} : { otsMaterials: input.ots }),
          ...(input.ticketId === undefined ? {} : { ticketId: input.ticketId }),
          ...(input.ticketUrl === undefined ? {} : { ticketUrl: input.ticketUrl }),
          reviewers: input.reviewer,
          labels: input.label,
        });
        this.validateAttachments(input.attach);
        return this.getHost().createPullRequest(template, { attach: input.attach });
      }),
      this.descriptor("pr-comment", "Post a comment on a pull request.", effects, ["pr", "comment"], commentInput, commentResultSchema, (input) => {
        this.validateAttachments(input.attach);
        return this.getHost().commentOnPullRequest(input.number, input.body, { attach: input.attach });
      }),
      this.descriptor("pr-list", "List open pull requests matched to ticket identifiers.", ["read", "network", "process"], ["pr", "list"], listInput, z.array(openPullRequestSchema), (input) => this.getHost().listOpenPullRequestsForTickets(input.ticket)),
      this.descriptor("pr-request-review", "Request reviewers for a pull request and preserve each outcome.", effects, ["pr", "request-review"], reviewInput, reviewerResultSchema, async (input) => {
        const result = await this.getHost().requestReviewers(input.number, input.reviewer);
        if (result.failed.length > 0) {
          return {
            status: "partial" as const,
            data: result,
            error: {
              name: "ReviewerRequestPartialFailure",
              message: `reviewer request failed for: ${result.failed.map(({ login }) => login).join(", ")}`,
            },
          };
        }
        return result;
      }),
    ];
  }

  private descriptor<TInput, TOutput>(
    id: string,
    description: string,
    effects: OperationEffect[],
    path: string[],
    inputSchema: z.ZodType<TInput>,
    outputSchema: z.ZodType<TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput> | { status: "partial"; data: TOutput; error: { name: string; message: string } },
  ): OperationDescriptor<TInput, TOutput> {
    return { id, description, effects, cli: { path, aliases: [] }, inputSchema, outputSchema, handler };
  }

  private validateAttachments(specs: readonly string[]): void {
    this.requireOriginalLaunchDirectory();
    for (const spec of specs) {
      const split = spec.indexOf("#");
      const pathname = split < 0 ? spec : spec.slice(0, split);
      if (pathname.length === 0 || (split >= 0 && spec.slice(split + 1).length === 0)) {
        throw new PullRequestAttachmentPathError(`Invalid attachment spec: ${spec}`);
      }
      const candidate = isAbsolute(pathname) ? pathname : resolve(this.cwd, pathname);
      let canonical: string;
      try {
        canonical = realpathSync(candidate);
        if (!statSync(canonical).isFile()) throw new Error("not a file");
      } catch {
        throw new PullRequestAttachmentPathError(`Attachment is not a readable file: ${pathname}`);
      }
      const fromRoot = relative(this.launchRoot, canonical);
      if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
        throw new PullRequestAttachmentPathError(`Attachment must be inside the launch checkout: ${pathname}`);
      }
    }
  }

  private requireOriginalLaunchDirectory(): void {
    try {
      const directory = statSync(this.cwd);
      if (
        realpathSync(this.cwd) !== this.launchRoot ||
        directory.dev !== this.launchDevice ||
        directory.ino !== this.launchInode
      ) {
        throw new Error("replaced");
      }
    } catch {
      throw new PullRequestAttachmentPathError(
        `The launch checkout was moved or replaced: ${this.cwd}`,
      );
    }
  }
}
