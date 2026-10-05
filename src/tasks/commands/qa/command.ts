import { Command } from "commander";
import { getQaRecipePath } from "../../../shared/config.js";
import type { Config } from "../../../shared/config.js";
import { QaInstructionsFinder } from "../../qa-instructions/qa-instructions.js";
import type { EvidenceLocation } from "../../evidence/evidence-location.js";

export function createQaCommand(
  getConfig: () => Config,
  getConfigPath: () => string,
  getFinder: () => QaInstructionsFinder = () => new QaInstructionsFinder(),
  getEvidence?: () => EvidenceLocation,
): Command {
  const qa = new Command("qa");

  // The legacy recipe is only a fallback, and QA instructions must be readable
  // in a repo that has no flight-rules config at all.
  const legacyRecipePath = (): string | undefined => {
    let config: Config;
    try {
      config = getConfig();
    } catch {
      return undefined;
    }
    if (config.qaRecipe !== undefined && config.qaRecipe.trim() === "") {
      throw new Error(
        "qaRecipe is set to a blank value — remove the key and move the recipe into a QA.md (see docs/qa-instructions.md)",
      );
    }
    return getQaRecipePath(config, getConfigPath());
  };

  qa.command("instructions")
    .description("print the QA instructions that apply to a directory, nearest first, as JSON")
    .option("--from <dir>", "directory (or file) to start from; defaults to the working directory")
    .exitOverride()
    .action((opts: { from?: string }) => {
      const result = getFinder().discover({
        from: opts.from ?? process.cwd(),
        legacyRecipePath: legacyRecipePath(),
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  qa.command("evidence-dir")
    .description("print where QA evidence for a ticket is written, and whether git ignores it, as JSON")
    .argument("<ticket>")
    .exitOverride()
    .action((ticket: string) => {
      if (getEvidence === undefined) throw new Error("evidence location is not available in this program");
      process.stdout.write(JSON.stringify(getEvidence().dirFor(ticket)) + "\n");
    });

  qa.command("recipe")
    .description("deprecated: print the path of the nearest QA instructions; use `qa instructions`")
    .exitOverride()
    .action(() => {
      const [nearest] = getFinder().discover({
        from: process.cwd(),
        legacyRecipePath: legacyRecipePath(),
      }).sources;
      if (nearest === undefined) {
        throw new Error(
          "No QA instructions found — add a QA.md at the repo root or a QA section in AGENTS.md (see docs/qa-instructions.md)",
        );
      }
      process.stderr.write(
        "`flight-rules qa recipe` is deprecated; use `flight-rules qa instructions`\n",
      );
      process.stdout.write(`${nearest.path}\n`);
    });

  return qa;
}
