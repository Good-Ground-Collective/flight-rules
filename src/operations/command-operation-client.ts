import { z } from "zod";
import { OperationCliError, type OperationRegistry } from "./operation-registry.js";

const CommandOperationClientPropsSchema = z.object({
  registry: z.custom<OperationRegistry>(
    (value) => typeof value === "object" && value !== null && "invoke" in value,
  ),
});

export interface CommandOperationClient {
  invoke<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
}

/** Turns validated shared-operation envelopes into command results and CLI errors. */
export class RegistryCommandOperationClient implements CommandOperationClient {
  private readonly registry: OperationRegistry;

  constructor(props: z.input<typeof CommandOperationClientPropsSchema>) {
    this.registry = CommandOperationClientPropsSchema.parse(props).registry;
  }

  async invoke<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
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
