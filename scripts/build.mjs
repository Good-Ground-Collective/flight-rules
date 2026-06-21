#!/usr/bin/env node
// Bundles the CLI and embeds the package version at build time.
// Used by `npm run build`; semantic-release's prepareCmd runs set-version.mjs
// (which writes the released version into package.json) and then this build,
// so the binary always reports the version it was released as.
import { chmodSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)
const outfile = fileURLToPath(new URL('../bin/flight-rules', import.meta.url))

await esbuild.build({
  entryPoints: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  // Bundled CommonJS deps (yaml, @octokit/*) call require() at runtime; under
  // "type": "module" the ESM binary has no global require without this.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  define: { _appVersion: JSON.stringify(pkg.version) },
})

chmodSync(outfile, 0o755)
