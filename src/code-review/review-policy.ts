import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DocCharterCatalog,
  type Charter,
} from "../bundled-docs/charter-catalog/charter-catalog.js";
import { FileDocResolver } from "../bundled-docs/doc-resolver/doc-resolver.js";
import { HeadShaSchema, ReviewPathSchema } from "./review.schema.js";

const ReviewPolicyPropsSchema = z.strictObject({
  home: z.string().min(1).optional(),
  env: z
    .custom<NodeJS.ProcessEnv>(
      (value): value is NodeJS.ProcessEnv =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .optional(),
});
const LoadPolicyPropsSchema = z.strictObject({ paths: z.array(z.string()).optional() });
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
export interface LoadedReviewPolicy {
  method: string;
  /** The core charter followed by each selected language charter, as one document. */
  charter: string;
  /** The same charters, one entry per document. */
  charters: Pick<Charter, "id" | "language" | "appliesTo" | "tierA" | "contents">[];
  /** Every Tier A mandate the selected charters define, core first; a review accounts for each one. */
  tierA: string[];
  contract: string;
}
export interface ReviewPolicy {
  /**
   * With `paths`, selects the core charter plus the language charters governing those files;
   * without, every language charter, each scoped by its own `applies-to` globs.
   */
  load(input?: z.input<typeof LoadPolicyPropsSchema>): LoadedReviewPolicy;
  repository(input: z.input<typeof RepositoryContextPropsSchema>): RepositoryReviewContext;
}

/** Loads one review method for local skills and Actions, with repo rules read only from a pinned trusted commit. */
export class FileReviewPolicy implements ReviewPolicy {
  private readonly home: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(props: z.input<typeof ReviewPolicyPropsSchema> = {}) {
    const parsed = ReviewPolicyPropsSchema.parse(props);
    this.home = parsed.home ?? join(dirname(fileURLToPath(import.meta.url)), "..");
    this.env = props.env ?? process.env;
  }

  load(input: z.input<typeof LoadPolicyPropsSchema> = {}): LoadedReviewPolicy {
    const { paths } = LoadPolicyPropsSchema.parse(input);
    const docs = realpathSync(join(this.home, "docs"));
    const read = (id: string): string => {
      const path = realpathSync(join(docs, `${id}.md`));
      if (relative(docs, path).startsWith(".."))
        throw new ReviewPolicyError("review policy path leaves the installed docs directory");
      return readFileSync(path, "utf8");
    };

    const catalog = new DocCharterCatalog({ docs: new FileDocResolver({ docsDir: docs }) });
    const charters = (paths === undefined ? catalog.all() : catalog.select(paths)).map(
      ({ id, language, appliesTo, tierA, contents }) => ({
        id,
        language,
        appliesTo,
        tierA,
        contents,
      }),
    );

    return {
      method: read("autonomous-review-method"),
      charter: charters
        .map(({ contents }) => (contents.endsWith("\n") ? contents : `${contents}\n`))
        .join("\n"),
      charters,
      tierA: [...new Set(charters.flatMap(({ tierA }) => tierA))],
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
        env: this.env,
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
          env: this.env,
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
