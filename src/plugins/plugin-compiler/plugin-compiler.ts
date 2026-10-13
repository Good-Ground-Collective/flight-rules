import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { MarkdownClaudeAgentEmitter } from "../../agents/agent-emitter/claude-agent-emitter.js";
import { FileAgentRegistry } from "../../agents/agent-registry/agent-registry.js";

const NativePluginCompilerPropsSchema = z.strictObject({ sourceDir: z.string().min(1) });
const PackageVersionSchema = z.object({ version: z.string().min(1) });
const PluginIdentitySchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  repository: z.url(),
  author: z.strictObject({ name: z.string().min(1) }),
  license: z.string().min(1),
});

export interface CompiledPlugin {
  directory: string;
  agents: string[];
  diagnostics: string[];
}

export interface PluginCompiler {
  compile(): CompiledPlugin;
}

export class InvalidPluginSourceError extends Error {
  override name = "InvalidPluginSourceError";
}

/** Assembles native packages without rewriting canonical skills or retaining stale generated resources. */
export class NativePluginCompiler implements PluginCompiler {
  private readonly sourceDir: string;

  constructor(props: z.infer<typeof NativePluginCompilerPropsSchema>) {
    this.sourceDir = realpathSync(resolve(NativePluginCompilerPropsSchema.parse(props).sourceDir));
  }

  compile(): CompiledPlugin {
    for (const resource of ["package.json", "adapters", "agents", "skills", "docs", "hooks", "bin"]) {
      this.validateSource(join(this.sourceDir, resource));
    }
    const identity = PluginIdentitySchema.parse(JSON.parse(readFileSync(join(this.sourceDir, "adapters/plugin.json"), "utf8")));
    const { version } = PackageVersionSchema.parse(JSON.parse(readFileSync(join(this.sourceDir, "package.json"), "utf8")));
    const definitions = new FileAgentRegistry().load(join(this.sourceDir, "agents"));
    const models = JSON.parse(readFileSync(join(this.sourceDir, "adapters/claude/model-tiers.json"), "utf8"));
    const emitter = new MarkdownClaudeAgentEmitter({ models });
    const agents = definitions.map((agent) => ({ name: agent.frontmatter.name, markdown: emitter.emit(agent) }));
    for (const executable of ["flight-rules", "flight-rules.mjs"]) {
      if (!existsSync(join(this.sourceDir, "bin", executable))) {
        throw new InvalidPluginSourceError(`Build the CLI before native assembly: missing bin/${executable}`);
      }
    }

    const directory = join(this.sourceDir, "dist", "claude");
    if (existsSync(join(this.sourceDir, "dist")) && lstatSync(join(this.sourceDir, "dist")).isSymbolicLink()) {
      throw new InvalidPluginSourceError("Native output cannot use a symlinked dist directory");
    }
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    for (const resource of ["skills", "docs", "hooks", "bin"]) this.copyDirectory(join(this.sourceDir, resource), join(directory, resource));
    mkdirSync(join(directory, "agents"));
    for (const agent of agents) writeFileSync(join(directory, "agents", `${agent.name}.md`), agent.markdown);
    mkdirSync(join(directory, "adapters", "claude"), { recursive: true });
    copyFileSync(join(this.sourceDir, "adapters/claude/model-tiers.json"), join(directory, "adapters/claude/model-tiers.json"));
    for (const executable of ["flight-rules", "flight-rules.mjs"]) chmodSync(join(directory, "bin", executable), 0o755);
    mkdirSync(join(directory, ".claude-plugin"));
    writeFileSync(join(directory, ".claude-plugin", "plugin.json"), JSON.stringify({
      ...identity, version, skills: "./skills/", agents: agents.map((agent) => `./agents/${agent.name}.md`),
    }, null, 2) + "\n");

    return { directory, agents: agents.map((agent) => agent.name), diagnostics: [] };
  }

  private validateSource(path: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new InvalidPluginSourceError(`Native resources must be regular files/directories: ${path}`);
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) this.validateSource(join(path, entry));
    }
  }

  private copyDirectory(source: string, destination: string): void {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(destination, entry.name);
      if (entry.isDirectory()) this.copyDirectory(from, to);
      else copyFileSync(from, to);
    }
  }
}
