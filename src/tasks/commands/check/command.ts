import { Command } from "commander";
import { getQaRecipePath } from "../../../shared/config.js";
import type { Config } from "../../../shared/config.js";
import { EnvLoader, type Env } from "../../../shared/env.js";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import type { ToolProbe } from "../../tool-probe/tool-probe.js";
import { QaInstructionsFinder } from "../../qa-instructions/qa-instructions.js";

type Check = { name: string; ok: boolean; detail: string; required?: boolean };

// eslint-disable-next-line preflight/no-loose-functions -- missingCredentials is module-level behaviour awaiting a home on a service; tracked in KAN-39
function missingCredentials(config: Config, env: Env): string[] {
  if (config.tracker === "github")
    return env.githubToken === undefined ? ["GITHUB_TOKEN"] : [];
  const missing: string[] = [];
  if (env.jiraToken === undefined)
    missing.push("JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY)");
  if ((env.jiraEmail ?? config.jiraEmail) === undefined)
    missing.push("JIRA_EMAIL (or jiraEmail in the config)");
  return missing;
}

export function createCheckCommand(
  getConfig: () => Config,
  getTracker: () => TaskTracker,
  getConfigPath: () => string,
  getProbe: () => ToolProbe,
  getFinder: () => QaInstructionsFinder = () => new QaInstructionsFinder(),
): Command {
  const check = new Command("check");

  check.exitOverride().action(async () => {
    const checks: Check[] = [];

    let config: Config;
    try {
      config = getConfig();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      checks.push({ name: "config", ok: false, detail });
      process.stdout.write(
        JSON.stringify({ tracker: null, repo: null, checks, ok: false }) + "\n",
      );
      throw new Error(
        "flight-rules check failed — config could not be resolved",
        { cause: err },
      );
    }
    checks.push({
      name: "config",
      ok: true,
      detail: `tracker=${config.tracker} repo=${config.repo}`,
    });

    // A loader per run: the cache is per-instance, and `check` reports on the
    // environment as it stands at invocation time.
    const missing = missingCredentials(config, new EnvLoader().load());
    const credOk = missing.length === 0;
    checks.push({
      name: "credentials",
      ok: credOk,
      detail: credOk ? "present" : `not set: ${missing.join(", ")}`,
    });

    if (credOk) {
      try {
        await getTracker().ping();
        checks.push({
          name: "reachable",
          ok: true,
          detail: `${config.repo} responded`,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        checks.push({ name: "reachable", ok: false, detail });
      }
    } else {
      checks.push({
        name: "reachable",
        ok: false,
        detail: "skipped — credentials missing",
      });
    }

    const qa = getFinder().discover({
      from: process.cwd(),
      legacyRecipePath: getQaRecipePath(config, getConfigPath()),
    });
    const [nearest] = qa.sources;
    checks.push({
      name: "qa-instructions",
      ok: qa.found,
      detail:
        nearest === undefined
          ? "none found — add a QA.md or a QA section in AGENTS.md to enable the QA lane"
          : [nearest.path, ...qa.sources.slice(1).map((s) => s.path)].join(", ") +
            (nearest.legacy === true ? " (legacy recipe — migrate to QA.md)" : ""),
      required: false,
    });

    const tools = await getProbe().probe({
      repo: config.repo,
      qaInstructionsFound: qa.found,
    });
    checks.push(...tools);

    const ok = checks.every((c) => c.ok || c.required === false);
    process.stdout.write(
      JSON.stringify({
        tracker: config.tracker,
        repo: config.repo,
        checks,
        ok,
      }) + "\n",
    );
    if (!ok) throw new Error("flight-rules check failed — see report above");
  });

  return check;
}
