import { afterEach, expect, test } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./run-native-workflow-stage.mjs", import.meta.url));
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(behavior = "success") {
  const root = mkdtempSync(join(tmpdir(), "flight-rules-stage-test-"));
  roots.push(root);
  const plugin = join(root, "plugin");
  const repo = join(root, "workflow-codex");
  const bin = join(root, "test-bin");
  const sourceHome = join(root, "source-home");
  const isolatedHome = join(root, "codex-home");
  for (const dir of [join(plugin, "bin"), repo, bin, sourceHome, isolatedHome]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(plugin, "bin/flight-rules.mjs"), "// fixture\n");
  writeFileSync(join(plugin, "flight-rules-install.json"), "{}\n");
  writeFileSync(join(sourceHome, "auth.json"), '{"test":"synthetic-login"}', { mode: 0o600 });
  writeFileSync(join(root, "report.json"), JSON.stringify({ codex: { installPath: plugin } }));
  writeFileSync(join(root, "prompt.txt"), "Synthetic runner lifecycle check; no model call.");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["remote", "add", "origin", "https://github.com/Good-Ground-Collective/flight-rules-e5-proof-runner-test"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture"], { cwd: repo });
  writeFileSync(join(bin, "codex"), `#!/usr/bin/env node
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) {
  if (${JSON.stringify(behavior)} === 'version-failure') process.exit(7);
  console.log('synthetic-test-client');
} else {
  writeFileSync(join(process.env.CODEX_HOME, 'observed-mode'), String(statSync(join(process.env.CODEX_HOME, 'auth.json')).mode & 0o777));
  process.stdin.resume();
  if (${JSON.stringify(behavior)} === 'timeout') {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  } else process.stdin.on('end', () => console.log(JSON.stringify({ type: 'synthetic-completion' })));
}
`, { mode: 0o700 });
  return { root, isolatedHome, sourceHome, seconds: behavior === "timeout" ? "1" : "10", env: { ...process.env, CODEX_HOME: sourceHome, PATH: `${bin}:${process.env.PATH}` } };
}

async function run(f, stage = "check") {
  const child = spawn(process.execPath, [runner, "--root", f.root, "--host", "codex", "--stage", stage, "--prompt", join(f.root, "prompt.txt"), "--max-seconds", f.seconds], { env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  return { code, output };
}

test("records a completed process, restricts the copied login and removes it", async () => {
  const f = fixture();
  expect((await run(f)).code).toBe(0);
  expect(readFileSync(join(f.isolatedHome, "observed-mode"), "utf8")).toBe("384");
  expect(existsSync(join(f.isolatedHome, "auth.json"))).toBe(false);
  expect(JSON.parse(readFileSync(join(f.root, "codex-check-result.json"), "utf8"))).toMatchObject({ exitCode: 0, timedOut: false });
  expect(readFileSync(join(f.sourceHome, "auth.json"), "utf8")).toBe('{"test":"synthetic-login"}');
  expect((await run(f)).code).not.toBe(0);
  expect(existsSync(join(f.isolatedHome, "auth.json"))).toBe(false);
});

test("removes its copied login when client discovery fails before launch", async () => {
  const f = fixture("version-failure");
  expect((await run(f)).code).not.toBe(0);
  expect(existsSync(join(f.isolatedHome, "auth.json"))).toBe(false);
});

test("does not replace or remove a pre-existing isolated login", async () => {
  const f = fixture();
  const auth = join(f.isolatedHome, "auth.json");
  writeFileSync(auth, "existing-login");
  expect((await run(f)).code).not.toBe(0);
  expect(readFileSync(auth, "utf8")).toBe("existing-login");
});

test("terminates an unresponsive client at its bound and removes the login", async () => {
  const f = fixture("timeout");
  expect((await run(f)).code).not.toBe(0);
  expect(JSON.parse(readFileSync(join(f.root, "codex-check-result.json"), "utf8"))).toMatchObject({ timedOut: true, interrupted: true, signal: "SIGKILL" });
  expect(existsSync(join(f.isolatedHome, "auth.json"))).toBe(false);
}, 10000);
