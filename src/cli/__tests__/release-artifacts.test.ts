import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const temporary: string[] = [];
const fixture = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "flight-rules-release-"));
  temporary.push(directory);
  execFileSync("git", ["init", "-q", directory]);
  execFileSync("git", ["config", "user.name", "Release fixture"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: directory });
  writeFileSync(join(directory, ".gitignore"), "bin/\ndist/\ncontracts/code-review/*.schema.json\n");
  return directory;
};
const write = (directory: string, path: string, text: string): void => {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), text);
};
const commit = (directory: string): string => {
  execFileSync("git", ["add", "--force", "--all"], { cwd: directory });
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], { cwd: directory });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
};
const check = (directory: string, ...args: string[]) => spawnSync(process.execPath, [join(root, "scripts/check-source-artifacts.mjs"), ...args], { cwd: directory, encoding: "utf8" });

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("release artifact ownership", () => {
  it.each(["bin/flight-rules", "dist/codex/.codex-plugin/plugin.json", "contracts/code-review/review.v1.schema.json", ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"])("rejects a source PR adding ignored artifact %s", (path) => {
    const directory = fixture();
    const base = commit(directory);
    write(directory, path, "generated");
    const head = commit(directory);
    const result = check(directory, base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path);
  });

  it("rejects modifications to tracked ignored output but permits explicit artifact removal", () => {
    const directory = fixture();
    write(directory, "dist/index.js", "old");
    const base = commit(directory);
    write(directory, "dist/index.js", "new");
    const changed = commit(directory);
    expect(check(directory, base, changed).status).toBe(1);
    rmSync(join(directory, "dist/index.js"));
    write(directory, "scripts/build.mjs", "canonical source");
    const migrated = commit(directory);
    expect(check(directory, base, migrated).status).toBe(0);
  });

  it("checks every uncommitted source while allowing local generated changes", () => {
    const directory = fixture();
    write(directory, "bin/flight-rules", "old output");
    const base = commit(directory);
    write(directory, "bin/flight-rules", "local rebuild");
    expect(check(directory, "--working-tree").status).toBe(0);
    write(directory, "src/new.ts", "canonical");
    expect(check(directory, "--working-tree").stderr).toContain("src/new.ts");
    execFileSync("git", ["add", "src/new.ts"], { cwd: directory });
    expect(check(directory, "--working-tree").status).toBe(1);
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "source only"], { cwd: directory });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
    expect(check(directory, base, head).status).toBe(0);
    expect(check(directory, "--working-tree").status).toBe(0);
  });

  it("stamps all native versions and lock metadata without changing marketplace catalogs", () => {
    const directory = fixture();
    mkdirSync(join(directory, "scripts"));
    cpSync(join(root, "scripts/set-version.mjs"), join(directory, "scripts/set-version.mjs"));
    const manifests = ["package.json", "dist/claude/.claude-plugin/plugin.json", "dist/codex/.codex-plugin/plugin.json", "dist/codex/plugin.json"];
    for (const path of manifests) write(directory, path, JSON.stringify({ name: "flight-rules", version: "1.0.0" }));
    write(directory, "package-lock.json", JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } }));
    const catalogs = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"];
    for (const path of catalogs) write(directory, path, '{"name":"flight-rules","plugins":[]}\n');
    execFileSync(process.execPath, [join(directory, "scripts/set-version.mjs"), "2.0.0"], { stdio: "pipe" });
    for (const path of manifests) expect(JSON.parse(readFileSync(join(directory, path), "utf8")).version).toBe("2.0.0");
    const lock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
    expect(lock.version).toBe("2.0.0");
    expect(lock.packages[""].version).toBe("2.0.0");
    for (const path of catalogs) expect(readFileSync(join(directory, path), "utf8")).toBe('{"name":"flight-rules","plugins":[]}\n');
    rmSync(join(directory, "dist"), { recursive: true });
    expect(spawnSync(process.execPath, [join(directory, "scripts/set-version.mjs"), "3.0.0"], { stdio: "pipe" }).status).toBe(0);
  });
});
