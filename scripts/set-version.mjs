#!/usr/bin/env node
// Writes a release version into the files that carry it. Invoked by
// semantic-release's @semantic-release/exec prepareCmd as:
//   node scripts/set-version.mjs <version>
// package.json is conventional; .claude-plugin/plugin.json is the version
// Claude Code's plugin system actually reads, and nothing else updates it.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
  console.error('Usage: set-version.mjs <version>')
  process.exit(1)
}

const targets = ['../package.json', '../.claude-plugin/plugin.json']

for (const rel of targets) {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const json = JSON.parse(readFileSync(path, 'utf8'))
  json.version = version
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
  console.error(`set version ${version} in ${rel.replace('../', '')}`)
}
