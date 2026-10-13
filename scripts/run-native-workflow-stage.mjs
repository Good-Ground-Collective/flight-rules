#!/usr/bin/env node
// Run one human-controlled stage against a scratch installation. Never synthesize a reply.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, constants, chmodSync, closeSync, existsSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  root: { type: "string" }, host: { type: "string" }, stage: { type: "string" },
  prompt: { type: "string" }, session: { type: "string" },
  "read-only": { type: "boolean", default: false },
  "max-seconds": { type: "string", default: "600" },
  "max-budget-usd": { type: "string", default: "12" },
} });
assert.ok(values.root && values.prompt, "--root and --prompt are required");
assert.ok(["claude", "codex"].includes(values.host), "--host must be claude or codex");
assert.match(values.stage ?? "", /^[a-z][a-z0-9-]*$/, "--stage must be a unique filename-safe stage name");
const seconds = Number(values["max-seconds"]);
const budget = Number(values["max-budget-usd"]);
assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 600, "runtime must be 1–600 seconds");
assert.ok(Number.isFinite(budget) && budget > 0 && budget <= 12, "Claude budget must be greater than zero and at most $12");
const root = realpathSync(values.root);
const report = JSON.parse(readFileSync(join(root, "report.json"), "utf8"));
const host = values.host;
const plugin = realpathSync(report[host].installPath);
const cwd = realpathSync(join(root, `workflow-${host}`));
for (const path of [plugin, cwd]) {
  const child = relative(root, path);
  assert.ok(child && !child.startsWith(".."), "installation and repository must remain inside the scratch root");
}
const inspectionOptions = { encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL" };
const origin = execFileSync("git", ["remote", "get-url", "origin"], { ...inspectionOptions, cwd }).trim();
assert.match(origin, /^https:\/\/github\.com\/Good-Ground-Collective\/flight-rules-e5-proof-[a-z0-9-]+(?:\.git)?$/, "only disposable proof repositories are accepted");
const prompt = readFileSync(values.prompt, "utf8");
assert.ok(prompt.trim(), "the stage needs an explicit operator prompt");
const prefix = join(root, `${host}-${values.stage}`);
for (const suffix of ["-invocation.json", "-events.jsonl", "-stderr.txt", "-result.json"]) {
  assert.equal(existsSync(prefix + suffix), false, "use a new stage name; never overwrite prior evidence");
}
const env = { ...process.env, FLIGHT_RULES_HOME: plugin, FLIGHT_RULES_HOST: host, PATH: `${join(plugin, "bin")}:${process.env.PATH ?? ""}` };
delete env.FLIGHT_RULES_CONFIG;
if (!env.GITHUB_TOKEN && env.GH_TOKEN) env.GITHUB_TOKEN = env.GH_TOKEN;
const args = [];
let temporaryAuth;
let originalAuth;
let ownsTemporaryAuth = false;
if (host === "claude") {
  // Isolate settings and plugin loading while retaining the native user's login.
  delete env.CLAUDE_CONFIG_DIR;
  env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = "2";
  env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1";
  const settings = join(root, "workflow-claude-settings.json");
  writeFileSync(settings, JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false }) + "\n");
  args.push("--print", "--output-format", "stream-json", "--verbose", "--plugin-dir", plugin,
    "--setting-sources", "project,local", "--settings", settings, "--permission-mode", "dontAsk",
    "--max-turns", "60", "--max-budget-usd", String(budget));
  if (values.session) args.push("--resume", values.session);
  args.push("--allowedTools", "Read", "Glob", "Grep", "Bash(flight-rules doc *)");
  if (!values["read-only"]) args.push("Edit", "Write", "Agent", "WebSearch", "WebFetch", "Bash(flight-rules *)",
    "Bash(git *)", "Bash(gh *)", "Bash(node *)", "Bash(npm test*)", "Bash(pwd)", "Bash(ls *)", "Bash(cat *)");
} else {
  const originalHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  env.CODEX_HOME = realpathSync(join(root, "codex-home"));
  assert.ok(relative(root, env.CODEX_HOME) && !relative(root, env.CODEX_HOME).startsWith(".."), "Codex home must stay isolated");
  temporaryAuth = join(env.CODEX_HOME, "auth.json");
  assert.equal(existsSync(temporaryAuth), false, "existing isolated login must not be replaced");
  originalAuth = join(originalHome, "auth.json");
  if (values["read-only"]) args.push("-a", "never", "exec", "-c", 'sandbox_mode="read-only"');
  else args.push("exec", "--approve-for-me", "-c", "sandbox_workspace_write.network_access=true");
  if (values.session) args.push("resume");
  args.push("--json", "--skip-git-repo-check", "--output-last-message", prefix + "-answer.txt");
  if (values.session) args.push(values.session);
  args.push("-");
}

let child;
let timedOut = false;
let interrupted = false;
let timer;
let killTimer;
let output;
let errors;
const stop = () => {
  if (!child?.pid) return;
  interrupted = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  killTimer = setTimeout(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }, 2_000);
};
try {
  if (temporaryAuth) {
    copyFileSync(originalAuth, temporaryAuth, constants.COPYFILE_EXCL);
    ownsTemporaryAuth = true;
    chmodSync(temporaryAuth, 0o600);
  }
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  writeFileSync(prefix + "-invocation.json", JSON.stringify({
    host, stage: values.stage, cwd, origin, plugin, command: [host, ...args], timeoutSeconds: seconds,
    claudeBudgetUsd: host === "claude" ? budget : null, codexCostCap: null,
    hostVersion: execFileSync(host, ["--version"], { ...inspectionOptions, env }).trim(),
    promptSha256: hash(values.prompt), cliSha256: hash(join(plugin, "bin/flight-rules.mjs")),
    manifestSha256: hash(join(plugin, "flight-rules-install.json")),
    initialHead: execFileSync("git", ["rev-parse", "HEAD"], { ...inspectionOptions, cwd }).trim(),
  }, null, 2) + "\n", { flag: "wx" });
  output = openSync(prefix + "-events.jsonl", "wx", 0o600);
  errors = openSync(prefix + "-stderr.txt", "wx", 0o600);
  child = spawn(host, args, { cwd, env, detached: true, stdio: ["pipe", output, errors] });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  timer = setTimeout(() => { timedOut = true; stop(); }, seconds * 1_000);
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, timedOut, interrupted }));
  });
  writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ host, stage: values.stage, ...result, evidencePrefix: prefix }));
  process.exitCode = result.exitCode === 0 && !timedOut && !interrupted ? 0 : 1;
} finally {
  try {
    if (interrupted && child?.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    try {
      if (ownsTemporaryAuth) unlinkSync(temporaryAuth);
    } finally {
      if (output !== undefined) closeSync(output);
      if (errors !== undefined) closeSync(errors);
    }
  }
}
