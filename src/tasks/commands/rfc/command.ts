/* eslint-disable preflight/no-planning-identifiers -- RFC ids are this module's subject matter, not a reference to some external planning system that will outlive its meaning */
import { readdirSync } from "node:fs";
import { Command } from "commander";
import { getRfcDir } from "../../../shared/config.js";
import type { Config } from "../../../shared/config.js";

// eslint-disable-next-line preflight/no-loose-functions -- getNextRfcId is module-level behaviour awaiting a home on a service; tracked in KAN-39
function getNextRfcId(rfcDir: string): string {
  let files: string[];
  try {
    files = readdirSync(rfcDir);
  } catch {
    return "RFC-001";
  }
  const ids = files
    .map((f) => f.match(/^RFC-(\d+)\.md$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseInt(m[1] ?? "0", 10));
  if (ids.length === 0) return "RFC-001";
  return `RFC-${(Math.max(...ids) + 1).toString().padStart(3, "0")}`;
}

export function createRfcCommand(
  getConfig: () => Config,
  getCwd: () => string = () => process.cwd(),
): Command {
  const rfc = new Command("rfc");

  rfc
    .command("next-id")
    .exitOverride()
    .action(() => {
      const rfcDir = getRfcDir(getConfig(), getCwd());
      process.stdout.write(`${getNextRfcId(rfcDir)}\n`);
    });

  rfc
    .command("dir")
    .exitOverride()
    .action(() => {
      process.stdout.write(`${getRfcDir(getConfig(), getCwd())}\n`);
    });

  return rfc;
}
