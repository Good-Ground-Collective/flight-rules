#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const generated = (path) => path.startsWith("bin/") || path.startsWith("dist/") ||
  ["contracts/code-review/review.v1.schema.json", "contracts/code-review/review.v1.transport.schema.json",
    ".claude-plugin/marketplace.json", ".claude-plugin/plugin.json", ".agents/plugins/marketplace.json"].includes(path);
const [base, head] = process.argv.slice(2);
let violations;
if (base === "--working-tree") {
  const paths = [
    ...execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], { encoding: "utf8" }).split("\0"),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0"),
  ];
  violations = [...new Set(paths.filter((path) => path && !generated(path)))];
} else {
  if (!base || !head || !/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) {
    console.error("Usage: check-source-artifacts.mjs <base-sha> <head-sha> | --working-tree");
    process.exit(1);
  }
  const changes = execFileSync("git", ["diff", "--no-renames", "--name-status", "-z", `${base}...${head}`], { encoding: "utf8" }).split("\0");
  violations = [];
  for (let index = 0; index < changes.length - 1; index += 2) {
    // Deletions permit the explicit migration away from selectively committed
    // artifacts. Releases regenerate their owned trees from canonical sources.
    if (changes[index] !== "D" && generated(changes[index + 1])) violations.push(changes[index + 1]);
  }
}
if (violations.length) {
  console.error(`${base === "--working-tree" ? "Uncommitted canonical sources" : "Generated artifacts belong to release preparation"}:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else console.log(base === "--working-tree" ? "All canonical source changes are committed." : "Source PR contains no added or modified generated artifacts.");
