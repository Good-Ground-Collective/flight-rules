#!/usr/bin/env node
// Bundles the CLI and embeds the package version at build time.
// Used by `npm run build`; semantic-release's prepareCmd runs set-version.mjs
// (which writes the released version into package.json) and then this build,
// so the binary always reports the version it was released as.
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
// Release preparation owns these trees. Rebuild from sources so removed
// modules/resources cannot survive an earlier build.
for (const resource of ["../bin/", "../dist/"]) {
  const directory = fileURLToPath(new URL(resource, import.meta.url));
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Generated output cannot use a symlink: ${directory}`);
  }
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}
const shim = fileURLToPath(new URL("../bin/flight-rules", import.meta.url));
writeFileSync(shim, '#!/bin/sh\n# Generated PATH shim; canonical source is scripts/build.mjs.\nexec node "$(dirname "$0")/flight-rules.mjs" "$@"\n');
chmodSync(shim, 0o755);
// .mjs, not extensionless: Node refuses extensionless ESM entries under "type": "module"
const outfile = fileURLToPath(new URL("../bin/flight-rules.mjs", import.meta.url));

await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  // Bundled CommonJS deps (yaml, @octokit/*) call require() at runtime; under
  // "type": "module" the ESM binary has no global require without this.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  define: { _appVersion: JSON.stringify(pkg.version) },
});

chmodSync(outfile, 0o755);

await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
  define: { _appVersion: JSON.stringify(pkg.version) },
});

await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/code-review/index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: fileURLToPath(new URL("../dist/review.js", import.meta.url)),
});
const { reviewContract } = await import(new URL("../dist/review.js", import.meta.url));
const contractsDir = fileURLToPath(new URL("../contracts/code-review", import.meta.url));
mkdirSync(contractsDir, { recursive: true });
const schemas = reviewContract.schemas();
writeFileSync(
  `${contractsDir}/review.v1.schema.json`,
  `${JSON.stringify(schemas.full, null, 2)}\n`,
);
writeFileSync(
  `${contractsDir}/review.v1.transport.schema.json`,
  `${JSON.stringify(schemas.transport, null, 2)}\n`,
);

const { NativePluginCompiler } = await import(new URL("../dist/index.js", import.meta.url));
new NativePluginCompiler({ sourceDir: fileURLToPath(new URL("../", import.meta.url)) }).compile();
const codex = new NativePluginCompiler({ sourceDir: fileURLToPath(new URL("../", import.meta.url)) }).compile("codex");
for (const diagnostic of codex.diagnostics) process.stderr.write(`Codex: ${diagnostic}\n`);
// Switch native catalogs only once both complete targets exist. Release commits
// these generated catalogs together with their targets, preserving the previous
// installation path until that commit reaches main.
for (const [host, destination] of [["claude", "../.claude-plugin/marketplace.json"], ["codex", "../.agents/plugins/marketplace.json"]]) {
  const path = fileURLToPath(new URL(destination, import.meta.url));
  mkdirSync(fileURLToPath(new URL("./", new URL(destination, import.meta.url))), { recursive: true });
  copyFileSync(new URL(`../adapters/${host}/marketplace.json`, import.meta.url), path);
}
rmSync(new URL("../.claude-plugin/plugin.json", import.meta.url), { force: true });
