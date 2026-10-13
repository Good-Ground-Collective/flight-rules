#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { FileAgentRegistry } from "../dist/index.js";

const home = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = realpathSync(resolve(process.argv[2] ?? join(home, "dist/codex")));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-codex-config-")));
const directory = join(scratch, ".codex", "agents");
cpSync(join(plugin, ".codex"), join(scratch, ".codex"), { recursive: true });
mkdirSync(join(scratch, ".agents/plugins"), { recursive: true });
cpSync(join(home, ".agents/plugins/marketplace.json"), join(scratch, ".agents/plugins/marketplace.json"));
cpSync(plugin, join(scratch, "dist/codex"), { recursive: true });
assert.equal(spawnSync("git", ["init", "-q", scratch]).status, 0);
const agents = new FileAgentRegistry().load(join(home, "agents"));
const report = { hostVersion: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim(), plugin, registrations: agents.map((agent) => agent.frontmatter.name), cases: [], modelTurns: 0 };

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
      if (!negativeControl) {
        const listed = await send(2, "plugin/list", { cwds: [scratch], marketplaceKinds: ["local"], forceRefetch: false });
        assert.ok(listed.result, JSON.stringify(listed.error));
        assert.deepEqual(listed.result.marketplaceLoadErrors ?? [], []);
        const marketplace = listed.result.marketplaces.find((entry) => entry.name === "flight-rules");
        assert.ok(marketplace, "native client must discover the repository marketplace");
        writeFileSync(join(scratch, "plugins.json"), JSON.stringify(marketplace, null, 2));
        const available = marketplace.plugins.find((entry) => entry.name === "flight-rules");
        assert.ok(available, "native client must list the assembled plugin");
        assert.equal(available.installed, false);
        const inspected = await send(3, "plugin/read", { marketplacePath: join(scratch, ".agents/plugins/marketplace.json"), pluginName: "flight-rules" });
        assert.ok(inspected.result, JSON.stringify(inspected.error));
        writeFileSync(join(scratch, "plugin.json"), JSON.stringify(inspected.result, null, 2));
        const version = JSON.parse(readFileSync(join(plugin, "plugin.json"), "utf8")).version;
        assert.equal(inspected.result.plugin.summary.localVersion, version);
        const skills = readdirSync(join(plugin, "skills")).filter((name) => existsSync(join(plugin, "skills", name, "SKILL.md"))).map((name) => `flight-rules:${name}`).sort();
        assert.deepEqual(inspected.result.plugin.skills.map((skill) => skill.name).sort(), skills);
        report.marketplace = { discovered: true, pluginRead: true, skills: skills.length, installed: false, version };
      }
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
