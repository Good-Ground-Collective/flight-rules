import { z } from "zod";
import type { BoardOutcome } from "../shared/ariadne/ariadne-board.js";
import { OperationCliError, type OperationRegistry } from "./operation-registry.js";

const ClientPropsSchema = z.object({
  registry: z.custom<OperationRegistry>(
    (value) => typeof value === "object" && value !== null && "invoke" in value,
  ),
});
const BoardOperationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("skipped"),
    reason: z.enum(["disabled", "no-token", "invalid-url", "not-jira-ticket", "nothing-recorded"]),
    notices: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal("failed"),
    message: z.string(),
    notices: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal("ok"),
    value: z.unknown(),
    notices: z.array(z.string()).optional(),
  }),
]);

export interface AriadneCommandClient {
  board<T>(id: string, input: unknown, valueSchema: z.ZodType<T>): Promise<BoardOutcome<T>>;
  packet<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
}

/** Adapts validated Ariadne operations to Commander result and error contracts. */
export class RegistryAriadneCommandClient implements AriadneCommandClient {
  private readonly registry: OperationRegistry;

  constructor(props: z.input<typeof ClientPropsSchema>) {
    this.registry = ClientPropsSchema.parse(props).registry;
  }

  async board<T>(id: string, input: unknown, valueSchema: z.ZodType<T>): Promise<BoardOutcome<T>> {
    const result = await this.registry.invoke(id, input);
    if (result.status !== "success") {
      throw new OperationCliError({
        operationId: id,
        errorName: result.error.name,
        message: result.error.message,
        ...(result.status === "partial" ? { partialData: result.data } : {}),
      });
    }

    const parsed = BoardOperationResultSchema.parse(result.data);
    if (parsed.status === "ok") {
      return {
        status: "posted",
        value: valueSchema.parse(parsed.value),
        ...(parsed.notices === undefined ? {} : { notices: parsed.notices }),
      };
    }
    if (parsed.status === "skipped") {
      return {
        status: "skipped",
        reason: parsed.reason,
        ...(parsed.notices === undefined ? {} : { notices: parsed.notices }),
      };
    }
    return {
      status: "failed",
      message: parsed.message,
      ...(parsed.notices === undefined ? {} : { notices: parsed.notices }),
    };
  }

  async packet<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    const result = await this.registry.invoke(id, input);
    if (result.status !== "success") {
      throw new OperationCliError({
        operationId: id,
        errorName: result.error.name,
        message: result.error.message,
        ...(result.status === "partial" ? { partialData: result.data } : {}),
      });
    }
    return outputSchema.parse(result.data);
  }
}
