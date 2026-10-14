import { readFileSync } from "node:fs";
import { Command } from "commander";
import { z } from "zod";
import { OperationCliError, type OperationRegistry } from "../../operations/operation-registry.js";
import type { ReviewOperationsLaunchProps } from "../../operations/review-operations.js";

export interface ReviewCommandProps {
  registry: OperationRegistry;
  defaultCwd: string;
  createTrustedRegistry(props: ReviewOperationsLaunchProps): OperationRegistry;
}

export interface ReviewCommandAdapter {
  create(): Command;
}

const ReviewCommandPropsSchema = z.object({
  registry: z.custom<OperationRegistry>((value) =>
    Boolean(value && typeof value === "object" && "invoke" in value),
  ),
  defaultCwd: z.string().min(1),
  createTrustedRegistry: z.custom<ReviewCommandProps["createTrustedRegistry"]>(
    (value) => typeof value === "function",
  ),
});

/** Adapts review CLI file arguments and output formatting to shared in-process operations. */
export class CommanderReviewCommand implements ReviewCommandAdapter {
  private readonly registry: OperationRegistry;
  private readonly defaultCwd: string;
  private readonly createTrustedRegistry: ReviewCommandProps["createTrustedRegistry"];

  constructor(props: ReviewCommandProps) {
    const parsed = ReviewCommandPropsSchema.parse(props);
    this.registry = parsed.registry;
    this.defaultCwd = parsed.defaultCwd;
    this.createTrustedRegistry = parsed.createTrustedRegistry;
  }

  create(): Command {
    const review = new Command("review").description(
      "shared autonomous review contract, policy and evidence-checked plans",
    );
    review
      .command("schema")
      .option("--transport", "print the model-facing superset instead of the full schema")
      .action(async (opts: { transport?: boolean }) => {
        const schema = await this.invoke("review-schema", { transport: opts.transport ?? false });
        process.stdout.write(JSON.stringify(schema, null, 2) + "\n");
      });
    review
      .command("validate")
      .argument("<file>", "structured reviewer result")
      .action(async (file: string) => {
        const result = await this.invoke("review-validate", {
          review: JSON.parse(readFileSync(file, "utf8")),
        });
        process.stdout.write(JSON.stringify(result) + "\n");
      });
    review
      .command("render")
      .argument("<plan>", "evidence-checked plan JSON")
      .action(async (file: string) => {
        const plan = z
          .looseObject({
            review: z.json(),
            records: z.array(z.json()),
            outcome: z.string(),
            problems: z.array(z.string()),
          })
          .parse(JSON.parse(readFileSync(file, "utf8")));
        const result = await this.invoke("review-render", {
          review: plan.review,
          records: plan.records,
          outcome: plan.outcome,
          problems: plan.problems,
        });
        process.stdout.write(JSON.stringify(result) + "\n");
      });
    review
      .command("state")
      .argument("<file>", "index with actual persisted artifact IDs")
      .action(async (file: string) => {
        const result = await this.invoke("review-state", {
          state: JSON.parse(readFileSync(file, "utf8")),
        });
        process.stdout.write(`${z.string().parse(result)}\n`);
      });
    review
      .command("context")
      .requiredOption("--ref <sha>", "pinned trusted default-branch commit")
      .option("--path <path>", "repo review-context file", "CODE-REVIEW.md")
      .option("--cwd <directory>", "trusted repository checkout", this.defaultCwd)
      .action(async (opts: { ref: string; path: string; cwd: string }) => {
        const registry = this.createTrustedRegistry({ cwd: opts.cwd, trustedRef: opts.ref });
        const result = await this.invokeWithRegistry(registry, "review-context", {
          contextPath: opts.path,
        });
        process.stdout.write(JSON.stringify(result) + "\n");
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
          const input = {
            number: z.coerce.number().int().positive().parse(number),
            repo: opts.repo,
            review: JSON.parse(readFileSync(opts.file, "utf8")),
            records: JSON.parse(readFileSync(opts.recordsFile, "utf8")),
          };
          const owners =
            opts.ownersFile === undefined
              ? {}
              : z
                  .record(z.string(), z.array(z.string().min(1)))
                  .parse(JSON.parse(readFileSync(opts.ownersFile, "utf8")));
          const registry = this.createTrustedRegistry({
            owners,
            requireMapping: opts.requireMapping ?? false,
          });
          const result = await this.invokeWithRegistry(registry, "review-plan", input);
          process.stdout.write(JSON.stringify(result) + "\n");
        },
      );
    return review;
  }

  private async invoke(id: string, input: unknown): Promise<unknown> {
    return this.invokeWithRegistry(this.registry, id, input);
  }

  private async invokeWithRegistry(
    registry: OperationRegistry,
    id: string,
    input: unknown,
  ): Promise<unknown> {
    const result = await registry.invoke(id, input);
    if (result.status === "error")
      throw new OperationCliError({
        operationId: id,
        errorName: result.error.name,
        message: result.error.message,
      });
    if (result.status === "partial")
      throw new OperationCliError({
        operationId: id,
        errorName: result.error.name,
        message: result.error.message,
      });
    return result.data;
  }
}

export function createReviewCommand(props: ReviewCommandProps): Command {
  return new CommanderReviewCommand(props).create();
}
