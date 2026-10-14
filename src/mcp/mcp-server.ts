import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DocCharterCatalog } from "../bundled-docs/charter-catalog/charter-catalog.js";
import { GitRepositoryPaths } from "../bundled-docs/charter-catalog/repository-paths.js";
import { DocOperation } from "../operations/doc-operation.js";
import { DefaultLocalDiscoveryOperations } from "../operations/local-discovery-operations.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
  type OperationDescriptor,
  type OperationRegistry,
} from "../operations/operation-registry.js";
import { ReviewOperationsLaunchPropsSchema } from "../operations/review-operations.js";
import { DefaultTrackerReadOperations } from "../operations/tracker-read-operations.js";
import { DefaultPrOperations } from "../operations/pr-operations.js";
import { DefaultFlightRules } from "../flight-rules/flight-rules.js";
import { configScopes } from "../shared/config-store.js";
import {
  FileInstructionCatalog,
  type InstructionCatalog,
} from "../sdk/instruction-catalog-core.js";
import {
  QaInstructionsFinder,
  type QaFileSystem,
} from "../tasks/qa-instructions/qa-instructions.js";

const McpLaunchPropsSchema = z.strictObject({
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string().optional()),
  allowedOperationIds: z.array(z.string()).default([]),
  allowedEffects: z
    .array(z.enum(["read", "write", "network", "process"]))
    .default(["read", "process", "network"]),
  allowedConfigScopes: z.array(z.enum(configScopes)).default([]),
  ...ReviewOperationsLaunchPropsSchema.pick({
    trustedRef: true,
    owners: true,
    requireMapping: true,
  }).shape,
});

export type McpLaunchProps = z.input<typeof McpLaunchPropsSchema>;

const resourceId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const LaunchBoundQaFileSystemPropsSchema = z.object({ root: z.string().min(1) });

export class LaunchCheckoutChangedError extends Error {
  override name = "LaunchCheckoutChangedError";
}

export class UnsafeQaInstructionsPathError extends Error {
  override name = "UnsafeQaInstructionsPathError";
}

/** Restricts QA instruction reads to files whose resolved path stays in the launch checkout. */
export class LaunchBoundQaFileSystem implements QaFileSystem {
  private readonly root: string;

  constructor(props: z.input<typeof LaunchBoundQaFileSystemPropsSchema>) {
    const parsed = LaunchBoundQaFileSystemPropsSchema.parse(props);
    this.root = realpathSync(parsed.root);
  }

  exists(path: string): boolean {
    if (!this.isInsideLaunch(path)) return false;
    return existsSync(path);
  }

  isFile(path: string): boolean {
    this.requireInsideLaunch(path);
    return existsSync(path) && statSync(path).isFile();
  }

  readFile(path: string): string {
    this.requireInsideLaunch(path);
    return readFileSync(path, "utf8");
  }

  private isInsideLaunch(path: string): boolean {
    const absolute = resolve(path);
    let existing = absolute;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }

    const realPath = realpathSync(existing);
    const relativePath = relative(this.root, realPath);
    return (
      relativePath === "" ||
      (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
    );
  }

  private requireInsideLaunch(path: string): void {
    if (!this.isInsideLaunch(path)) {
      throw new UnsafeQaInstructionsPathError(
        `QA instructions path escapes the launch checkout: ${path}`,
      );
    }
  }
}

export interface McpProtocolServerFactory {
  createProtocolServer(): McpServer;
}

/** Serves shared operations using the original launch directory across protocol negotiations. */
export class FlightRulesMcpServer implements McpProtocolServerFactory {
  private readonly props: z.infer<typeof McpLaunchPropsSchema>;
  private readonly cwd: string;
  private readonly launchDevice: number;
  private readonly launchInode: number;
  private readonly qaFileSystem: QaFileSystem;
  private registry: OperationRegistry | undefined;
  private operationDescriptors: OperationDescriptor[] | undefined;
  private instructions: InstructionCatalog | undefined;

  constructor(props: McpLaunchProps) {
    this.props = McpLaunchPropsSchema.parse(props);
    this.cwd = realpathSync(this.props.cwd);
    const directory = statSync(this.cwd);
    this.launchDevice = directory.dev;
    this.launchInode = directory.ino;
    this.qaFileSystem = new LaunchBoundQaFileSystem({ root: this.cwd });
  }

  createProtocolServer(): McpServer {
    this.initializeLaunchServices();
    const registry = this.registry;
    const operationDescriptors = this.operationDescriptors;
    const instructions = this.instructions;
    if (registry === undefined || operationDescriptors === undefined || instructions === undefined)
      throw new Error("MCP launch services were not initialized");
    const server = new McpServer({ name: "flight-rules", version: "1.0.0" });

    for (const operation of registry.list()) {
      const descriptor = this.findOperation(operation.id);
      if (!(descriptor.inputSchema instanceof z.ZodObject)) {
        throw new Error(`MCP operation input must be an object schema: ${operation.id}`);
      }
      server.registerTool(
        operation.id,
        {
          description: operation.description,
          inputSchema: descriptor.inputSchema,
          annotations: {
            readOnlyHint: !operation.effects.includes("write"),
            destructiveHint: operation.effects.includes("write"),
            openWorldHint: operation.effects.includes("network"),
          },
        },
        async (input) => {
          try {
            this.requireOriginalLaunchCheckout();
            this.validateLocalPaths(operation.id, input);
            const envelope = await registry.invoke(operation.id, input);
            const result = {
              status: envelope.status,
              ...("data" in envelope ? { data: envelope.data } : {}),
              ...(envelope.status !== "success" ? { error: envelope.error } : {}),
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              structuredContent: result,
              ...(envelope.status === "error" ? { isError: true } : {}),
            };
          } catch (error) {
            const result = {
              status: "error",
              error: {
                name: error instanceof Error ? error.name : "Error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              structuredContent: result,
              isError: true,
            };
          }
        },
      );
    }

    for (const skill of instructions.listSkills()) {
      const instruction = instructions.loadSkill(resourceId.parse(skill));
      const uri = `flight-rules://skills/${instruction.name}`;
      server.registerResource(
        `skill-${instruction.name}`,
        uri,
        {
          title: instruction.name,
          description: `Canonical instructions for the ${instruction.name} skill. Reading this resource does not execute the skill.`,
          mimeType: "text/markdown",
        },
        async (requestedUri) => ({
          contents: [
            { uri: requestedUri.href, mimeType: "text/markdown", text: instruction.contents },
          ],
        }),
      );
    }

    for (const name of instructions.listAgents()) {
      const agent = instructions.loadAgent(resourceId.parse(name));
      const uri = `flight-rules://agents/${agent.frontmatter.name}`;
      server.registerResource(
        `agent-${agent.frontmatter.name}`,
        uri,
        {
          title: agent.frontmatter.name,
          description: `Canonical named-agent instructions for ${agent.frontmatter.name}. Reading this resource does not dispatch the agent.`,
          mimeType: "text/markdown",
        },
        async (requestedUri) => ({
          contents: [{ uri: requestedUri.href, mimeType: "text/markdown", text: agent.body }],
        }),
      );
    }

    return server;
  }

  private initializeLaunchServices(): void {
    if (this.registry !== undefined) return;

    const cwd = this.cwd;
    const core = new DefaultFlightRules({
      cwd,
      env: this.props.env,
      configWritePolicy: { scopes: this.props.allowedConfigScopes, roots: [cwd] },
    });
    const operationDescriptors = this.operations(core, cwd);
    const registry = new MapOperationRegistry({
      operations: operationDescriptors,
      policy: new LaunchOperationAccessPolicy({
        allowedOperationIds: this.props.allowedOperationIds,
        allowedEffects: this.props.allowedEffects,
      }),
    });
    const instructions = new FileInstructionCatalog({
      moduleUrl: import.meta.url,
      env: this.props.env,
    });

    this.operationDescriptors = operationDescriptors;
    this.registry = registry;
    this.instructions = instructions;
  }

  private operations(core: DefaultFlightRules, cwd: string): OperationDescriptor[] {
    const doc = new DocOperation({ getResolver: () => core.docs() });
    const local = new DefaultLocalDiscoveryOperations({
      cwd,
      getConfig: () => core.config(),
      getConfigStore: () => core.configStore(),
      getCharters: () => new DocCharterCatalog({ docs: core.docs() }),
      getRepositoryPaths: () => new GitRepositoryPaths({ cwd }),
      getEvidence: () => core.evidence(),
      getReadiness: () => core.readiness(),
      getProbe: () => core.probe(),
      getTracker: () => core.tracker(),
      getConfigPath: () => core.configPath(),
      getQaFinder: () => new QaInstructionsFinder({ fs: this.qaFileSystem }),
    });
    return [
      doc,
      ...local.operations(),
      ...new DefaultTrackerReadOperations({
        getTracker: () => core.tracker(),
        getPrHost: () => core.prHost(),
        getConfig: () => core.config(),
      }).operations(),
      ...new DefaultPrOperations({ cwd, getHost: () => core.prHost() }).operations(),
      ...core
        .gitConfigOperations({ scopes: this.props.allowedConfigScopes, roots: [cwd] })
        .operations(),
      ...core
        .reviewOperations({
          cwd,
          trustedRef: this.props.trustedRef,
          owners: this.props.owners,
          requireMapping: this.props.requireMapping,
        })
        .operations(),
    ];
  }

  private findOperation(id: string): OperationDescriptor {
    const descriptor = this.operationDescriptors?.find((operation) => operation.id === id);
    if (descriptor === undefined) throw new Error(`Operation descriptor disappeared: ${id}`);
    return descriptor;
  }

  /** Pathnames can be reused after a rename; the launch grant belongs to the original directory. */
  private requireOriginalLaunchCheckout(): void {
    const directory = existsSync(this.cwd) ? statSync(this.cwd) : undefined;
    if (
      directory === undefined ||
      realpathSync(this.cwd) !== this.cwd ||
      directory.dev !== this.launchDevice ||
      directory.ino !== this.launchInode
    ) {
      throw new LaunchCheckoutChangedError(
        `The launch checkout was moved or replaced: ${this.cwd}`,
      );
    }
  }

  private validateLocalPaths(id: string, input: unknown): void {
    if (id !== "qa-instructions") return;
    const parsedInput = z.object({ from: z.string().optional() }).safeParse(input);
    if (!parsedInput.success) return;
    const from = parsedInput.data.from;
    if (typeof from !== "string") return;

    const candidate = isAbsolute(from) ? from : resolve(this.cwd, from);
    if (!existsSync(candidate)) throw new Error(`QA instructions path does not exist: ${from}`);
    const realPath = realpathSync(candidate);
    const relativePath = relative(this.cwd, realPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new UnsafeQaInstructionsPathError(
        `QA instructions path escapes the launch checkout: ${from}`,
      );
    }
  }
}

export { McpLaunchPropsSchema };
