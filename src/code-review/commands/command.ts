import { readFileSync } from "node:fs";
import { Command } from "commander";
import { z } from "zod";
import { reviewContract } from "../review-contract.js";
import { FileReviewPolicy } from "../review-policy.js";
import { EvidenceReviewPlanner } from "../review-planner.js";
import { GhReviewGitHubApi, GitHubReviewVerifier } from "../github-review-verifier.js";
import { JsonReviewCodec } from "../review-codec.js";
import { FindingRecordSchema, ReviewStateSchema } from "../review.schema.js";

export function createReviewCommand(): Command {
  const review = new Command("review").description(
    "shared autonomous review contract, policy and evidence-checked plans",
  );
  review
    .command("schema")
    .option("--transport", "print the model-facing superset instead of the full schema")
    .action((opts: { transport?: boolean }) => {
      const schemas = reviewContract.schemas();
      process.stdout.write(
        JSON.stringify(opts.transport ? schemas.transport : schemas.full, null, 2) + "\n",
      );
    });
  review
    .command("validate")
    .argument("<file>", "structured reviewer result")
    .action((file: string) => {
      process.stdout.write(
        JSON.stringify(reviewContract.parse(JSON.parse(readFileSync(file, "utf8")))) + "\n",
      );
    });
  review
    .command("render")
    .argument("<plan>", "evidence-checked plan JSON")
    .action((file: string) => {
      const plan = z
        .looseObject({
          review: z.unknown(),
          records: z.array(FindingRecordSchema),
          outcome: z.string(),
          problems: z.array(z.string()),
        })
        .parse(JSON.parse(readFileSync(file, "utf8")));
      const result = reviewContract.parse(plan.review);
      const codec = new JsonReviewCodec();
      process.stdout.write(
        JSON.stringify({
          headSha: result.head_sha,
          outcome: plan.outcome,
          problems: plan.problems,
          findings: plan.records.map((record) => ({
            id: record.finding.id,
            status: record.status,
            path: record.finding.path,
            line: record.finding.line,
            body: codec.render(record),
          })),
        }) + "\n",
      );
    });
  review
    .command("state")
    .argument("<file>", "index with actual persisted artifact IDs")
    .action((file: string) => {
      process.stdout.write(
        new JsonReviewCodec().state(
          ReviewStateSchema.parse(JSON.parse(readFileSync(file, "utf8"))),
        ) + "\n",
      );
    });
  review
    .command("context")
    .requiredOption("--ref <sha>", "pinned trusted default-branch commit")
    .option("--path <path>", "repo review-context file", "CODE-REVIEW.md")
    .option("--cwd <directory>", "repository checkout", process.cwd())
    .action((opts: { ref: string; path: string; cwd: string }) => {
      process.stdout.write(
        JSON.stringify(
          new FileReviewPolicy().repository({
            cwd: opts.cwd,
            trustedRef: opts.ref,
            contextPath: opts.path,
          }),
        ) + "\n",
      );
    });
  review
    .command("plan")
    .argument("<number>")
    .requiredOption("--repo <repo>", "owner/name")
    .requiredOption("--file <path>", "structured reviewer result")
    .requiredOption(
      "--records-file <path>",
      "trusted prior records from GitHub; [] for a first review",
    )
    .option("--owners-file <path>", "trusted role-to-login authority mapping")
    .option("--require-mapping", "reject independent-writer fallback")
    .action(
      async (
        number: string,
        opts: {
          repo: string;
          file: string;
          recordsFile: string;
          ownersFile?: string;
          requireMapping?: boolean;
        },
      ) => {
        const prNumber = z.coerce.number().int().positive().parse(number);
        const api = new GhReviewGitHubApi();
        const pr = z
          .looseObject({
            head: z.looseObject({ sha: z.string() }),
            user: z.looseObject({ id: z.number() }),
          })
          .parse(await api.get(`/repos/${opts.repo}/pulls/${prNumber}`));
        const owners =
          opts.ownersFile === undefined
            ? {}
            : z
                .record(z.string(), z.array(z.string()))
                .parse(JSON.parse(readFileSync(opts.ownersFile, "utf8")));
        const planner = new EvidenceReviewPlanner({
          verifier: new GitHubReviewVerifier({
            api,
            repo: opts.repo,
            prNumber,
            prAuthorId: pr.user.id,
            owners,
            requireMapping: opts.requireMapping ?? false,
          }),
        });
        const records: unknown[] = z
          .array(z.unknown())
          .parse(JSON.parse(readFileSync(opts.recordsFile, "utf8")));
        const result = await planner.plan({
          review: JSON.parse(readFileSync(opts.file, "utf8")),
          records,
          headSha: pr.head.sha,
        });
        process.stdout.write(JSON.stringify(result) + "\n");
      },
    );
  return review;
}
