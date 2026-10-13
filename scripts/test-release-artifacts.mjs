#!/usr/bin/env node
// Exercise the actual Git release plugin against a disposable local remote.
// No registry publication, network remote, user config changes or model calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-release-proof-")));
const repository = join(scratch, "repository");
const remote = join(scratch, "remote.git");
mkdirSync(repository);
const run = (program, args, cwd = repository) => execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (...args) => run("git", args).trim();
const files = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(repository.length + 1));
const generated = (path) => path.startsWith("bin/") || path.startsWith("dist/") || path.startsWith("contracts/code-review/") ||
  [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"].includes(path);
const version = "99.0.0-release-proof";
const report = { version, networkPush: false, registryPublish: false, modelTurns: 0 };

try {
  for (const resource of ["src", "scripts", "skills", "docs", "agents", "adapters", "hooks", ".claude-plugin", ".agents", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ".gitignore"]) {
    cpSync(join(home, resource), join(repository, resource), { recursive: true });
  }
  symlinkSync(join(home, "node_modules"), join(repository, "node_modules"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Release artifact proof");
  git("config", "user.email", "release-proof@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  git("config", "commit.gpgsign", "false");
  run("git", ["init", "--bare", "-q", remote]);
  const stale = ["bin/obsolete.mjs", "dist/obsolete.d.ts", "dist/codex/.codex/agents/obsolete.toml", ".claude-plugin/plugin.json"];
  for (const path of stale) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), "stale tracked output\n");
  }
  // Start with the old root source. Preparation must switch it atomically in
  // the same commit that contains the complete native packages.
  writeFileSync(join(repository, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "flight-rules", plugins: [{ name: "flight-rules", source: "./" }] }));
  git("add", ".");
  git("add", "--force", ...stale);
  git("commit", "-qm", "fixture sources and previous release artifacts");
  const baseline = git("rev-parse", "HEAD");
  run(process.execPath, [join(repository, "scripts/set-version.mjs"), version]);
  run("npm", ["run", "build"]);
  for (const path of stale) assert.equal(existsSync(join(repository, path)), false, `stale output remains: ${path}`);
  const artifacts = [...["bin", "dist", "contracts/code-review"].flatMap((path) => files(join(repository, path))), ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"];
  const manifests = ["dist/claude/.claude-plugin/plugin.json", "dist/codex/.codex-plugin/plugin.json", "dist/codex/plugin.json"];
  for (const path of manifests) assert.equal(JSON.parse(readFileSync(join(repository, path), "utf8")).version, version);
  for (const path of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"]) {
    assert.equal(JSON.parse(readFileSync(join(repository, path), "utf8")).version, undefined);
    const host = path.startsWith(".claude") ? "claude" : "codex";
    assert.equal(readFileSync(join(repository, path), "utf8"), readFileSync(join(home, `adapters/${host}/marketplace.json`), "utf8"));
  }
  assert.equal(JSON.parse(readFileSync(join(repository, ".claude-plugin/marketplace.json"), "utf8")).plugins[0].source, "./dist/claude");
  const sourceChanges = git("diff", "--name-only").split("\n").filter((path) => path && !generated(path)).sort();
  assert.deepEqual(sourceChanges, ["package-lock.json", "package.json"]);
  writeFileSync(join(repository, "unrelated-source.txt"), "must not enter the release commit\n");
  const pkg = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  const config = pkg.release.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/git")[1];
  const { prepare } = createRequire(import.meta.url)("@semantic-release/git");
  await prepare(config, {
    cwd: repository, env: process.env, branch: { name: "main" }, options: { repositoryUrl: remote },
    lastRelease: {}, nextRelease: { version, gitTag: `v${version}`, notes: "Scratch artifact coverage proof" },
    logger: { log() {}, error() {} },
  });
  const tracked = new Set(git("ls-files").split("\n"));
  for (const path of artifacts) assert.ok(tracked.has(path), `release omitted generated file: ${path}`);
  for (const path of stale) assert.equal(tracked.has(path), false, `release failed to stage deletion: ${path}`);
  assert.equal(tracked.has("unrelated-source.txt"), false);
  const committed = git("diff", "--name-only", baseline, "HEAD").split("\n").filter(Boolean);
  assert.deepEqual(committed.filter((path) => !generated(path)).sort(), ["package-lock.json", "package.json"]);
  const releaseHead = git("rev-parse", "HEAD");
  assert.equal(run("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"]).trim(), releaseHead);
  assert.equal(git("diff", "--name-only"), "");

  const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--cache", join(scratch, "npm-cache"), "--pack-destination", scratch, "--json"]));
  const extracted = join(scratch, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", join(scratch, packed[0].filename), "-C", extracted]);
  const packageRoot = join(extracted, "package");
  const packedPaths = new Set(packed[0].files.map((file) => file.path));
  for (const path of artifacts) assert.ok(packedPaths.has(path), `npm omitted generated file: ${path}`);
  for (const path of manifests) assert.equal(JSON.parse(readFileSync(join(packageRoot, path), "utf8")).version, version);
  for (const target of ["", "dist/claude", "dist/codex"]) {
    const location = join(packageRoot, target);
    assert.equal(run(process.execPath, [join(location, "bin/flight-rules.mjs"), "--version"], scratch).trim(), version);
    assert.equal(run(process.execPath, [join(location, "bin/flight-rules.mjs"), "doc", "coding-charter"], scratch), readFileSync(join(location, "docs/coding-charter.md"), "utf8") + "\n");
    for (const binary of ["flight-rules", "flight-rules.mjs"]) assert.equal(statSync(join(location, "bin", binary)).mode & 0o111, 0o111);
  }
  symlinkSync(join(home, "node_modules"), join(packageRoot, "node_modules"));
  const imported = JSON.parse(run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { appVersion, createFlightRules } from '@good-ground-collective/flight-rules';
    import { reviewContract, FileReviewPolicy } from '@good-ground-collective/flight-rules/review';
    import full from '@good-ground-collective/flight-rules/review/schema' with { type: 'json' };
    import transport from '@good-ground-collective/flight-rules/review/transport-schema' with { type: 'json' };
    assert.deepEqual(full, reviewContract.schemas().full);
    assert.deepEqual(transport, reviewContract.schemas().transport);
    assert.ok(new FileReviewPolicy().load().method.includes('fix, clarify and decide'));
    assert.equal(createFlightRules({cwd:'/nonexistent',env:{}}).docs().resolve('coding-charter').id,'coding-charter');
    console.log(JSON.stringify({version:appVersion,root:true,review:true,schemas:true}));
  `], packageRoot));
  assert.equal(imported.version, version);
  Object.assign(report, { generatedFiles: artifacts.length, nativeManifests: manifests.length, staleDeletions: stale.length, sourceChanges, ignoredDotfilesCommitted: true, atomicMarketplaceSwitch: true, localRemoteHeadMatched: true, npmArtifactCoverage: true, relocatedClis: 3, imports: imported, scratch });
  writeFileSync(join(scratch, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(scratch, "report.json"), JSON.stringify({ ...report, error: error.message }, null, 2) + "\n");
  console.error(`Release proof failed; evidence is in ${scratch}: ${error.message}`);
  process.exitCode = 1;
}
