import { text } from "node:stream/consumers";
import { Option } from "commander";
import type { Command } from "commander";
import { z } from "zod";
import { configScopes, type ConfigScope } from "../shared/config-store.js";
import { ReadinessFailedError } from "../tasks/commands/check/command.js";
import { ReadinessOptionsSchema, WorkflowSchema } from "../tasks/readiness/readiness.schema.js";
import { OperationCliError, type OperationRegistry } from "./operation-registry.js";

const CharterResultSchema = z.object({
  charters: z.array(
    z.object({ path: z.string(), contents: z.string(), language: z.string().nullable() }),
  ),
  unmatched: z.boolean(),
});
const ConfigPathResultSchema = z.object({ path: z.string() });
const RfcIdResultSchema = z.object({ id: z.string() });
const CompetenciesResultSchema = z.array(z.string());
const ConfigInspectionResultSchema = z.object({
  host: z.string(),
  valid: z.boolean(),
  values: z.record(z.string(), z.unknown()),
  sources: z.record(z.string(), z.unknown()),
  layers: z.array(z.unknown()),
  error: z.string().optional(),
});
const ReadinessResultSchema = z.object({
  tracker: z.string().nullable(),
  repo: z.string().nullable().optional(),
  checks: z.array(z.unknown()),
  ok: z.boolean(),
  workflow: WorkflowSchema.optional(),
  scope: z.enum(["environment", "workflow"]),
});

export interface LocalDiscoveryCliProps {
  registry: OperationRegistry;
  readStdin?: () => Promise<string>;
}
export interface LocalDiscoveryCommandAdapter {
  addTo(program: Command): void;
}
const LocalDiscoveryCliPropsSchema = z.object({
  registry: z.custom<OperationRegistry>(
    (value) => typeof value === "object" && value !== null && "invoke" in value,
  ),
  readStdin: z.custom<() => Promise<string>>((value) => typeof value === "function").optional(),
});

/** Adapts Commander arguments and terminal rendering to the shared local operations. */
export class CommanderLocalDiscoveryCli implements LocalDiscoveryCommandAdapter {
  private readonly registry: OperationRegistry;
  private readonly readStdin: () => Promise<string>;

  constructor(props: LocalDiscoveryCliProps) {
    const parsed = LocalDiscoveryCliPropsSchema.parse(props);
    this.registry = parsed.registry;
    this.readStdin = parsed.readStdin ?? (() => text(process.stdin));
  }

  addTo(program: Command): void {
    this.addCharter(program);
    this.addCompetencies(program);
    this.addRfc(program);
    this.addQa(program);
    this.addConfig(program);
    this.addCheck(program);
  }

  private addCharter(program: Command): void {
    program
      .command("charter")
      .description("print the core coding charter and language charters for selected files")
      .argument("[paths...]")
      .option("--stdin")
      .option("--diff <base>")
      .option("--repo")
      .option("--path")
      .exitOverride()
      .action(
        async (
          paths: string[],
          opts: { stdin?: boolean; diff?: string; repo?: boolean; path?: boolean },
        ) => {
          const selectedSources = [
            paths.length > 0,
            opts.stdin === true,
            opts.diff !== undefined,
            opts.repo === true,
          ];
          if (selectedSources.filter(Boolean).length > 1)
            throw new CharterSelectionError("Choose one of: paths, --stdin, --diff <base>, --repo");
          const selectedPaths = opts.stdin ? (await this.readStdin()).split("\n") : paths;
          const input = {
            ...(opts.stdin || paths.length > 0 ? { paths: selectedPaths } : {}),
            ...(opts.diff === undefined ? {} : { diff: opts.diff }),
            repository: opts.repo ?? false,
            pathOutput: opts.path ?? false,
          };
          const result = await this.invoke("charter", input, CharterResultSchema);
          if (result.unmatched)
            process.stderr.write(
              "No language charter matched these files; printing the core charter only.\n",
            );
          const output = opts.path
            ? result.charters.map((charter) => `${charter.path}\n`).join("")
            : result.charters
                .map((charter) =>
                  charter.contents.endsWith("\n") ? charter.contents : `${charter.contents}\n`,
                )
                .join("\n");
          process.stdout.write(output);
        },
      );
  }

  private addCompetencies(program: Command): void {
    program
      .command("competencies")
      .exitOverride()
      .action(async () => {
        process.stdout.write(
          `${JSON.stringify(await this.invoke("competencies", {}, CompetenciesResultSchema))}\n`,
        );
      });
  }

  private addRfc(program: Command): void {
    const rfc = program.command("rfc");
    rfc
      .command("dir")
      .exitOverride()
      .action(async () => {
        process.stdout.write(
          `${(await this.invoke("rfc-dir", {}, ConfigPathResultSchema)).path}\n`,
        );
      });
    rfc
      .command("next-id")
      .exitOverride()
      .action(async () => {
        process.stdout.write(`${(await this.invoke("rfc-next-id", {}, RfcIdResultSchema)).id}\n`);
      });
  }

  private addQa(program: Command): void {
    const qa = program.command("qa");
    qa.command("instructions")
      .description("print the QA instructions that apply to a directory, nearest first, as JSON")
      .option("--from <dir>")
      .exitOverride()
      .action(async (opts: { from?: string }) => {
        process.stdout.write(
          `${JSON.stringify(await this.invoke("qa-instructions", opts.from === undefined ? {} : { from: opts.from }, z.object({ found: z.boolean(), sources: z.array(z.unknown()) })))}\n`,
        );
      });
    qa.command("evidence-dir")
      .description(
        "print where QA evidence for a ticket is written, and whether git ignores it, as JSON",
      )
      .argument("<ticket>")
      .exitOverride()
      .action(async (ticket: string) => {
        process.stdout.write(
          `${JSON.stringify(await this.invoke("qa-evidence-dir", { ticket }, z.object({ path: z.string(), gitignored: z.boolean().nullable() })))}\n`,
        );
      });
    qa.command("recipe")
      .description(
        "deprecated: print the path of the nearest QA instructions; use `qa instructions`",
      )
      .exitOverride()
      .action(async () => {
        const result = await this.invoke("qa-recipe", {}, ConfigPathResultSchema);
        process.stderr.write(
          "`flight-rules qa recipe` is deprecated; use `flight-rules qa instructions`\n",
        );
        process.stdout.write(`${result.path}\n`);
      });
  }

  private addConfig(program: Command): void {
    const config = program.command("config");
    config
      .command("path")
      .description("print the resolved config file path, whether or not it exists")
      .exitOverride()
      .action(async () => {
        process.stdout.write(
          `${(await this.invoke("config-path", {}, ConfigPathResultSchema)).path}\n`,
        );
      });
    config
      .command("show")
      .description(
        "print the merged config, which file each value came from, and whether it is valid",
      )
      .exitOverride()
      .action(async () => {
        process.stdout.write(
          `${JSON.stringify(await this.invoke("config-show", {}, ConfigInspectionResultSchema))}\n`,
        );
      });
    const scopeHelp =
      "where to write: user, project, local, or file; config show reports the selected host and exact paths (override with FLIGHT_RULES_HOST=claude|codex)";
    config
      .command("set")
      .description("write one config value; array keys take several values")
      .argument("<key>")
      .argument("<values...>")
      .addOption(new Option("--scope <scope>", scopeHelp).choices(configScopes))
      .exitOverride()
      .action(async (key: string, values: string[], options: { scope?: ConfigScope }) => {
        const result = await this.invoke(
          "config-set",
          { key, values, ...(options.scope === undefined ? {} : { scope: options.scope }) },
          z.object({
            key: z.string(),
            scope: z.enum(configScopes),
            path: z.string(),
            warning: z.string().optional(),
          }),
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
      });
    config
      .command("unset")
      .description("remove one config value from a scope")
      .argument("<key>")
      .addOption(new Option("--scope <scope>", scopeHelp).choices(configScopes))
      .exitOverride()
      .action(async (key: string, options: { scope?: ConfigScope }) => {
        const result = await this.invoke(
          "config-unset",
          { key, ...(options.scope === undefined ? {} : { scope: options.scope }) },
          z.object({ key: z.string(), scope: z.enum(configScopes), path: z.string() }),
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
      });
  }

  private addCheck(program: Command): void {
    program
      .command("check")
      .addOption(
        new Option(
          "--workflow <name>",
          "check readiness for this workflow before its first mutation",
        ).choices(WorkflowSchema.options),
      )
      .exitOverride()
      .action(async (options: { workflow?: string }) => {
        const input = ReadinessOptionsSchema.parse({ workflow: options.workflow });
        const report = await this.invoke("check", input, ReadinessResultSchema);
        process.stdout.write(`${JSON.stringify(report)}\n`);
        if (!report.ok)
          throw new ReadinessFailedError("flight-rules check failed — see report above");
      });
  }

  private async invoke<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    const result = await this.registry.invoke(id, input);
    if (result.status !== "success")
      throw new OperationCliError({
        operationId: id,
        errorName: result.status === "error" ? result.error.name : result.error.name,
        message: result.error.message,
      });
    return outputSchema.parse(result.data);
  }
}

export class CharterSelectionError extends Error {
  override name = "CharterSelectionError";
}
