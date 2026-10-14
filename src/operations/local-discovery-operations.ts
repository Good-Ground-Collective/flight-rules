import { readdirSync } from "node:fs";
import { z } from "zod";
import type { Config } from "../shared/config.js";
import { getQaRecipePath, getRfcDir } from "../shared/config.js";
import type { ConfigStore } from "../shared/config-store.js";
import type { CharterCatalog } from "../bundled-docs/charter-catalog/charter-catalog.js";
import type { RepositoryPaths } from "../bundled-docs/charter-catalog/repository-paths.js";
import type { EvidenceLocation } from "../tasks/evidence/evidence-location.js";
import {
  QaInstructionsFinder,
  type QaInstructions,
} from "../tasks/qa-instructions/qa-instructions.js";
import type { RepositoryReadiness } from "../tasks/readiness/repository-readiness.js";
import {
  ReadinessOptionsSchema,
  WorkflowSchema,
  type WorkflowEvidenceSchema,
} from "../tasks/readiness/readiness.schema.js";
import type { ReadinessReport } from "../tasks/readiness/readiness.schema.js";
import type { TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import type { ToolProbe } from "../tasks/tool-probe/tool-probe.js";
import type { CliRoute, OperationEffect } from "./operation.schema.js";
import type { OperationDescriptor } from "./operation-registry.js";

const QaSourceSchema = z.object({
  path: z.string(),
  kind: z.enum(["agents-md-section", "qa-md", "agents-dir-qa-md", "legacy-recipe"]),
  dir: z.string(),
  content: z.string(),
  legacy: z.literal(true).optional(),
  hint: z.string().optional(),
});
const QaInstructionsSchema = z.object({ found: z.boolean(), sources: z.array(QaSourceSchema) });
const ReadinessCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  required: z.boolean().optional(),
  code: z.string().optional(),
  remedy: z.string().optional(),
});
const ReadinessReportSchema = z.object({
  tracker: z.string().nullable(),
  repo: z.string().nullable().optional(),
  checks: z.array(ReadinessCheckSchema),
  ok: z.boolean(),
  workflow: WorkflowSchema.optional(),
  scope: z.enum(["environment", "workflow"]),
});
const ConfigInspectionSchema = z.object({
  host: z.string(),
  valid: z.boolean(),
  error: z.string().optional(),
  values: z.record(z.string(), z.unknown()),
  sources: z.record(
    z.string(),
    z.object({ scope: z.enum(["user", "project", "local", "file"]), path: z.string() }),
  ),
  layers: z.array(
    z.object({
      scope: z.enum(["user", "project", "local", "file"]),
      path: z.string(),
      present: z.boolean(),
    }),
  ),
});

const CharterInputSchema = z
  .object({
    paths: z.array(z.string()).optional(),
    diff: z.string().optional(),
    repository: z.boolean().default(false),
    pathOutput: z.boolean().default(false),
  })
  .strict()
  .refine(
    (input) =>
      Number(input.paths !== undefined && input.paths.length > 0) +
        Number(input.diff !== undefined) +
        Number(input.repository) <=
      1,
    "Choose one charter selection source",
  );
const QaInstructionsInputSchema = z.object({ from: z.string().optional() }).strict();
const RfcDirectoryOutputSchema = z.object({ path: z.string() });
const RfcNextIdOutputSchema = z.object({
  id: z.string().regex(/^RFC-\d+$/),
  directory: z.string(),
});
const QaRecipeOutputSchema = z.object({ path: z.string() });
const EvidenceDirectoryOutputSchema = z.object({
  path: z.string(),
  gitignored: z.boolean().nullable(),
});

const rfcIdPattern = /^RFC-(\d+)\.md$/;

const LocalDiscoveryPropsSchema = z.object({
  cwd: z.string().min(1),
  getConfig: z.custom<() => Config>((value) => typeof value === "function"),
  getConfigStore: z.custom<() => ConfigStore>((value) => typeof value === "function"),
  getCharters: z.custom<() => CharterCatalog>((value) => typeof value === "function"),
  getRepositoryPaths: z.custom<() => RepositoryPaths>((value) => typeof value === "function"),
  getEvidence: z.custom<() => EvidenceLocation>((value) => typeof value === "function"),
  getReadiness: z.custom<() => RepositoryReadiness>((value) => typeof value === "function"),
  getProbe: z.custom<() => ToolProbe>((value) => typeof value === "function"),
  getTracker: z.custom<() => TaskTracker>((value) => typeof value === "function"),
  getConfigPath: z.custom<() => string>((value) => typeof value === "function"),
  getQaFinder: z
    .custom<() => QaInstructionsFinder>((value) => typeof value === "function")
    .optional(),
});

export interface LocalDiscoveryOperations {
  operations(): OperationDescriptor[];
  configStore(): ConfigStore;
}

/** Shared local discovery and readiness behavior used by CLI and programmatic hosts. */
export class DefaultLocalDiscoveryOperations implements LocalDiscoveryOperations {
  private readonly props: z.infer<typeof LocalDiscoveryPropsSchema>;

  constructor(props: z.input<typeof LocalDiscoveryPropsSchema>) {
    this.props = LocalDiscoveryPropsSchema.parse(props);
  }

  operations(): OperationDescriptor[] {
    return [
      this.descriptor(
        "charter",
        "Print the core and applicable language charters.",
        ["process"],
        ["charter"],
        CharterInputSchema,
        z.object({
          charters: z.array(
            z.object({ path: z.string(), contents: z.string(), language: z.string().nullable() }),
          ),
          unmatched: z.boolean(),
        }),
        (input) => this.charter(input),
      ),
      this.descriptor(
        "competencies",
        "Read the configured worker competencies.",
        ["read"],
        ["competencies"],
        z.object({}),
        z.array(z.string()),
        () => this.props.getConfig().competencies,
      ),
      this.descriptor(
        "rfc-dir",
        "Resolve the RFC directory for this checkout.",
        ["read"],
        ["rfc", "dir"],
        z.object({}),
        RfcDirectoryOutputSchema,
        () => ({ path: getRfcDir(this.props.getConfig(), this.props.cwd) }),
      ),
      this.descriptor(
        "rfc-next-id",
        "Find the next RFC number in the configured RFC directory.",
        ["read"],
        ["rfc", "next-id"],
        z.object({}),
        RfcNextIdOutputSchema,
        () => this.nextRfcId(),
      ),
      this.descriptor(
        "qa-instructions",
        "Find QA instructions that apply to a directory.",
        ["read"],
        ["qa", "instructions"],
        QaInstructionsInputSchema,
        QaInstructionsSchema,
        (input) => this.qaInstructions(input),
      ),
      this.descriptor(
        "qa-evidence-dir",
        "Resolve the persistent evidence directory for a ticket.",
        ["read", "process"],
        ["qa", "evidence-dir"],
        z.object({ ticket: z.string().min(1) }),
        EvidenceDirectoryOutputSchema,
        (input) => this.props.getEvidence().dirFor(input.ticket),
      ),
      this.descriptor(
        "qa-recipe",
        "Resolve the nearest QA instruction path (deprecated CLI route).",
        ["read"],
        ["qa", "recipe"],
        z.object({}),
        QaRecipeOutputSchema,
        () => this.qaRecipe(),
      ),
      this.descriptor(
        "config-path",
        "Resolve the config file path for this checkout.",
        ["read"],
        ["config", "path"],
        z.object({}),
        z.object({ path: z.string() }),
        () => ({ path: this.props.getConfigStore().filePath() }),
      ),
      this.descriptor(
        "config-show",
        "Inspect merged configuration and its sources.",
        ["read"],
        ["config", "show"],
        z.object({}),
        ConfigInspectionSchema,
        () => this.props.getConfigStore().inspect(),
      ),
      this.descriptor(
        "check",
        "Check local configuration, tools, and optional workflow readiness.",
        ["read", "process", "network"],
        ["check"],
        ReadinessOptionsSchema,
        ReadinessReportSchema,
        (input) => this.check(input),
      ),
    ];
  }

  configStore(): ConfigStore {
    return this.props.getConfigStore();
  }

  private descriptor<TInput, TOutput>(
    id: string,
    description: string,
    effects: OperationEffect[],
    path: string[],
    inputSchema: z.ZodType<TInput>,
    outputSchema: z.ZodType<TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): OperationDescriptor<TInput, TOutput> {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] } satisfies CliRoute,
      inputSchema,
      outputSchema,
      handler,
    };
  }

  private async charter(input: z.infer<typeof CharterInputSchema>) {
    let paths = input.paths ?? [];
    if (input.diff !== undefined)
      paths = await this.props.getRepositoryPaths().changedSince(input.diff);
    else if (input.repository || input.paths === undefined)
      paths = await this.props.getRepositoryPaths().inventory();
    const selected = this.props.getCharters().select(paths);
    return {
      charters: selected.map(({ path, contents, language }) => ({ path, contents, language })),
      unmatched: selected.every((charter) => charter.language === null),
    };
  }

  private nextRfcId(): z.infer<typeof RfcNextIdOutputSchema> {
    const directory = getRfcDir(this.props.getConfig(), this.props.cwd);
    let files: string[];
    try {
      files = readdirSync(directory);
    } catch {
      // eslint-disable-next-line preflight/no-planning-identifiers -- RFC-001 is the first valid document identifier.
      return { id: "RFC-001", directory };
    }
    const ids = files
      .map((file) => file.match(rfcIdPattern))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => Number(match[1] ?? 0));
    return {
      id: `RFC-${String(ids.length === 0 ? 1 : Math.max(...ids) + 1).padStart(3, "0")}`,
      directory,
    };
  }

  private qaInstructions(input: z.infer<typeof QaInstructionsInputSchema>): QaInstructions {
    const config = this.safeConfig();
    return (this.props.getQaFinder?.() ?? new QaInstructionsFinder()).discover({
      from: input.from ?? this.props.cwd,
      ...(config === undefined
        ? {}
        : { legacyRecipePath: getQaRecipePath(config, this.props.getConfigPath()) }),
    });
  }

  private qaRecipe(): { path: string } {
    const result = this.qaInstructions({});
    const nearest = result.sources[0];
    if (nearest === undefined)
      throw new QaInstructionsNotFoundError(
        "No QA instructions found — add a QA.md at the repo root or a QA section in AGENTS.md (see docs/qa-instructions.md)",
      );
    return { path: nearest.path };
  }

  private check(input: z.infer<typeof ReadinessOptionsSchema>): Promise<ReadinessReport> {
    return this.props.getReadiness().inspect({
      config: this.props.getConfig,
      tracker: this.props.getTracker,
      configPath: this.props.getConfigPath,
      probe: this.props.getProbe(),
      finder: this.props.getQaFinder?.() ?? new QaInstructionsFinder(),
      options: input,
    });
  }

  private safeConfig(): Config | undefined {
    try {
      return this.props.getConfig();
    } catch {
      return undefined;
    }
  }
}

export class QaInstructionsNotFoundError extends Error {
  override name = "QaInstructionsNotFoundError";
}

export type LocalWorkflowEvidence = z.infer<typeof WorkflowEvidenceSchema>;
