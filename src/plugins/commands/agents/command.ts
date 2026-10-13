import { Command, Option } from "commander";
import { AgentInstallScopeSchema, NativeInstallationError, type AgentInstallScope, type NativeInstallation } from "../../native-installation/native-installation.js";

export function createAgentsCommand(getInstallation: () => NativeInstallation): Command {
  const command = new Command("agents").description("Inspect or install Codex's separate native agent registrations").exitOverride();
  for (const action of ["status", "install"]) {
    command.command(action)
      .description(action === "status" ? "check registration files; native discovery still requires a fresh session" : "copy missing registrations, preserving all differing existing files")
      .addOption(new Option("--scope <scope>", "project or user registration directory").choices(AgentInstallScopeSchema.options).default("project"))
      .exitOverride()
      .action((opts: { scope: AgentInstallScope }) => {
        const installation = getInstallation();
        const report = action === "install" ? installation.install(opts.scope) : installation.status(opts.scope);
        process.stdout.write(`${JSON.stringify(report)}\n`);
        if (!report.ok) throw new NativeInstallationError("Required native registration files are missing or differ; see the report's remedy");
      });
  }
  return command;
}
