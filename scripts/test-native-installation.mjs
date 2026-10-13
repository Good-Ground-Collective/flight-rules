#!/usr/bin/env node
// Real native installation/discovery, no model turns. Native writes stay in scratch.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { FileNativeInstallation } from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-native-install-")));
const repo = join(scratch, "repo");
const marketplace = join(scratch, "marketplace");
const env = { ...process.env, CODEX_HOME: join(scratch, "codex-home"), CLAUDE_CONFIG_DIR: join(scratch, "claude-home") };
delete env.FLIGHT_RULES_HOME;
delete env.FLIGHT_RULES_HOST;
delete env.FLIGHT_RULES_CONFIG;
for (const path of [repo, marketplace, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(path, { recursive: true });
for (const path of ["dist/claude", "dist/codex", ".claude-plugin", ".agents/plugins"]) cpSync(join(root, path), join(marketplace, path), { recursive: true });
const run = (command, args) => execFileSync(command, args, { cwd: repo, env, encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });
const report = { scratch, modelTurns: 0, claude: {}, codex: {} };
const save = () => writeFileSync(join(scratch, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

try {
  run("git", ["init", "-q"]);
  report.claude.version = run("claude", ["--version"]).trim();
  run("claude", ["plugin", "marketplace", "add", marketplace, "--scope", "user"]);
  run("claude", ["plugin", "install", "flight-rules@flight-rules", "--scope", "user", "--json"]);
  const installed = JSON.parse(run("claude", ["plugin", "list", "--json"]));
  const claude = installed.find((plugin) => plugin.id === "flight-rules@flight-rules");
  assert.ok(claude?.installPath, "Claude must report an installed cache path");
  const inventory = await new Promise((resolve, reject) => {
    const proc = spawn("claude", ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--settings", '{"disableAllHooks":true}'], { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"] });
    const input = createInterface({ input: proc.stdout });
    proc.stderr.resume();
    const finish = () => { clearTimeout(timer); input.close(); proc.kill(); };
    const timer = setTimeout(() => { finish(); reject(new Error("Claude initialization timed out")); }, 30_000);
    proc.on("error", (error) => { finish(); reject(error); });
    input.on("line", (line) => {
      const event = JSON.parse(line);
      if (event.type !== "control_response") return;
      const response = event.response;
      finish();
      if (response.subtype === "error") reject(new Error(response.error));
      else resolve({ agents: response.response.agents.map((agent) => agent.name), skills: response.response.commands.map((command) => command.name) });
    });
    proc.stdin.write(JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize" } }) + "\n");
  });
  const manifest = JSON.parse(readFileSync(join(claude.installPath, "flight-rules-install.json"), "utf8"));
  const skills = readdirSync(join(claude.installPath, "skills")).sort();
  for (const agent of manifest.agents) assert.ok(inventory.agents.includes(`flight-rules:${agent.name}`), `Claude inventory missing ${agent.name}`);
  for (const skill of skills) assert.ok(inventory.skills.includes(`flight-rules:${skill}`), `Claude inventory missing ${skill}`);
  report.claude = { ...report.claude, installed: true, agents: manifest.agents.map((agent) => agent.name), skills, installPath: claude.installPath };
  save();

  report.codex.version = run("codex", ["--version"]).trim();
  run("codex", ["plugin", "marketplace", "add", marketplace]);
  const added = JSON.parse(run("codex", ["plugin", "add", "flight-rules@flight-rules", "--json"]));
  report.codex.installResult = added;
  const pluginRoot = added.installedPath;
  assert.ok(realpathSync(pluginRoot).startsWith(`${realpathSync(env.CODEX_HOME)}/`), "install must stay inside the isolated Codex home");
  const registration = new FileNativeInstallation({ root: pluginRoot, cwd: repo, env });
  assert.equal(registration.status("project").ok, false);
  const installedCli = join(pluginRoot, "bin/flight-rules.mjs");
  for (let attempt = 0; attempt < 2; attempt++) assert.equal(JSON.parse(run(process.execPath, [installedCli, "agents", "install", "--scope", "project"])).ok, true);
  assert.equal(JSON.parse(run(process.execPath, [installedCli, "agents", "status", "--scope", "project"])).ok, true);
  const agents = registration.status("project").agents.map((agent) => agent.name);

  const inspect = async (negativeControl) => {
    const proc = spawn("codex", ["app-server", "--config", `projects={${JSON.stringify(repo)}={trust_level="trusted"}}`], { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"] });
    const input = createInterface({ input: proc.stdout });
    const pending = new Map();
    const warnings = [];
    proc.stderr.resume();
    input.on("line", (line) => {
      const value = JSON.parse(line);
      if (value.method === "configWarning") warnings.push(value.params.summary);
      pending.get(value.id)?.(value);
    });
    let id = 0;
    const send = (method, params) => new Promise((resolve, reject) => {
      const requestId = id++;
      const timer = setTimeout(() => reject(new Error(`Native request timed out: ${method}`)), 30_000);
      pending.set(requestId, (value) => { clearTimeout(timer); pending.delete(requestId); value.error ? reject(new Error(`${method}: ${value.error.message}`)) : resolve(value.result); });
      proc.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
    });
    try {
      await send("initialize", { clientInfo: { name: "flight-rules-install-proof", version: "1.0.0" }, capabilities: { experimentalApi: true } });
      proc.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      await send("thread/start", { cwd: repo, ephemeral: true });
      if (negativeControl) {
        for (const name of agents) assert.ok(warnings.some((warning) => warning.includes(name) && warning.includes("cannot be blank")), `native parser did not observe ${name}`);
        assert.equal(warnings.length, agents.length);
      } else {
        assert.deepEqual(warnings, []);
        const listed = await send("skills/list", { cwds: [repo], forceReload: true });
        const discovered = listed.data.flatMap((entry) => entry.skills).filter((skill) => skill.name.startsWith("flight-rules:")).map((skill) => skill.name).sort();
        assert.deepEqual(discovered, skills.map((name) => `flight-rules:${name}`));
        report.codex.skills = discovered;
      }
      return warnings;
    } finally {
      proc.kill();
      input.close();
    }
  };

  // Deliberately invalidate every role to prove the native parser visits all registrations.
  for (const name of agents) writeFileSync(join(repo, ".codex/agents", `${name}.toml`), `name=${JSON.stringify(name)}\ndescription="Discovery control"\ndeveloper_instructions=""\n`);
  report.codex.negativeControls = await inspect(true);
  for (const name of agents) cpSync(join(pluginRoot, ".codex/agents", `${name}.toml`), join(repo, ".codex/agents", `${name}.toml`));
  await inspect(false);
  report.codex = { ...report.codex, installed: true, agents, installPath: pluginRoot, registrationEvidence: "every role rejected with a deliberate invalid prompt, then accepted when restored" };
  report.artifacts = Object.fromEntries(["claude", "codex"].map((host) => [host, Object.fromEntries(["bin/flight-rules.mjs", "flight-rules-install.json"].map((path) => [path, createHash("sha256").update(readFileSync(join(report[host].installPath, path))).digest("hex")]))]));
  save();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.message;
  save();
  console.error(`Native installation proof failed; inspect ${join(scratch, "report.json")}: ${error.message}`);
  process.exitCode = 1;
}
