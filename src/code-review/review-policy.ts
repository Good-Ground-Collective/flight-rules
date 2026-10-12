import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { HeadShaSchema, ReviewPathSchema } from "./review.schema.js";

const ReviewPolicyPropsSchema = z.strictObject({ home: z.string().min(1).optional() });
const RepositoryContextPropsSchema = z.strictObject({
  cwd: z.string().min(1),
  trustedRef: HeadShaSchema,
  contextPath: ReviewPathSchema.min(1).default("CODE-REVIEW.md"),
});
export interface RepositoryReviewContext {
  trustedRef: string;
  contextPath: string;
  sources: { path: string; contents: string }[];
  missing: string[];
}
export interface ReviewPolicy {
  load(): { method: string; charter: string; contract: string };
  repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext;
}

/** Loads one review method for local skills and Actions, with repo rules read only from a pinned trusted commit. */
export class FileReviewPolicy implements ReviewPolicy {
  private readonly home: string;

  constructor(props: z.input<typeof ReviewPolicyPropsSchema> = {}) {
    const parsed = ReviewPolicyPropsSchema.parse(props);
    this.home = parsed.home ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  }

  load(): { method: string; charter: string; contract: string } {
    const docs = realpathSync(join(this.home, "docs"));
    const read = (id: string): string => {
      const path = realpathSync(join(docs, `${id}.md`));
      if (relative(docs, path).startsWith(".."))
        throw new ReviewPolicyError("review policy path leaves the installed docs directory");
      return readFileSync(path, "utf8");
    };
    return {
      method: read("autonomous-review-method"),
      charter: read("coding-charter"),
      contract: read("code-review-findings-contract"),
    };
  }

  repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext {
    const props = RepositoryContextPropsSchema.parse(input);
    const paths = [
      ...new Set([
        props.contextPath,
        "AGENTS.md",
        "CLAUDE.md",
        ".github/CODEOWNERS",
        "CODEOWNERS",
        "docs/CODEOWNERS",
      ]),
    ];
    const sources: RepositoryReviewContext["sources"] = [];
    const missing: string[] = [];
    for (const path of paths) {
      const tree = execFileSync("git", ["ls-tree", "-z", props.trustedRef, "--", path], {
        cwd: props.cwd,
        encoding: "utf8",
      });
      if (!tree) {
        missing.push(path);
        continue;
      }
      if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(tree))
        throw new ReviewPolicyError(`review rules must be a regular file: ${path}`);
      sources.push({
        path,
        contents: execFileSync("git", ["show", `${props.trustedRef}:${path}`], {
          cwd: props.cwd,
          encoding: "utf8",
          maxBuffer: 10_000_000,
        }),
      });
    }
    return { trustedRef: props.trustedRef, contextPath: props.contextPath, sources, missing };
  }
}

export class ReviewPolicyError extends Error {
  override name = "ReviewPolicyError";
}
