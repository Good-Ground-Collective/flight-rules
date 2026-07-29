import { Command } from "commander";
import type { Config } from "../../../shared/config.js";
import { EnvLoader, type Env } from "../../../shared/env.js";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";

type Check = { name: string; ok: boolean; detail: string };

function credentialFor(
  tracker: Config["tracker"],
  env: Env,
): { name: string; value: string | undefined } {
  if (tracker === "github")
    return { name: "GITHUB_TOKEN", value: env.githubToken };
  return {
    name: "JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY)",
    value: env.jiraToken,
  };
}

export function createCheckCommand(
  getConfig: () => Config,
  getTracker: () => TaskTracker,
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
    const credential = credentialFor(config.tracker, new EnvLoader().load());
    const credOk = credential.value !== undefined;
    checks.push({
      name: "credentials",
      ok: credOk,
      detail: credOk ? "present" : `${credential.name} is not set`,
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

    const ok = checks.every((c) => c.ok);
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
