import { Command } from "commander";

export function createConfigCommand(getConfigPath: () => string): Command {
  const config = new Command("config");
  config.exitOverride();
  config.command("path")
    .description("print the resolved config file path, whether or not it exists")
    .exitOverride()
    .action(() => {
      process.stdout.write(`${getConfigPath()}\n`);
    });
  return config;
}
