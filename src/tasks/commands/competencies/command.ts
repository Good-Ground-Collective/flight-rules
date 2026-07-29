import { Command } from "commander";
import type { Config } from "../../../shared/config.js";

export function createCompetenciesCommand(getConfig: () => Config): Command {
  const competencies = new Command("competencies");

  competencies.exitOverride().action(() => {
    process.stdout.write(JSON.stringify(getConfig().competencies) + "\n");
  });

  return competencies;
}
