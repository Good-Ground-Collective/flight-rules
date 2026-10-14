import { Command } from "commander";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ReviewOperationsLaunchPropsSchema } from "../operations/review-operations.js";
import { StdioFlightRulesMcpTransport } from "./stdio.js";

const CommandOptionsSchema = z.object({
  allowOperation: z.array(z.string()).default([]),
  allowEffect: z.array(z.enum(["read", "write", "network", "process"])).default([]),
  allowConfigScope: z.array(z.enum(["user", "project", "local", "file"])).default([]),
  reviewRef: z.string().optional(),
  reviewOwnersFile: z.string().min(1).optional(),
  requireReviewMapping: z.boolean().default(false),
});

/** Builds the local stdio launcher; request arguments cannot change these grants. */
export function createMcpCommand(): Command {
  return new Command("mcp")
    .description("Serve flight-rules operations and canonical instructions over MCP stdio")
    .option("--allow-operation <id...>", "allow the named operation (repeatable)", [])
    .option("--allow-effect <effect...>", "allow operations with each named effect", [])
    .option("--allow-config-scope <scope...>", "allow config writes in the named scope", [])
    .option("--review-ref <sha>", "bind review context to this trusted full commit SHA")
    .option("--review-owners-file <path>", "load trusted review role-to-login mappings from JSON")
    .option(
      "--require-review-mapping",
      "require every decision owner to have a trusted login mapping",
      false,
    )
    .action(async (options: unknown) => {
      const parsed = CommandOptionsSchema.parse(options);
      const owners =
        parsed.reviewOwnersFile === undefined
          ? {}
          : ReviewOperationsLaunchPropsSchema.shape.owners.parse(
              JSON.parse(readFileSync(parsed.reviewOwnersFile, "utf8")),
            );
      await new StdioFlightRulesMcpTransport({
        cwd: process.cwd(),
        env: { ...process.env },
        allowedOperationIds: parsed.allowOperation,
        allowedEffects: [
          ...new Set(["read", "process", "network", ...parsed.allowEffect] as const),
        ],
        allowedConfigScopes: parsed.allowConfigScope,
        trustedRef: parsed.reviewRef,
        owners,
        requireMapping: parsed.requireReviewMapping,
      }).serve();
    });
}
