import { existsSync } from "node:fs";
import { Command } from "commander";
import { getQaRecipePath } from "../../../shared/config.js";
import type { Config } from "../../../shared/config.js";

export function createQaCommand(
  getConfig: () => Config,
  getConfigPath: () => string,
): Command {
  const qa = new Command("qa");

  qa.command("recipe")
    .exitOverride()
    .action(() => {
      const path = getQaRecipePath(getConfig(), getConfigPath());
      if (!existsSync(path)) {
        throw new Error(
          `QA recipe not found at ${path} — run /flight-rules:setup to scaffold it, or set qaRecipe in the config`,
        );
      }
      process.stdout.write(`${path}\n`);
    });

  return qa;
}
