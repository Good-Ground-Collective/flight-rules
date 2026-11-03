import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  createSdkMcpServer,
  tool,
  type HookInput,
  type HookJSONOutput,
  type McpSdkServerConfigWithInstance,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type { RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import { skillToolNames, type ShellOperationRedirects } from "../skill-runtime-core.js";
import { claudeBuiltInTools } from "../claude-builtin-tools.js";
import {
  CapabilityToolDeniedError,
  WorkerCapabilitySchema,
  WorkerDispatchConfigurationError,
  type WorkerCapability,
} from "../worker-runtime-core.js";

export { CapabilityToolDeniedError, WorkerCapabilitySchema };
export type { WorkerCapability };

export const flightRulesHostServerName = "flight-rules-host";

const hostToolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const disallowedBuiltInTools = ["Agent", "AskUserQuestion", "Skill", "ToolSearch"] as const;
const unmappedBuiltInCapabilities = new Map<string, WorkerCapability>([
  ["Agent", "spawn"],
  ["Task", "spawn"],
  ["AskUserQuestion", "ask"],
]);
const pathInputKeys = ["file_path", "path", "notebook_path"] as const;
const globInputKeys = new Map<string, string>([
  ["Glob", "pattern"],
  ["Grep", "glob"],
]);
const globMagic = /[*?[{]/;

export type HostToolResult = string | object;
export interface HostToolContext {
  signal: AbortSignal;
}
export type HostToolHandler = (
  args: Record<string, unknown>,
  context: HostToolContext,
) => Promise<HostToolResult>;

const HostToolSchema = z.object({
  name: z.string().regex(hostToolNamePattern),
  description: z.string().min(1),
  inputSchema: z.record(
    z.string(),
    z.custom<z.ZodType>((value) => value instanceof z.core.$ZodType),
  ),
  annotations: z
    .strictObject({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    })
    .optional(),
  handler: z.custom<HostToolHandler>((value) => typeof value === "function"),
});

/** A host-enforced capability a worker may call, described once and served to the Claude Agent SDK in process. */
export type WorkerHostTool = z.output<typeof HostToolSchema>;
export type WorkerToolGrants = Partial<Record<WorkerCapability, readonly WorkerHostTool[]>>;

export const WorkerToolGrantsSchema = z.partialRecord(
  WorkerCapabilitySchema,
  z.array(HostToolSchema),
);

export class InvalidClaudeHostToolError extends WorkerDispatchConfigurationError {
  override name = "InvalidClaudeHostToolError";
}

/** A built-in file tool reached for a path outside the repository the worker was dispatched into. */
export class RepositoryPathDeniedError extends CapabilityToolDeniedError {
  override name = "RepositoryPathDeniedError";

  constructor(props: {
    toolName: string;
    capability: WorkerCapability | undefined;
    path: string;
    repositoryRoot: string;
  }) {
    super(
      props.capability === undefined
        ? { toolName: props.toolName }
        : { toolName: props.toolName, capability: props.capability },
    );
    this.message = `The worker attempted ${props.toolName} on ${props.path}, outside the repository root ${props.repositoryRoot}.`;
  }
}

/** Tracks every host tool promise of one run so its capacity reservation outlives the model loop. */
export class HostToolExecutionTracker {
  private readonly pending = new Set<Promise<unknown>>();
  private firstFailure: { cause: unknown } | undefined;

  track<T>(execution: () => Promise<T>): Promise<T> {
    const promise = execution();
    this.pending.add(promise);
    const forget = () => {
      this.pending.delete(promise);
    };
    promise.then(forget, forget);
    return promise;
  }

  recordFailure(cause: unknown): void {
    this.firstFailure ??= { cause };
  }

  failure(): { cause: unknown } | undefined {
    return this.firstFailure;
  }

  async waitForIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

const ClaudeToolGuardPropsSchema = z.strictObject({
  allowedTools: z.array(z.string().min(1)),
  capabilities: z.custom<ReadonlyMap<string, WorkerCapability>>((value) => value instanceof Map),
  cwd: z.string().min(1),
  repositoryRoot: z.string().min(1),
  shellRedirects: z
    .custom<ShellOperationRedirects>((value) => typeof value === "object")
    .optional(),
  onDenied: z.custom<(error: CapabilityToolDeniedError) => void>(
    (value) => typeof value === "function",
  ),
});

export type ClaudeToolGuardProps = z.input<typeof ClaudeToolGuardPropsSchema>;

export interface ClaudeToolGuardContract {
  preToolUse(input: HookInput): Promise<HookJSONOutput>;
  canUseTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult>;
}

/** Denies any tool outside one run's allowlist and any built-in file access outside its repository, and reports the denial so the run stops. */
export class RepositoryConfinedToolGuard implements ClaudeToolGuardContract {
  private readonly allowedTools: ReadonlySet<string>;
  private readonly capabilities: ReadonlyMap<string, WorkerCapability>;
  private readonly cwd: string;
  private readonly repositoryRoot: string;
  private readonly realRepositoryRoot: string;
  private readonly shellRedirects: ShellOperationRedirects | undefined;
  private readonly onDenied: (error: CapabilityToolDeniedError) => void;

  constructor(props: ClaudeToolGuardProps) {
    const parsed = ClaudeToolGuardPropsSchema.parse(props);
    this.allowedTools = new Set(parsed.allowedTools);
    this.capabilities = parsed.capabilities;
    this.cwd = parsed.cwd;
    this.repositoryRoot = parsed.repositoryRoot;
    this.realRepositoryRoot = this.realPath(resolve(parsed.repositoryRoot));
    this.shellRedirects = parsed.shellRedirects;
    this.onDenied = parsed.onDenied;
  }

  async preToolUse(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name !== "PreToolUse") return {};

    const record = this.inputRecord(input.tool_input);
    const denial = this.evaluate(input.tool_name, record);
    if (denial === undefined) {
      const redirect = this.shellRedirect(input.tool_name, record);
      if (redirect === undefined) return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: redirect,
        },
      };
    }

    this.onDenied(denial);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denial.message,
      },
    };
  }

  async canUseTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    const denial = this.evaluate(toolName, input);
    if (denial === undefined) {
      const redirect = this.shellRedirect(toolName, input);
      return redirect === undefined
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: redirect };
    }

    this.onDenied(denial);
    return { behavior: "deny", message: denial.message, interrupt: true };
  }

  private shellRedirect(toolName: string, input: Record<string, unknown>): string | undefined {
    const command = input.command;
    if (toolName !== "Bash" || typeof command !== "string") return undefined;
    const redirect = this.shellRedirects?.redirectFor(command);
    if (redirect === undefined) return undefined;
    return `Use ${skillToolNames.operation} with operationId "${redirect.operationId}" instead of running "flight-rules ${redirect.route}" in the shell.`;
  }

  private evaluate(
    toolName: string,
    input: Record<string, unknown>,
  ): CapabilityToolDeniedError | undefined {
    const capability = this.capabilities.get(toolName);
    if (!this.allowedTools.has(toolName)) {
      return new CapabilityToolDeniedError(
        capability === undefined ? { toolName } : { toolName, capability },
      );
    }
    if (toolName.startsWith("mcp__")) return undefined;

    const escaped = this.escapingPath(toolName, input);
    if (escaped === undefined) return undefined;
    return new RepositoryPathDeniedError({
      toolName,
      capability,
      path: escaped,
      repositoryRoot: this.repositoryRoot,
    });
  }

  private inputRecord(value: unknown): Record<string, unknown> {
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    return parsed.success ? parsed.data : {};
  }

  private escapingPath(toolName: string, input: Record<string, unknown>): string | undefined {
    for (const key of pathInputKeys) {
      const value = input[key];
      if (typeof value === "string" && this.isOutside(value)) return value;
    }

    const globKey = globInputKeys.get(toolName);
    const glob = globKey === undefined ? undefined : input[globKey];
    if (typeof glob === "string" && this.globEscapes(glob)) return glob;
    return undefined;
  }

  private globEscapes(pattern: string): boolean {
    if (pattern.split(/[\\/]/).includes("..")) return true;
    const magic = pattern.search(globMagic);
    const literalPrefix = magic === -1 ? pattern : pattern.slice(0, magic);
    return isAbsolute(literalPrefix) && this.isOutside(literalPrefix);
  }

  private isOutside(path: string): boolean {
    if (path.startsWith("~")) return true;

    const location = relative(this.realRepositoryRoot, this.realPath(resolve(this.cwd, path)));
    return location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location);
  }

  private realPath(path: string): string {
    let existing = path;
    const missing: string[] = [];
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break;
      missing.unshift(basename(existing));
      existing = parent;
    }
    return join(existsSync(existing) ? realpathSync(existing) : existing, ...missing);
  }
}

export interface HostToolServerRun {
  signal: AbortSignal;
  tracker: HostToolExecutionTracker;
}

export interface ClaudeToolPolicyContract {
  validateGrants(grants: WorkerToolGrants): void;
  builtInToolsFor(definition: AgentDefinition, runtime: RuntimeSnapshot): string[];
  hostToolsFor(
    definition: AgentDefinition,
    grants: WorkerToolGrants,
    runtime: RuntimeSnapshot,
  ): WorkerHostTool[];
  allowlistFor(builtInTools: readonly string[], hostTools: readonly WorkerHostTool[]): string[];
  disallowedTools(): string[];
  guardFor(props: Omit<ClaudeToolGuardProps, "capabilities">): ClaudeToolGuardContract;
  serverFor(
    hostTools: readonly WorkerHostTool[],
    run: HostToolServerRun,
  ): McpSdkServerConfigWithInstance;
}

/** Derives one run's built-in tools, host tools and guard from registered capabilities and fresh host observation. */
export class CapabilityScopedClaudeToolPolicy implements ClaudeToolPolicyContract {
  private readonly capabilities: ReadonlyMap<string, WorkerCapability>;

  constructor() {
    const capabilities = new Map(unmappedBuiltInCapabilities);
    for (const capability of WorkerCapabilitySchema.options) {
      for (const name of claudeBuiltInTools.toolsFor(capability))
        capabilities.set(name, capability);
    }
    this.capabilities = capabilities;
  }

  validateGrants(grants: WorkerToolGrants): void {
    this.assertValid(Object.values(grants).flat());
  }

  builtInToolsFor(definition: AgentDefinition, runtime: RuntimeSnapshot): string[] {
    const names = new Set<string>();
    for (const capability of this.effectiveCapabilities(definition, runtime)) {
      for (const name of claudeBuiltInTools.toolsFor(capability)) names.add(name);
    }
    return [...names];
  }

  hostToolsFor(
    definition: AgentDefinition,
    grants: WorkerToolGrants,
    runtime: RuntimeSnapshot,
  ): WorkerHostTool[] {
    const tools = this.effectiveCapabilities(definition, runtime).flatMap((capability) => [
      ...(grants[capability] ?? []),
    ]);
    this.assertValid(tools);
    return tools;
  }

  allowlistFor(builtInTools: readonly string[], hostTools: readonly WorkerHostTool[]): string[] {
    return [
      ...builtInTools,
      ...hostTools.map((hostTool) => `mcp__${flightRulesHostServerName}__${hostTool.name}`),
    ];
  }

  disallowedTools(): string[] {
    return [...disallowedBuiltInTools];
  }

  guardFor(props: Omit<ClaudeToolGuardProps, "capabilities">): ClaudeToolGuardContract {
    return new RepositoryConfinedToolGuard({ ...props, capabilities: this.capabilities });
  }

  serverFor(
    hostTools: readonly WorkerHostTool[],
    run: HostToolServerRun,
  ): McpSdkServerConfigWithInstance {
    return createSdkMcpServer({
      name: flightRulesHostServerName,
      alwaysLoad: true,
      tools: hostTools.map((hostTool) =>
        tool(
          hostTool.name,
          hostTool.description,
          hostTool.inputSchema,
          (args) => run.tracker.track(() => this.invoke(hostTool, args, run)),
          hostTool.annotations === undefined
            ? { alwaysLoad: true }
            : { annotations: hostTool.annotations, alwaysLoad: true },
        ),
      ),
    });
  }

  private assertValid(tools: readonly WorkerHostTool[]): void {
    const names = new Set<string>();
    for (const hostTool of tools) {
      if (!hostToolNamePattern.test(hostTool.name)) {
        throw new InvalidClaudeHostToolError(
          `Host tool name ${hostTool.name} must use letters, digits, underscores or hyphens (1-64 characters).`,
        );
      }
      if (names.has(hostTool.name)) {
        throw new InvalidClaudeHostToolError(`Duplicate host tool name: ${hostTool.name}`);
      }
      names.add(hostTool.name);
    }
  }

  private effectiveCapabilities(
    definition: AgentDefinition,
    runtime: RuntimeSnapshot,
  ): WorkerCapability[] {
    const registered = new Set(definition.frontmatter.capabilities);
    return WorkerCapabilitySchema.options.filter(
      (capability) =>
        registered.has(capability) && runtime.permissions[capability]?.state === "available",
    );
  }

  private async invoke(
    hostTool: WorkerHostTool,
    args: Record<string, unknown>,
    run: HostToolServerRun,
  ) {
    try {
      const result = await hostTool.handler(args, { signal: run.signal });
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (cause) {
      run.tracker.recordFailure(cause);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: cause instanceof Error ? cause.message : String(cause),
          },
        ],
      };
    }
  }
}
