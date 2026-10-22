import { z } from "zod";
import { getQaRecipePath, type Config } from "../../shared/config.js";
import { EnvLoader } from "../../shared/env.js";
import type { TaskTracker } from "../task-tracker/task-tracker.js";
import type { ToolProbe } from "../tool-probe/tool-probe.js";
import type { QaDiscoverInput, QaInstructions } from "../qa-instructions/qa-instructions.js";
import { RedactedProbeDiagnostics } from "./probe-diagnostics.js";
import { NodeWorkflowPreflight } from "./workflow-preflight.js";
import {
  ReadinessOptionsSchema,
  type ReadinessOptions,
  type ReadinessReport,
  type ReadinessCheck,
} from "./readiness.schema.js";

const RepositoryReadinessPropsSchema = z.object({
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
  timeoutMs: z.int().positive().max(60_000).default(10_000),
});
export interface ReadinessInputs {
  config(): Config;
  tracker(): TaskTracker;
  configPath(): string;
  probe: ToolProbe;
  finder: { discover(input: QaDiscoverInput): QaInstructions };
  options?: ReadinessOptions;
}
export interface RepositoryReadiness {
  inspect(input: ReadinessInputs): Promise<ReadinessReport>;
}

/** Combines existing environment checks with optional workflow evidence while preserving checks/ok consumers. */
export class NodeRepositoryReadiness implements RepositoryReadiness {
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly timeoutMs: number;

  constructor(props: z.input<typeof RepositoryReadinessPropsSchema> = {}) {
    const input = RepositoryReadinessPropsSchema.parse({
      ...props,
      env: props.env === undefined ? undefined : { ...props.env },
    });
    this.cwd = input.cwd ?? process.cwd();
    this.env = props.env ?? process.env;
    this.timeoutMs = input.timeoutMs;
  }

  async inspect(input: ReadinessInputs): Promise<ReadinessReport> {
    const parsed = ReadinessOptionsSchema.safeParse(input.options ?? {});
    if (!parsed.success)
      return {
        tracker: null,
        repo: null,
        checks: [
          {
            name: "runtime",
            ok: false,
            required: true,
            code: "INVALID_CONTEXT",
            detail: "Workflow or runtime evidence does not match the readiness schema",
            remedy:
              "Select a supported workflow. If supplying optional programmatic evidence, it must match WorkflowEvidenceSchema.",
          },
        ],
        ok: false,
        scope: "workflow",
      };
    const options = parsed.data;
    const scope = options.workflow === undefined ? "environment" : "workflow";
    const diagnostics = new RedactedProbeDiagnostics({ env: this.env });
    const checks: ReadinessCheck[] = [];
    let config: Config;
    try {
      config = input.config();
    } catch (error) {
      checks.push(diagnostics.failure("config", error, true, "CONFIGURATION"));
      return {
        tracker: null,
        repo: null,
        checks,
        ok: false,
        scope,
        ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
      };
    }
    checks.push({
      name: "config",
      ok: true,
      detail: `tracker=${config.tracker} repo=${config.repo}`,
    });
    let missing: string[];
    try {
      missing = this.missingCredentials(config);
    } catch (error) {
      checks.push(diagnostics.failure("credentials", error, true, "CONFIGURATION"));
      return {
        tracker: config.tracker,
        repo: config.repo,
        checks,
        ok: false,
        scope,
        ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
      };
    }
    checks.push({
      name: "credentials",
      ok: missing.length === 0,
      detail: missing.length === 0 ? "present" : `not set: ${missing.join(", ")}`,
      ...(missing.length ? { code: "AUTHENTICATION" } : {}),
    });
    if (missing.length === 0) {
      const controller = new AbortController();
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException("Tracker reachability probe timed out", "TimeoutError"),
          ),
        this.timeoutMs,
      );
      try {
        await Promise.race([
          input.tracker().ping({ signal: controller.signal }),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
              once: true,
            }),
          ),
        ]);
        checks.push({
          name: "reachable",
          ok: true,
          detail: `${config.repo ?? config.jiraProject} responded; write operations were not tested`,
        });
      } catch (error) {
        checks.push(diagnostics.failure("reachable", error, true));
      } finally {
        clearTimeout(timer);
      }
    } else
      checks.push({
        name: "reachable",
        ok: false,
        detail: "skipped — credentials missing",
        code: "AUTHENTICATION",
      });

    const qaWorkflow = options.workflow === "reproduce-bug" || options.workflow === "verify-ticket";
    let qa: QaInstructions = { found: false, sources: [] };
    try {
      qa = input.finder.discover({
        from: this.cwd,
        legacyRecipePath: getQaRecipePath(config, input.configPath()),
      });
      const [nearest] = qa.sources;
      checks.push({
        name: "qa-instructions",
        ok: qa.found,
        required: qaWorkflow,
        detail:
          nearest === undefined
            ? "none found — add a QA.md or a QA section in AGENTS.md to enable the QA lane"
            : [nearest.path, ...qa.sources.slice(1).map((source) => source.path)].join(", ") +
              (nearest.legacy === true ? " (legacy recipe — migrate to QA.md)" : ""),
      });
    } catch (error) {
      checks.push(diagnostics.failure("qa-instructions", error, qaWorkflow));
    }
    const codeWorkflow = options.workflow === "execute-work" || options.workflow === "execute-wave";
    checks.push(
      ...(await input.probe.probe({
        repo: config.repo,
        qaInstructionsFound:
          options.workflow === "break-down-work" ? false : qa.found || qaWorkflow,
        ...(options.workflow === undefined
          ? {}
          : {
              githubRequired: codeWorkflow || config.tracker === "github",
              pushRequired: codeWorkflow,
            }),
      })),
    );
    if (codeWorkflow && config.repo === undefined)
      checks.push({
        name: "pr:repo",
        ok: false,
        required: true,
        code: "CONFIGURATION",
        detail: "A GitHub owner/repo is required to open the PR",
        remedy: "Resolve and store the intended repository before starting work.",
      });
    if (options.workflow !== undefined)
      checks.push(
        ...(await new NodeWorkflowPreflight({
          cwd: this.cwd,
          env: this.env,
          timeoutMs: this.timeoutMs,
        }).inspect(options.workflow, options.evidence)),
      );

    const redacted = checks.map((check) => ({
      ...check,
      detail: diagnostics.redact(check.detail),
      ...(check.remedy === undefined ? {} : { remedy: diagnostics.redact(check.remedy) }),
    }));
    return {
      tracker: config.tracker,
      repo: config.repo,
      checks: redacted,
      ok: redacted.every((check) => check.ok || check.required === false),
      scope,
      ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
    };
  }

  private missingCredentials(config: Config): string[] {
    const env = new EnvLoader().load(this.env);
    if (config.tracker === "github") return env.githubToken?.trim() ? [] : ["GITHUB_TOKEN"];
    return [
      ...(env.jiraToken?.trim() ? [] : ["JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY)"]),
      ...((env.jiraEmail ?? config.jiraEmail)?.trim()
        ? []
        : ["JIRA_EMAIL (or jiraEmail in the config)"]),
    ];
  }
}
