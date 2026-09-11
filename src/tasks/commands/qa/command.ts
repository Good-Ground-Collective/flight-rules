import { existsSync, statSync } from "node:fs";
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
      const config = getConfig();
      if (config.qaRecipe !== undefined && config.qaRecipe.trim() === "") {
        throw new Error(
          "qaRecipe is set to a blank value — give it a path to the QA recipe file, or remove the key to fall back to the default beside the config",
        );
      }
      const path = getQaRecipePath(config, getConfigPath());
      if (!existsSync(path)) {
        throw new Error(
          `QA recipe not found at ${path} — run /flight-rules:setup to scaffold it, or set qaRecipe in the config`,
        );
      }
      if (!statSync(path).isFile()) {
        throw new Error(
          `QA recipe at ${path} is not a regular file — set qaRecipe to the recipe file's path`,
        );
      }
      process.stdout.write(`${path}\n`);
    });

  return qa;
}
