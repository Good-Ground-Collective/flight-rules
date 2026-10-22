import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { RegistryOrchestrationPolicy } from "../../orchestration/orchestration-policy.js";
import { RedactedProbeDiagnostics } from "./probe-diagnostics.js";
import {
  WorkflowEvidenceSchema,
  WorkflowSchema,
  type ReadinessCheck,
  type Workflow,
  type WorkflowEvidence,
} from "./readiness.schema.js";

const WorkflowPreflightPropsSchema = z.object({
  cwd: z.string(),
  env: z.record(z.string(), z.string().optional()),
  timeoutMs: z.int().positive().max(60_000).default(10_000),
});
export interface WorkflowPreflight {
  inspect(workflow: Workflow, evidence?: WorkflowEvidence): Promise<ReadinessCheck[]>;
}

/** Checks the environment; programmatic callers may opt into additional host evidence checks. */
export class NodeWorkflowPreflight implements WorkflowPreflight {
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly timeoutMs: number;

  constructor(props: z.input<typeof WorkflowPreflightPropsSchema>) {
    const input = WorkflowPreflightPropsSchema.parse({
      ...props,
      env: props.env === undefined ? undefined : { ...props.env },
    });
    this.cwd = input.cwd;
    this.env = props.env;
    this.timeoutMs = input.timeoutMs;
  }

  async inspect(workflow: Workflow, evidence?: WorkflowEvidence): Promise<ReadinessCheck[]> {
    const selected = WorkflowSchema.parse(workflow);
    const parsed = evidence === undefined ? undefined : WorkflowEvidenceSchema.parse(evidence);
    const diagnostics = new RedactedProbeDiagnostics({ env: this.env });
    const codeWorkflow = selected === "execute-work" || selected === "execute-wave";
    const checks = parsed === undefined ? [] : this.hostChecks(selected, parsed, diagnostics);

    if (codeWorkflow) {
      checks.push(await this.checkoutContext(parsed, diagnostics));
      checks.push(await this.remoteRead(diagnostics));
      checks.push(await this.localWrite("local:workspace-write", this.cwd, diagnostics));
      checks.push(await this.gitWrite(diagnostics));
    }
    return checks;
  }

  private hostChecks(
    selected: Workflow,
    parsed: WorkflowEvidence,
    diagnostics: RedactedProbeDiagnostics,
  ): ReadinessCheck[] {
    const codeWorkflow = selected === "execute-work" || selected === "execute-wave";
    const requiredAgents = codeWorkflow
      ? ["code-implementation", "code-implementation-escalated", "code-verifier", "tech-writer"]
      : selected === "break-down-work"
        ? ["research-agent"]
        : [selected === "reproduce-bug" ? "qa-engineer" : "qa-engineer-verify"];
    const checks: ReadinessCheck[] = [];
    const contextMatches = resolve(parsed.context.cwd) === resolve(this.cwd);
    checks.push({
      name: "host:context",
      ok: contextMatches,
      required: true,
      code: contextMatches ? "AVAILABLE" : "CONTEXT_MISMATCH",
      detail: contextMatches
        ? "Caller context matches this working directory"
        : "Missing or mismatched caller context",
      remedy:
        "Supply current host observations for this task and active checkout, then rerun the workflow check.",
    });

    const required = [
      "shell",
      "network",
      "tracker.write",
      ...(codeWorkflow ? ["edit", "git.write", "git.push"] : []),
      ...(["reproduce-bug", "verify-ticket"].includes(selected) ? ["evidence.write"] : []),
    ];
    for (const capability of required) {
      const observed = contextMatches ? parsed.callerCapabilities[capability] : undefined;
      checks.push({
        name: `host:${capability}`,
        ok: observed?.state === "available",
        required: true,
        code:
          observed?.state === "available"
            ? "AVAILABLE"
            : observed?.state === "denied"
              ? "CAPABILITY_DENIED"
              : "CAPABILITY_UNKNOWN",
        detail: diagnostics.redact(
          observed?.evidence ?? `No effective caller evidence for ${capability}`,
        ),
        remedy:
          observed?.state === "available"
            ? undefined
            : diagnostics.redact(
                observed?.remedy ??
                  `Establish ${capability} through the host's scoped setup/approval path before mutations.`,
              ),
      });
    }

    const policy = parsed.workers.length
      ? new RegistryOrchestrationPolicy({
          agents: parsed.workers.map((worker) => ({
            frontmatter: worker.registration,
            body: "Preflight registration requirements; this check does not dispatch.",
          })),
        })
      : undefined;
    for (const agent of requiredAgents) {
      const worker = contextMatches
        ? parsed.workers.find((item) => item.registration.name === agent)
        : undefined;
      if (worker === undefined || policy === undefined) {
        checks.push({
          name: `dispatch:${agent}`,
          ok: false,
          required: true,
          code: "CAPABILITY_UNKNOWN",
          detail: `No scoped runtime evidence for ${agent}`,
          remedy:
            "Discover the installed registration and observe its effective permissions, dispatch support and limits.",
        });
        continue;
      }
      const decision = policy.prepare(
        { id: `preflight:${agent}`, agent, context: parsed.context, input: {} },
        worker.runtime,
      );
      checks.push(
        decision.status === "ready"
          ? {
              name: `dispatch:${agent}`,
              ok: true,
              required: true,
              code: "AVAILABLE",
              detail:
                "Reported worker access, dispatch capacity and depth satisfy this registration; no worker was launched",
            }
          : {
              name: `dispatch:${agent}`,
              ok: false,
              required: true,
              code: decision.failure.code,
              detail: diagnostics.redact(decision.failure.message),
              remedy: diagnostics.redact(decision.failure.remedy),
            },
      );
    }

    return checks;
  }

  private async command(args: string[]): Promise<string> {
    const run = promisify(execFile);
    const { stdout } = await run("git", args, {
      cwd: this.cwd,
      env: { ...this.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
      timeout: this.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  }

  private async remoteRead(diagnostics: RedactedProbeDiagnostics): Promise<ReadinessCheck> {
    try {
      await this.command(["ls-remote", "origin"]);
      return {
        name: "git:remote-read",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail: "Read origin refs successfully; this does not test push transport or branch policy",
      };
    } catch (error) {
      return diagnostics.failure("git:remote-read", error, true);
    }
  }

  private async checkoutContext(
    evidence: WorkflowEvidence | undefined,
    diagnostics: RedactedProbeDiagnostics,
  ): Promise<ReadinessCheck> {
    try {
      const root = await this.command(["rev-parse", "--show-toplevel"]);
      if (
        evidence !== undefined &&
        (await realpath(root)) !== (await realpath(evidence.context.repositoryRoot))
      ) {
        return {
          name: "git:context",
          ok: false,
          required: true,
          code: "CONTEXT_MISMATCH",
          detail: "Runtime evidence names another repository root",
          remedy: "Use the active worktree root in caller and worker context.",
        };
      }
      await this.command([
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${evidence?.context.baseRef ?? "HEAD"}^{commit}`,
      ]);
      return {
        name: "git:context",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail:
          evidence === undefined
            ? "Active checkout found and HEAD resolves to a commit"
            : "Active checkout matches and the fixed base resolves to a commit",
      };
    } catch (error) {
      return diagnostics.failure("git:context", error, true);
    }
  }

  private async localWrite(
    name: string,
    path: string,
    diagnostics: RedactedProbeDiagnostics,
  ): Promise<ReadinessCheck> {
    try {
      await access(path, constants.W_OK);
      return {
        name,
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail:
          "Filesystem access check permits directory writes; no file was created; the harness enforces access when operations run",
      };
    } catch (error) {
      return diagnostics.failure(name, error, true);
    }
  }

  private async gitWrite(diagnostics: RedactedProbeDiagnostics): Promise<ReadinessCheck> {
    try {
      const paths = await this.command(["rev-parse", "--git-dir", "--git-common-dir"]);
      const directories = paths.split("\n").map((path) => resolve(this.cwd, path));
      if (directories.length !== 2) {
        return {
          name: "local:git-write",
          ok: false,
          required: true,
          code: "UNKNOWN",
          detail: "Could not resolve Git metadata directories",
          remedy: "Inspect the active repository/worktree metadata before branching or committing.",
        };
      }
      await Promise.all(directories.map((directory) => access(directory, constants.W_OK)));
      return {
        name: "local:git-write",
        ok: true,
        required: true,
        code: "AVAILABLE",
        detail:
          "Git and common metadata directories pass filesystem write-access checks; no git mutation was attempted",
      };
    } catch (error) {
      return diagnostics.failure("local:git-write", error, true);
    }
  }
}
