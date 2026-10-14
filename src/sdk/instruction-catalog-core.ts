import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  FileAgentRegistry,
  type AgentDefinition,
} from "../agents/agent-registry/agent-registry.js";

const CatalogPropsSchema = z.strictObject({
  moduleUrl: z.string().min(1),
  env: z.record(z.string(), z.string().optional()),
});
const ResourceNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export interface CanonicalInstruction {
  name: string;
  path: string;
  contents: string;
}
export interface InstructionCatalog {
  listSkills(): string[];
  loadSkill(name: string): CanonicalInstruction;
  listAgents(): string[];
  loadAgent(name: string): AgentDefinition;
}

export class UnknownInstructionError extends Error {
  override name = "UnknownInstructionError";
}
export class InstructionsUnavailableError extends Error {
  override name = "InstructionsUnavailableError";
}
export class UnsafeInstructionPathError extends Error {
  override name = "UnsafeInstructionPathError";
}

/** Loads canonical worker prompts and skills from the installed package, independent of cwd. */
export class FileInstructionCatalog implements InstructionCatalog {
  private readonly skillDir: string;
  private readonly agentDir: string;
  private readonly agents: Map<string, AgentDefinition>;

  constructor(props: z.input<typeof CatalogPropsSchema>) {
    const parsed = CatalogPropsSchema.parse({ ...props, env: { ...props.env } });
    const override = parsed.env["FLIGHT_RULES_HOME"]?.trim();
    const moduleDirectory = dirname(fileURLToPath(parsed.moduleUrl));
    const home =
      override || resolve(moduleDirectory, basename(moduleDirectory) === "sdk" ? "../.." : "..");
    this.skillDir = this.findResourceDirectory(home, ["skills"]);
    this.agentDir = this.findResourceDirectory(home, [
      "bin/resources/agents",
      "agents",
      "resources/agents",
    ]);
    this.safePath(join(this.agentDir, "variants.json"), this.agentDir);
    this.agents = new Map(
      new FileAgentRegistry().load(this.agentDir).map((agent) => [agent.frontmatter.name, agent]),
    );
  }

  listSkills(): string[] {
    return readdirSync(this.skillDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === "SKILL.md")
      .map((entry) => relative(this.skillDir, join(entry.parentPath, entry.name)).split(sep)[0])
      .filter((name): name is string => name !== undefined)
      .sort();
  }

  loadSkill(name: string): CanonicalInstruction {
    const parsed = ResourceNameSchema.safeParse(name);
    if (!parsed.success) throw new UnsafeInstructionPathError(`Invalid skill name: ${name}`);
    const path = join(this.skillDir, parsed.data, "SKILL.md");
    return {
      name: parsed.data,
      path: this.safePath(path, this.skillDir),
      contents: readFileSync(this.safePath(path, this.skillDir), "utf8"),
    };
  }

  listAgents(): string[] {
    return [...this.agents.keys()].sort();
  }

  loadAgent(name: string): AgentDefinition {
    const parsed = ResourceNameSchema.safeParse(name);
    if (!parsed.success) throw new UnsafeInstructionPathError(`Invalid agent name: ${name}`);
    const agent = this.agents.get(parsed.data);
    if (agent === undefined) throw new UnknownInstructionError(`Unknown agent "${name}"`);
    return agent;
  }

  private findResourceDirectory(home: string, candidates: string[]): string {
    if (!existsSync(home) || !statSync(home).isDirectory()) {
      throw new InstructionsUnavailableError(
        `The flight-rules installation directory is unavailable: ${home}`,
      );
    }
    const installationRoot = realpathSync(home);

    for (const candidate of candidates) {
      const path = resolve(installationRoot, candidate);
      if (!existsSync(path) || !statSync(path).isDirectory()) continue;

      const realPath = realpathSync(path);
      const relativePath = relative(installationRoot, realPath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      ) {
        throw new UnsafeInstructionPathError(
          `Instruction directory escapes its installation home: ${path}`,
        );
      }
      return realPath;
    }
    throw new InstructionsUnavailableError(`Canonical resources are unavailable under ${home}`);
  }

  private safePath(path: string, root: string): string {
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isFile())
      throw new UnknownInstructionError(`Unknown instruction resource: ${path}`);
    const realPath = realpathSync(path);
    const relativePath = relative(root, realPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new UnsafeInstructionPathError(
        `Instruction resource escapes its installation directory: ${path}`,
      );
    }
    return realPath;
  }
}
