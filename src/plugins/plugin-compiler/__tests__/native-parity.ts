import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";
import { FileAgentRegistry } from "../../../agents/agent-registry/agent-registry.js";
import { InstallationManifestSchema } from "../../native-installation/native-installation.js";
import type { PluginHost } from "../plugin-compiler.js";

/** Test oracle reads canonical bytes/registrations, never an earlier generated target. */
export const nativeParityFailures = (sourceDir: string, host: PluginHost): string[] => {
  const failures: string[] = [];
  const target = join(sourceDir, "dist", host);
  const canonicalResources = join(sourceDir, "agents");
  const installedResources = join(target, "bin", "resources", "agents");
  for (const resource of [
    ...readdirSync(canonicalResources).filter((name) => name.endsWith(".md")),
    "variants.json",
  ]) {
    const sourcePath = join(canonicalResources, resource);
    const installedPath = join(installedResources, resource);
    if (
      !existsSync(installedPath) ||
      !readFileSync(installedPath).equals(readFileSync(sourcePath))
    ) {
      failures.push(
        `${relative(sourceDir, installedPath)}: preserve canonical agent resource bytes for ${host}`,
      );
    }
  }
  const definitions = new FileAgentRegistry().load(join(sourceDir, "agents"));
  const names = definitions.map((agent) => agent.frontmatter.name);
  const installation = InstallationManifestSchema.parse(
    JSON.parse(readFileSync(join(target, "flight-rules-install.json"), "utf8")),
  );
  if (
    JSON.stringify(installation.agents.map((agent) => agent.registration)) !==
    JSON.stringify(definitions.map((agent) => agent.frontmatter))
  ) {
    failures.push(
      `dist/${host}/flight-rules-install.json: regenerate all resolved neutral registrations from the canonical registry`,
    );
  }
  if (host === "claude") {
    const manifest = JSON.parse(readFileSync(join(target, ".claude-plugin/plugin.json"), "utf8"));
    if (
      JSON.stringify(manifest.agents) !== JSON.stringify(names.map((name) => `./agents/${name}.md`))
    ) {
      failures.push(
        "dist/claude/.claude-plugin/plugin.json: register every resolved canonical agent and named variant",
      );
    }
  }
  for (const definition of definitions) {
    const { name } = definition.frontmatter;
    const path = join(
      target,
      host === "claude" ? `agents/${name}.md` : `.codex/agents/${name}.toml`,
    );
    if (!existsSync(path)) {
      failures.push(
        `${relative(sourceDir, path)}: missing ${name}; emit every registry entry for ${host}`,
      );
      continue;
    }
    const contents = readFileSync(path, "utf8");
    const header = /^---\n([\s\S]*?)^---\n/m.exec(contents);
    const native = host === "claude" ? parseYaml(header?.[1] ?? "") : parseToml(contents);
    const body =
      host === "claude" ? contents.slice(header?.[0].length) : native.developer_instructions;
    if (native?.name !== name || body !== definition.body) {
      failures.push(
        `${relative(sourceDir, path)}: native name/prompt drift; preserve the resolved canonical name and prompt bytes`,
      );
    }
  }
  const skillsDir = join(sourceDir, "skills");
  for (const entry of readdirSync(skillsDir, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile(),
  )) {
    const source = join(entry.parentPath, entry.name);
    const path = join(target, "skills", relative(skillsDir, source));
    if (!existsSync(path) || !readFileSync(path).equals(readFileSync(source))) {
      failures.push(
        `${relative(sourceDir, path)}: skill drift; copy canonical ${relative(sourceDir, source)} bytes unchanged`,
      );
    }
  }
  return failures;
};
