import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { MarkdownClaudeAgentEmitter } from "../../agents/agent-emitter/claude-agent-emitter.js";
import { TomlCodexAgentEmitter } from "../../agents/agent-emitter/codex-agent-emitter.js";
import { FileAgentRegistry } from "../../agents/agent-registry/agent-registry.js";

const NativePluginCompilerPropsSchema = z.strictObject({ sourceDir: z.string().min(1) });
const PluginHostSchema = z.enum(["claude", "codex"]);
export type PluginHost = z.infer<typeof PluginHostSchema>;
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
  compile(host?: PluginHost): CompiledPlugin;
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

  compile(host: PluginHost = "claude"): CompiledPlugin {
    const target = PluginHostSchema.parse(host);
    for (const resource of [
      "package.json",
      "adapters",
      "agents",
      "skills",
      "docs",
      "hooks",
      "bin",
    ]) {
      this.validateSource(join(this.sourceDir, resource));
    }
    const identity = PluginIdentitySchema.parse(
      JSON.parse(readFileSync(join(this.sourceDir, "adapters/plugin.json"), "utf8")),
    );
    const { version } = PackageVersionSchema.parse(
      JSON.parse(readFileSync(join(this.sourceDir, "package.json"), "utf8")),
    );
    const definitions = new FileAgentRegistry().load(join(this.sourceDir, "agents"));
    const models = JSON.parse(
      readFileSync(join(this.sourceDir, "adapters", target, "model-tiers.json"), "utf8"),
    );
    const codexEmitter =
      target === "codex"
        ? new TomlCodexAgentEmitter({
            models,
            reasoning: JSON.parse(
              readFileSync(join(this.sourceDir, "adapters/codex/reasoning-tiers.json"), "utf8"),
            ),
          })
        : undefined;
    const emitter = codexEmitter ?? new MarkdownClaudeAgentEmitter({ models });
    const agents = definitions.map((agent) => ({
      name: agent.frontmatter.name,
      contents: emitter.emit(agent),
      registration: agent.frontmatter,
    }));
    const diagnostics =
      codexEmitter === undefined
        ? []
        : [...new Set(definitions.flatMap((agent) => codexEmitter.diagnostics(agent)))];
    if (target === "codex")
      diagnostics.push(
        "Claude commit and Ariadne hooks are omitted; this target emits no Codex hooks.",
      );
    for (const executable of ["flight-rules", "flight-rules.mjs"]) {
      if (!existsSync(join(this.sourceDir, "bin", executable))) {
        throw new InvalidPluginSourceError(
          `Build the CLI before native assembly: missing bin/${executable}`,
        );
      }
    }

    const directory = join(this.sourceDir, "dist", target);
    if (
      existsSync(join(this.sourceDir, "dist")) &&
      lstatSync(join(this.sourceDir, "dist")).isSymbolicLink()
    ) {
      throw new InvalidPluginSourceError("Native output cannot use a symlinked dist directory");
    }
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    const resources =
      target === "claude" ? ["skills", "docs", "hooks", "bin"] : ["skills", "docs", "bin"];
    for (const resource of resources)
      this.copyDirectory(join(this.sourceDir, resource), join(directory, resource));
    this.copyDirectory(
      join(this.sourceDir, "agents"),
      join(directory, "bin", "resources", "agents"),
    );
    const agentDirectory =
      target === "claude" ? join(directory, "agents") : join(directory, ".codex", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    const extension = target === "claude" ? "md" : "toml";
    for (const agent of agents)
      writeFileSync(join(agentDirectory, `${agent.name}.${extension}`), agent.contents);
    writeFileSync(
      join(directory, "flight-rules-install.json"),
      JSON.stringify(
        {
          host: target,
          agents: agents.map((agent) => ({
            name: agent.name,
            sha256: createHash("sha256").update(agent.contents).digest("hex"),
            registration: agent.registration,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    mkdirSync(join(directory, "adapters", target), { recursive: true });
    copyFileSync(
      join(this.sourceDir, "adapters", target, "model-tiers.json"),
      join(directory, "adapters", target, "model-tiers.json"),
    );
    if (target === "codex")
      copyFileSync(
        join(this.sourceDir, "adapters/codex/reasoning-tiers.json"),
        join(directory, "adapters/codex/reasoning-tiers.json"),
      );
    for (const executable of ["flight-rules", "flight-rules.mjs"])
      chmodSync(join(directory, "bin", executable), 0o755);
    const manifestDirectory = join(
      directory,
      target === "claude" ? ".claude-plugin" : ".codex-plugin",
    );
    mkdirSync(manifestDirectory);
    const manifest =
      target === "claude"
        ? {
            ...identity,
            version,
            skills: "./skills/",
            agents: agents.map((agent) => `./agents/${agent.name}.md`),
          }
        : { ...identity, version, skills: "./skills/" };
    writeFileSync(join(manifestDirectory, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
    if (target === "codex") {
      writeFileSync(
        join(directory, "plugin.json"),
        JSON.stringify(
          {
            $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
            ...identity,
            version,
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(join(directory, ".codex", "config.toml"), "[agents]\nenabled = true\n");
      writeFileSync(
        join(directory, "diagnostics.json"),
        JSON.stringify(diagnostics, null, 2) + "\n",
      );
    }

    return { directory, agents: agents.map((agent) => agent.name), diagnostics };
  }

  private validateSource(path: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new InvalidPluginSourceError(
        `Native resources must be regular files/directories: ${path}`,
      );
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
