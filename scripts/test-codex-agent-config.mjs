#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { FileAgentRegistry, TomlCodexAgentEmitter } from "../dist/index.js";
import models from "../adapters/codex/model-tiers.json" with { type: "json" };
import reasoning from "../adapters/codex/reasoning-tiers.json" with { type: "json" };

const home = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-codex-config-")));
const directory = join(scratch, ".codex", "agents");
mkdirSync(directory, { recursive: true });
writeFileSync(join(scratch, ".codex", "config.toml"), "[agents]\nenabled = true\n");
assert.equal(spawnSync("git", ["init", "-q", scratch]).status, 0);
const agents = new FileAgentRegistry().load(join(home, "agents"));
const emitter = new TomlCodexAgentEmitter({ models, reasoning });
for (const agent of agents) writeFileSync(join(directory, `${agent.frontmatter.name}.toml`), emitter.emit(agent));
const report = { hostVersion: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim(), registrations: agents.map((agent) => agent.frontmatter.name), cases: [], modelTurns: 0 };

try {
  for (const negativeControl of [true, false]) {
    const control = join(directory, "bad-control.toml");
    if (negativeControl) writeFileSync(control, 'name="bad-control"\ndescription="Malformed negative control"\ndeveloper_instructions=""\n');
    else unlinkSync(control);
    const proc = spawn("codex", [
      "app-server", "--config", `projects={${JSON.stringify(scratch)}={trust_level="trusted"}}`,
      "--config", "features.multi_agent_v2.enabled=true",
      "--config", `log_dir=${JSON.stringify(join(scratch, "logs"))}`,
    ], { cwd: scratch, stdio: ["pipe", "pipe", "pipe"] });
    const input = createInterface({ input: proc.stdout });
    const events = [];
    const pending = new Map();
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    input.on("line", (line) => {
      const value = JSON.parse(line);
      events.push(value);
      pending.get(value.id)?.(value);
    });
    const send = (id, method, params) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 30_000);
      pending.set(id, (value) => { clearTimeout(timer); pending.delete(id); resolve(value); });
      proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    try {
      const initialized = await send(0, "initialize", { clientInfo: { name: "flight-rules-config-smoke", version: "1.0.0" }, capabilities: { experimentalApi: true } });
      assert.ok(initialized.result, JSON.stringify(initialized.error));
      proc.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      const started = await send(1, "thread/start", { cwd: scratch, ephemeral: true, config: { web_search: "disabled" } });
      assert.ok(started.result, JSON.stringify(started.error));
      const warnings = events.filter((event) => event.method === "configWarning").map((event) => event.params.summary);
      if (negativeControl) {
        assert.equal(warnings.length, 1, "native parser must observe the negative control");
        assert.ok(warnings[0].includes("bad-control") && warnings[0].includes("cannot be blank"));
      } else assert.deepEqual(warnings, [], "native parser rejected generated roles or fixture configuration");
      report.cases.push({ negativeControl, threadStarted: true, warnings });
    } finally {
      proc.kill();
      input.close();
      writeFileSync(join(scratch, `${negativeControl ? "control" : "valid"}.stderr`), stderr);
    }
  }
  writeFileSync(join(scratch, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, scratch }, null, 2));
} catch (error) {
  writeFileSync(join(scratch, "report.json"), `${JSON.stringify({ ...report, error: error.message }, null, 2)}\n`);
  console.error(`Native configuration check failed; evidence is in ${scratch}: ${error.message}`);
  process.exitCode = 1;
}
