import { Command } from "commander";
import { z } from "zod";
import { StdioFlightRulesMcpTransport } from "./stdio.js";

const CommandOptionsSchema = z.object({
  allowOperation: z.array(z.string()).default([]),
  allowEffect: z.array(z.enum(["read", "write", "network", "process"])).default([]),
  allowConfigScope: z.array(z.enum(["user", "project", "local", "file"])).default([]),
});

/** Builds the local stdio launcher; request arguments cannot change these grants. */
export function createMcpCommand(): Command {
  return new Command("mcp")
    .description("Serve flight-rules operations and canonical instructions over MCP stdio")
    .option("--allow-operation <id...>", "allow the named operation (repeatable)", [])
    .option("--allow-effect <effect...>", "allow operations with each named effect", [])
    .option("--allow-config-scope <scope...>", "allow config writes in the named scope", [])
    .action(async (options: unknown) => {
      const parsed = CommandOptionsSchema.parse(options);
      await new StdioFlightRulesMcpTransport({
        cwd: process.cwd(),
        env: { ...process.env },
        allowedOperationIds: parsed.allowOperation,
        allowedEffects: [
          ...new Set(["read", "process", "network", ...parsed.allowEffect] as const),
        ],
        allowedConfigScopes: parsed.allowConfigScope,
      }).serve();
    });
}
