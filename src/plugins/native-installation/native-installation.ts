import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AgentRegistrationSchema } from "../../agents/agent-frontmatter/agent-frontmatter.schema.js";

export const NativeHostSchema = z.enum(["claude", "codex"]);
export type NativeHost = z.infer<typeof NativeHostSchema>;
export const AgentInstallScopeSchema = z.enum(["project", "user"]);
export type AgentInstallScope = z.infer<typeof AgentInstallScopeSchema>;
export const InstallationManifestSchema = z.strictObject({
  host: NativeHostSchema,
  agents: z.array(z.strictObject({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    registration: AgentRegistrationSchema,
  })).min(1),
}).refine((value) => new Set(value.agents.map((agent) => agent.name)).size === value.agents.length, "Duplicate agent names")
  .refine((value) => value.agents.every((agent) => agent.name === agent.registration.name), "Registration name mismatch");
const PropsSchema = z.object({
  root: z.string().min(1),
  cwd: z.string().min(1),
  home: z.string().min(1).default(homedir),
  env: z.record(z.string(), z.string().optional()).default({}),
});

export interface AgentInstallationReport {
  host: "codex";
  scope: AgentInstallScope;
  directory: string;
  agents: { name: string; path: string; status: "present" | "missing" | "conflict" }[];
  ok: boolean;
  evidence: "files-only";
  remedy: string;
}

export interface NativeInstallation {
  host(): NativeHost | undefined;
  status(scope: AgentInstallScope): AgentInstallationReport;
  install(scope: AgentInstallScope): AgentInstallationReport;
}

export class NativeInstallationError extends Error {
  override name = "NativeInstallationError";
}

/** Registers Codex's separately discovered native agents without replacing existing definitions or changing host permissions. */
export class FileNativeInstallation implements NativeInstallation {
  private readonly props: z.infer<typeof PropsSchema>;

  constructor(props: z.input<typeof PropsSchema>) {
    this.props = PropsSchema.parse({ ...props, env: props.env === undefined ? undefined : { ...props.env } });
  }


  host(): NativeHost | undefined {
    const path = join(this.props.root, "flight-rules-install.json");
    return existsSync(path) ? this.manifest(this.props.root).host : undefined;
  }

  status(scope: AgentInstallScope): AgentInstallationReport {
    const selected = AgentInstallScopeSchema.parse(scope);
    const root = this.codexRoot();
    const manifest = this.manifest(root);
    const directory = selected === "project"
      ? resolve(this.props.cwd, ".codex", "agents")
      : resolve(this.props.env["CODEX_HOME"] || join(this.props.home, ".codex"), "agents");
    this.assertRegularPath(directory);
    const agents: AgentInstallationReport["agents"] = manifest.agents.map((agent) => {
      const source = join(root, ".codex", "agents", `${agent.name}.toml`);
      this.assertRegularPath(source);
      if (!existsSync(source) || !lstatSync(source).isFile() || this.hash(readFileSync(source)) !== agent.sha256) {
        throw new NativeInstallationError(`Bundled registration is missing or changed: ${source}. Rebuild or reinstall the Codex plugin.`);
      }
      const path = join(directory, `${agent.name}.toml`);
      this.assertRegularPath(path);
      const status = !existsSync(path) ? "missing" : lstatSync(path).isFile() && this.hash(readFileSync(path)) === agent.sha256 ? "present" : "conflict";
      return { name: agent.name, path, status };
    });
    return {
      host: "codex", scope: selected, directory, agents,
      ok: agents.every((agent) => agent.status === "present"), evidence: "files-only",
      remedy: "Install missing registrations with agents install. For conflicts, compare and back up the existing file before explicitly removing it and reinstalling. Start a new trusted Codex session and confirm native discovery; file presence does not prove dispatch access.",
    };
  }

  install(scope: AgentInstallScope): AgentInstallationReport {
    const report = this.status(scope);
    const conflicts = report.agents.filter((agent) => agent.status === "conflict");
    if (conflicts.length > 0) {
      throw new NativeInstallationError(`Existing agent definitions differ: ${conflicts.map((agent) => agent.path).join(", ")}. ${report.remedy}`);
    }
    const root = this.codexRoot();
    for (const agent of report.agents.filter((agent) => agent.status === "missing")) {
      this.assertRegularPath(report.directory);
      mkdirSync(report.directory, { recursive: true });
      // Exclusive creation also refuses a file/symlink introduced after preflight.
      writeFileSync(agent.path, readFileSync(join(root, ".codex", "agents", `${agent.name}.toml`)), { flag: "wx" });
    }
    return this.status(scope);
  }

  private codexRoot(): string {
    const root = resolve(this.props.root);
    if (this.host() === "codex") return root;
    const target = join(root, "dist", "codex");
    if (existsSync(join(target, "flight-rules-install.json")) && this.manifest(target).host === "codex") return target;
    throw new NativeInstallationError("Codex registrations are unavailable in this installation. Run agents install from the Codex plugin or the complete npm package. Claude discovers agents through its native plugin installation.");
  }

  private manifest(root: string): z.infer<typeof InstallationManifestSchema> {
    try {
      return InstallationManifestSchema.parse(JSON.parse(readFileSync(join(root, "flight-rules-install.json"), "utf8")));
    } catch (cause) {
      throw new NativeInstallationError(`Invalid installation manifest at ${root}; rebuild or reinstall flight-rules`, { cause });
    }
  }

  private hash(contents: Buffer): string {
    return createHash("sha256").update(contents).digest("hex");
  }

  private assertRegularPath(path: string): void {
    // Resolve platform aliases (e.g. macOS /var) at the root supplied by the caller,
    // but never follow a link inside the destination's .codex/agents hierarchy.
    let current = resolve(path);
    const anchors = [this.props.cwd, this.props.home, this.props.env["CODEX_HOME"], this.props.root]
      .filter((anchor): anchor is string => anchor !== undefined).map((anchor) => resolve(anchor));
    while (!anchors.includes(current) && dirname(current) !== current) {
      try {
        if (lstatSync(current).isSymbolicLink()) throw new NativeInstallationError(`Refusing symlinked installation path: ${current}`);
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
      }
      current = dirname(current);
    }
    if (existsSync(current)) realpathSync(current);
  }
  static fromInstall(props: { moduleUrl: string; cwd: string; env: NodeJS.ProcessEnv }): FileNativeInstallation {
    return new FileNativeInstallation({
      root: props.env["FLIGHT_RULES_HOME"]?.trim() || join(dirname(fileURLToPath(props.moduleUrl)), ".."),
      cwd: props.cwd,
      env: props.env,
    });
  }

}
