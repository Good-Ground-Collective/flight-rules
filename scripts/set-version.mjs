#!/usr/bin/env node
// Stamp package metadata and existing native manifests; fresh builds derive
// their version from package.json. Marketplace catalogs have no version field.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
  console.error("Usage: set-version.mjs <semver>");
  process.exit(1);
}
const targets = [
  "package.json", "package-lock.json",
  "dist/claude/.claude-plugin/plugin.json",
  "dist/codex/.codex-plugin/plugin.json", "dist/codex/plugin.json",
];
for (const target of targets) {
  const path = new URL(`../${target}`, import.meta.url);
  if (!existsSync(path)) continue;
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  if (target === "package-lock.json") json.packages[""].version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.error(`set version ${version} in ${target}`);
}
