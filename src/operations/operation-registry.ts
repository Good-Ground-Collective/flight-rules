import { z } from "zod";
import {
  CliRouteSchema,
  OperationEffectSchema,
  OperationEnvelopeSchema,
  OperationIdSchema,
  type CliRoute,
  type OperationEffect,
  type OperationEnvelope,
} from "./operation.schema.js";

const OperationDescriptorSchema = z.object({
  id: OperationIdSchema,
  description: z.string().min(1),
  inputSchema: z.custom<z.ZodType>(value => value instanceof z.ZodType),
  outputSchema: z.custom<z.ZodType>(value => value instanceof z.ZodType),
  effects: z.array(OperationEffectSchema),
  cli: CliRouteSchema,
  handler: z.custom<(...args: never[]) => unknown>(value => typeof value === "function"),
});
const OperationRegistryPropsSchema = z.object({
  operations: z.array(z.custom<OperationDescriptor>()),
  policy: z.custom<OperationAccessPolicy>().optional(),
});

export interface OperationDescriptor<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  effects: OperationEffect[];
  cli: CliRoute;
  handler(input: TInput): OperationHandlerResult<TOutput> | Promise<OperationHandlerResult<TOutput>>;
}

export type OperationHandlerResult<TOutput> =
  | TOutput
  | { status: "partial"; data: TOutput; error: { name: string; message: string } };

export interface OperationAccessPolicy {
  allows(operation: Pick<OperationDescriptor, "id" | "effects">): boolean;
}

const AccessPolicyPropsSchema = z.object({
  allowedOperationIds: z.array(OperationIdSchema).default([]),
  allowedEffects: z.array(OperationEffectSchema).default([]),
});

/** Captures launch-time grants so request fields cannot authorize their own effects. */
export class LaunchOperationAccessPolicy implements OperationAccessPolicy {
  private readonly operationIds: Set<string>;
  private readonly effects: Set<OperationEffect>;

  constructor(props: z.input<typeof AccessPolicyPropsSchema> = {}) {
    const grants = AccessPolicyPropsSchema.parse(props);
    this.operationIds = new Set(grants.allowedOperationIds);
    this.effects = new Set(grants.allowedEffects);
  }

  allows(operation: Pick<OperationDescriptor, "id" | "effects">): boolean {
    return this.operationIds.has(operation.id) || operation.effects.every(effect => this.effects.has(effect));
  }
}

export class OperationInputError extends Error {
  override name = "OperationInputError";
}

export class OperationOutputError extends Error {
  override name = "OperationOutputError";
}

export class OperationAccessDeniedError extends Error {
  override name = "OperationAccessDeniedError";
}

export class UnknownOperationError extends Error {
  override name = "UnknownOperationError";
}

/** Validates shared operation boundaries before and after executing application behavior. */
export class OperationRegistry {
  private readonly operations: Map<string, OperationDescriptor>;
  private readonly policy: OperationAccessPolicy;

  constructor(props: z.input<typeof OperationRegistryPropsSchema>) {
    const parsed = OperationRegistryPropsSchema.parse(props);
    this.policy = parsed.policy ?? new LaunchOperationAccessPolicy();
    this.operations = new Map();
    for (const descriptor of parsed.operations) {
      const valid = OperationDescriptorSchema.parse(descriptor);
      if (this.operations.has(valid.id)) throw new Error(`Duplicate operation id: ${valid.id}`);
      this.operations.set(valid.id, descriptor);
    }
  }

  list(): Array<Pick<OperationDescriptor, "id" | "description" | "effects" | "cli">> {
    return [...this.operations.values()].map(({ id, description, effects, cli }) => ({ id, description, effects, cli }));
  }

  async invoke(id: string, input: unknown): Promise<OperationEnvelope> {
    const operation = this.operations.get(id);
    if (operation === undefined) throw new UnknownOperationError(`Unknown operation: ${id}`);

    const parsedInput = operation.inputSchema.safeParse(input);
    if (!parsedInput.success) throw new OperationInputError(`Invalid input for ${id}: ${parsedInput.error.message}`);
    if (!this.policy.allows(operation)) {
      return OperationEnvelopeSchema.parse({
        status: "error",
        error: { name: "OperationAccessDeniedError", message: `Access denied for operation: ${id}` },
      });
    }

    try {
      const output = await operation.handler(parsedInput.data);
      const partial = z.object({
        status: z.literal("partial"),
        data: z.unknown(),
        error: z.object({ name: z.string().min(1), message: z.string() }),
      }).safeParse(output);
      if (partial.success) {
        const parsedPartial = operation.outputSchema.safeParse(partial.data.data);
        if (!parsedPartial.success) throw new OperationOutputError(`Invalid partial output for ${id}: ${parsedPartial.error.message}`);
        return OperationEnvelopeSchema.parse({ status: "partial", data: parsedPartial.data, error: partial.data.error });
      }

      const parsedOutput = operation.outputSchema.safeParse(output);
      if (!parsedOutput.success) throw new OperationOutputError(`Invalid output for ${id}: ${parsedOutput.error.message}`);
      return OperationEnvelopeSchema.parse({ status: "success", data: parsedOutput.data });
    } catch (error) {
      return OperationEnvelopeSchema.parse({
        status: "error",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
