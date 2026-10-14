import { createFilesystemMiddleware, createSubAgentMiddleware, StateBackend } from "deepagents";
import { createMiddleware, type AnyAgentMiddleware, type StructuredTool } from "langchain";
import type { AgentDefinition } from "../../agents/agent-registry/agent-registry.js";
import type { RuntimeSnapshot } from "../../orchestration/orchestration.schema.js";
import { z } from "zod";

export const WorkerCapabilitySchema = z.enum(["read", "edit", "shell", "web", "spawn", "ask"]);
const CapabilityToolDeniedPropsSchema = z.strictObject({
  toolName: z.string().min(1),
  capability: WorkerCapabilitySchema.optional(),
});
export type WorkerCapability = z.infer<typeof WorkerCapabilitySchema>;
export type WorkerToolGrants = Partial<Record<WorkerCapability, readonly StructuredTool[]>>;
export const flightRulesAbortSignalConfigKey = "flightRulesAbortSignal";

const filesystemCapabilities = new Map<string, WorkerCapability>([
  ["ls", "read"],
  ["read_file", "read"],
  ["glob", "read"],
  ["grep", "read"],
  ["write_file", "edit"],
  ["edit_file", "edit"],
  ["delete", "edit"],
  ["execute", "shell"],
  ["task", "spawn"],
]);

export class CapabilityToolDeniedError extends Error {
  override name = "CapabilityToolDeniedError";
  readonly capability: WorkerCapability | undefined;

  constructor(props: z.input<typeof CapabilityToolDeniedPropsSchema>) {
    const parsed = CapabilityToolDeniedPropsSchema.parse(props);
    super(
      parsed.capability === undefined
        ? `The worker attempted unregistered tool ${parsed.toolName}.`
        : `The worker attempted ${parsed.toolName} without an effective ${parsed.capability} grant.`,
    );
    this.capability = parsed.capability;
  }
}

export class InvalidDeepAgentsToolRegistrationError extends Error {
  override name = "InvalidDeepAgentsToolRegistrationError";
}

export interface DeepAgentsToolPolicyContract {
  toolsFor(
    definition: AgentDefinition,
    grants: WorkerToolGrants,
    runtime: RuntimeSnapshot,
  ): StructuredTool[];
  middlewareFor(
    model: Parameters<typeof createSubAgentMiddleware>[0]["defaultModel"],
    definition: AgentDefinition,
    hostTools: readonly StructuredTool[],
    trackExecution: <T>(execution: () => Promise<T>) => Promise<T>,
    onCapabilityDenied: (error: CapabilityToolDeniedError) => void,
  ): readonly AnyAgentMiddleware[];
}

/** Builds an instance-local tool stack from observed grants and host-enforced tools. */
export class CapabilityScopedDeepAgentsToolPolicy implements DeepAgentsToolPolicyContract {
  toolsFor(
    definition: AgentDefinition,
    grants: WorkerToolGrants,
    runtime: RuntimeSnapshot,
  ): StructuredTool[] {
    const capabilities = new Set(definition.frontmatter.capabilities);
    const tools = [...WorkerCapabilitySchema.options].flatMap((capability) => {
      if (!capabilities.has(capability)) return [];
      if (runtime.permissions[capability]?.state !== "available") return [];
      return [...(grants[capability] ?? [])];
    });
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name))
        throw new InvalidDeepAgentsToolRegistrationError(`Duplicate host tool name: ${tool.name}`);
      if (filesystemCapabilities.has(tool.name)) {
        throw new InvalidDeepAgentsToolRegistrationError(
          `Host tools cannot replace reserved Deep Agents tool ${tool.name}.`,
        );
      }
      names.add(tool.name);
    }
    return tools;
  }

  middlewareFor(
    model: Parameters<typeof createSubAgentMiddleware>[0]["defaultModel"],
    definition: AgentDefinition,
    hostTools: readonly StructuredTool[],
    trackExecution: <T>(execution: () => Promise<T>) => Promise<T>,
    onCapabilityDenied: (error: CapabilityToolDeniedError) => void,
  ): readonly AnyAgentMiddleware[] {
    const permissions = new Set(definition.frontmatter.capabilities);
    const filesystemTools = [
      ...(permissions.has("read") ? (["read_file", "ls", "glob", "grep"] as const) : []),
      ...(permissions.has("read") && permissions.has("edit")
        ? (["write_file", "edit_file", "delete"] as const)
        : []),
    ];
    const filesystem = !permissions.has("read")
      ? createMiddleware({ name: "FilesystemMiddleware" })
      : createFilesystemMiddleware({ backend: new StateBackend(), tools: filesystemTools });
    const subagents = createSubAgentMiddleware({
      defaultModel: model,
      defaultTools: [],
      subagents: [],
      generalPurposeAgent: false,
    });
    const allowedToolNames = new Set([...hostTools.map((tool) => tool.name), ...filesystemTools]);

    return [
      filesystem,
      createMiddleware({ name: subagents.name }),
      createMiddleware({
        name: "FlightRulesCapabilityGuard",
        wrapModelCall: async (request, handler) => {
          const response = await handler(request);
          for (const call of response.tool_calls ?? []) {
            if (!allowedToolNames.has(call.name)) {
              const error = new CapabilityToolDeniedError({
                toolName: call.name,
                capability: filesystemCapabilities.get(call.name),
              });
              onCapabilityDenied(error);
              throw error;
            }
          }
          return response;
        },
        wrapToolCall: async (request, handler) => {
          const name = request.toolCall.name;
          const capability = filesystemCapabilities.get(name);
          if (allowedToolNames.has(name) && capability === undefined) {
            return trackExecution(() => Promise.resolve(handler(request)));
          }
          if (
            capability !== undefined &&
            permissions.has(capability) &&
            capability !== "shell" &&
            capability !== "spawn"
          ) {
            return trackExecution(() => Promise.resolve(handler(request)));
          }
          const error = new CapabilityToolDeniedError({ toolName: name, capability });
          onCapabilityDenied(error);
          throw error;
        },
      }),
    ] as const;
  }
}
