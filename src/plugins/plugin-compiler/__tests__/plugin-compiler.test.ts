import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import { InvalidPluginSourceError, NativePluginCompiler } from "../plugin-compiler.js";
import { nativeParityFailures } from "./native-parity.js";

const root = join(import.meta.dirname, "../../../..");
const directories: string[] = [];
const temporary = (): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "flight-rules-compiler-")));
  directories.push(directory);
  return directory;
};
const fixture = (): string => {
  const directory = temporary();
  for (const resource of ["agents", "adapters", "skills", "docs", "hooks", "bin"]) {
    cpSync(join(root, resource), join(directory, resource), { recursive: true });
  }
  cpSync(join(root, "package.json"), join(directory, "package.json"));
  return directory;
};
const files = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1)).sort();

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("NativePluginCompiler", () => {
  it("checks both native trees in-process and diagnoses missing future registrations and changed prompts/skills", () => {
    const sourceDir = fixture();
    const compiler = new NativePluginCompiler({ sourceDir });
    for (const host of ["claude", "codex"] as const) compiler.compile(host);
    for (const host of ["claude", "codex"] as const) expect(nativeParityFailures(sourceDir, host)).toEqual([]);

    writeFileSync(join(sourceDir, "agents/future-specialist.md"), "---\nname: future-specialist\ndescription: Future registry entry\ncapabilities: [read]\nmodel: standard\n---\nFuture canonical prompt.\n");
    for (const host of ["claude", "codex"] as const) {
      expect(nativeParityFailures(sourceDir, host)).toContainEqual(expect.stringContaining(`missing future-specialist; emit every registry entry for ${host}`));
      compiler.compile(host);
      expect(nativeParityFailures(sourceDir, host)).toEqual([]);
      const path = join(sourceDir, "dist", host, host === "claude" ? "agents/future-specialist.md" : ".codex/agents/future-specialist.toml");
      writeFileSync(path, readFileSync(path, "utf8").replace("Future canonical prompt.", "Changed native prompt."));
      expect(nativeParityFailures(sourceDir, host)).toContainEqual(expect.stringContaining("native name/prompt drift; preserve"));
      const skill = join(sourceDir, "dist", host, "skills/execute-work/SKILL.md");
      writeFileSync(skill, "Changed skill prompt.");
      expect(nativeParityFailures(sourceDir, host)).toContainEqual(expect.stringContaining(`dist/${host}/skills/execute-work/SKILL.md: skill drift; copy canonical`));
    }
  });

  it("assembles every canonical resource byte and native registration without using a prior target", () => {
    const sourceDir = fixture();
    const result = new NativePluginCompiler({ sourceDir }).compile();
    expect(result.directory).toBe(resolve(sourceDir, "dist/claude"));
    expect(result.diagnostics).toEqual([]);
    for (const resource of ["skills", "docs", "hooks", "bin"]) {
      const source = join(sourceDir, resource);
      const destination = join(result.directory, resource);
      expect(files(destination)).toEqual(files(source));
      for (const path of files(source)) {
        expect(readFileSync(join(destination, path)).equals(readFileSync(join(source, path))), `${resource}/${path}`).toBe(true);
      }
    }
    const definitions = new FileAgentRegistry().load(join(sourceDir, "agents"));
    const manifest = JSON.parse(readFileSync(join(result.directory, ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.version).toBe(JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8")).version);
    expect(manifest.agents).toEqual(definitions.map((agent) => `./agents/${agent.frontmatter.name}.md`));
    expect(result.agents).toEqual(definitions.map((agent) => agent.frontmatter.name));
    for (const agent of definitions) {
      const native = readFileSync(join(result.directory, "agents", `${agent.frontmatter.name}.md`), "utf8");
      const match = /^---\n([\s\S]*?)^---\n/m.exec(native);
      expect(parseYaml(match?.[1] ?? "").name).toBe(agent.frontmatter.name);
      expect(native.slice(match?.[0].length)).toBe(agent.body);
    }
  });

  it.each(["claude", "codex"] as const)("ships an executable %s CLI whose document paths stay local after relocation", (host) => {
    const result = new NativePluginCompiler({ sourceDir: fixture() }).compile(host);
    const parent = temporary();
    const relocated = join(parent, "relocated-plugin");
    renameSync(result.directory, relocated);
    const output = execFileSync(process.execPath, [join(relocated, "bin/flight-rules.mjs"), "doc", "coding-charter"], { cwd: tmpdir(), env: { ...process.env, FLIGHT_RULES_HOME: "" }, encoding: "utf8" });
    expect(output).toBe(readFileSync(join(relocated, "docs/coding-charter.md"), "utf8") + "\n");
    const path = execFileSync(process.execPath, [join(relocated, "bin/flight-rules.mjs"), "doc", "coding-charter", "--path"], { env: { ...process.env, FLIGHT_RULES_HOME: "" }, encoding: "utf8" });
    expect(path.trim()).toBe(join(relocated, "docs/coding-charter.md"));
    const charterPaths = execFileSync(process.execPath, [join(relocated, "bin/flight-rules.mjs"), "charter", "src/example.ts", "--path"], { cwd: tmpdir(), env: { ...process.env, FLIGHT_RULES_HOME: "" }, encoding: "utf8" });
    expect(charterPaths.trim().split("\n")).toEqual([
      join(relocated, "docs/coding-charter.md"),
      join(relocated, "docs/coding-charter-typescript.md"),
    ]);
    for (const executable of ["flight-rules", "flight-rules.mjs"]) {
      expect(statSync(join(relocated, "bin", executable)).mode & 0o111).toBe(0o111);
    }
    const caller = temporary();
    const configPath = execFileSync(process.execPath, [join(relocated, "bin/flight-rules.mjs"), "config", "path"], {
      cwd: caller, env: { PATH: process.env["PATH"] }, encoding: "utf8",
    }).trim();
    expect(configPath).toBe(join(caller, host === "codex" ? ".agents" : ".claude", "flight-rules.local.md"));
    const overridden = execFileSync(process.execPath, [join(relocated, "bin/flight-rules.mjs"), "config", "path"], {
      cwd: caller, env: { PATH: process.env["PATH"], FLIGHT_RULES_HOST: host === "codex" ? "claude" : "codex" }, encoding: "utf8",
    }).trim();
    expect(overridden).toBe(join(caller, host === "codex" ? ".claude" : ".agents", "flight-rules.local.md"));
    const installation = JSON.parse(readFileSync(join(relocated, "flight-rules-install.json"), "utf8"));
    expect(installation.host).toBe(host);
    expect(installation.agents.map((agent: { registration: unknown }) => agent.registration)).toEqual(
      new FileAgentRegistry().load(join(root, "agents")).map((agent) => agent.frontmatter),
    );
    if (host === "claude") {
      const hooks = readFileSync(join(relocated, "hooks/hooks.json"), "utf8");
      const paths = [...hooks.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}(\/[^"\s]+)/g)].map((match) => match[1] ?? "");
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) expect(existsSync(join(relocated, path))).toBe(true);
    }
  });

  it("assembles a native Codex plugin plus standalone agents without advertising unsupported hooks or agent discovery", () => {
    const sourceDir = fixture();
    const result = new NativePluginCompiler({ sourceDir }).compile("codex");
    expect(result.directory).toBe(resolve(sourceDir, "dist/codex"));
    for (const resource of ["skills", "docs", "bin"]) {
      const source = join(sourceDir, resource);
      const destination = join(result.directory, resource);
      expect(files(destination)).toEqual(files(source));
      for (const path of files(source)) {
        expect(readFileSync(join(destination, path)).equals(readFileSync(join(source, path))), `${resource}/${path}`).toBe(true);
      }
    }
    const identity = JSON.parse(readFileSync(join(sourceDir, "adapters/plugin.json"), "utf8"));
    const { version } = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
    const portable = JSON.parse(readFileSync(join(result.directory, "plugin.json"), "utf8"));
    expect(portable).toEqual({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", ...identity, version });
    const native = JSON.parse(readFileSync(join(result.directory, ".codex-plugin/plugin.json"), "utf8"));
    expect(native).toEqual({ ...identity, version, skills: "./skills/" });
    expect(existsSync(join(result.directory, "hooks"))).toBe(false);
    const definitions = new FileAgentRegistry().load(join(sourceDir, "agents"));
    expect(result.agents).toEqual(definitions.map((agent) => agent.frontmatter.name));
    expect(files(join(result.directory, ".codex/agents"))).toEqual(definitions.map((agent) => `${agent.frontmatter.name}.toml`).sort());
    for (const agent of definitions) {
      const registration = parseToml(readFileSync(join(result.directory, ".codex/agents", `${agent.frontmatter.name}.toml`), "utf8"));
      expect(registration.name).toBe(agent.frontmatter.name);
      expect(registration.developer_instructions).toBe(agent.body);
      expect(registration.web_search).toBe(agent.frontmatter.capabilities.includes("web") ? "live" : "disabled");
    }
    expect(parseToml(readFileSync(join(result.directory, ".codex/config.toml"), "utf8"))).toEqual({ agents: { enabled: true } });
    expect(JSON.parse(readFileSync(join(result.directory, "diagnostics.json"), "utf8"))).toEqual(result.diagnostics);
    expect(result.diagnostics).toContain("Claude commit and Ariadne hooks are omitted; this target emits no Codex hooks.");
    const reasoning = "adapters/codex/reasoning-tiers.json";
    expect(readFileSync(join(result.directory, reasoning), "utf8")).toBe(readFileSync(join(sourceDir, reasoning), "utf8"));
  });

  it("removes stale output without changing canonical sources", () => {
    const sourceDir = fixture();
    const compiler = new NativePluginCompiler({ sourceDir });
    const result = compiler.compile();
    const source = readFileSync(join(sourceDir, "agents/code-verifier.md"));
    writeFileSync(join(result.directory, "agents", "obsolete.md"), "stale");
    mkdirSync(join(result.directory, "skills", "obsolete"));
    writeFileSync(join(result.directory, "skills", "obsolete", "SKILL.md"), "stale");
    compiler.compile();
    expect(existsSync(join(result.directory, "agents", "obsolete.md"))).toBe(false);
    expect(existsSync(join(result.directory, "skills", "obsolete"))).toBe(false);
    expect(readFileSync(join(sourceDir, "agents/code-verifier.md"))).toEqual(source);
  });

  it("rejects escaping source symlinks before replacing an existing target", () => {
    const sourceDir = fixture();
    const compiler = new NativePluginCompiler({ sourceDir });
    const result = compiler.compile();
    const external = temporary();
    writeFileSync(join(external, "outside.md"), "outside");
    symlinkSync(join(external, "outside.md"), join(sourceDir, "docs", "escape.md"));
    expect(() => compiler.compile()).toThrow(InvalidPluginSourceError);
    expect(existsSync(join(result.directory, "agents", "code-verifier.md"))).toBe(true);
    expect(readFileSync(join(external, "outside.md"), "utf8")).toBe("outside");
  });

  it("rejects a symlinked output parent and a missing CLI", () => {
    const sourceDir = fixture();
    const external = temporary();
    symlinkSync(external, join(sourceDir, "dist"));
    expect(() => new NativePluginCompiler({ sourceDir }).compile()).toThrow(InvalidPluginSourceError);
    expect(readdirSync(external)).toEqual([]);
    unlinkSync(join(sourceDir, "dist"));
    rmSync(join(sourceDir, "bin", "flight-rules"));
    expect(() => new NativePluginCompiler({ sourceDir }).compile()).toThrow(/Build the CLI/);
  });
});
