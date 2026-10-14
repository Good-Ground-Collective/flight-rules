import { z } from "zod";
import { DocIdSchema, type DocResolver } from "../bundled-docs/doc-resolver/doc-resolver.js";
import type { OperationDescriptor } from "./operation-registry.js";
import type { CliRoute, OperationEffect } from "./operation.schema.js";

export const DocOperationInputSchema = z.object({ id: DocIdSchema });
export const DocOperationOutputSchema = z.object({ id: DocIdSchema, path: z.string().min(1), contents: z.string() });

const DocOperationPropsSchema = z.object({
  getResolver: z.custom<() => DocResolver>(value => typeof value === "function"),
});

/** Resolves a bundled document through the same boundary used by CLI and SDK callers. */
export class DocOperation implements OperationDescriptor<
  z.infer<typeof DocOperationInputSchema>,
  z.infer<typeof DocOperationOutputSchema>
> {
  readonly id = "doc";
  readonly description = "Read a bundled flight-rules document by its document ID.";
  readonly inputSchema = DocOperationInputSchema;
  readonly outputSchema = DocOperationOutputSchema;
  readonly effects: OperationEffect[] = ["read"];
  readonly cli: CliRoute = { path: ["doc"], aliases: [] };
  private readonly getResolver: () => DocResolver;

  constructor(props: z.input<typeof DocOperationPropsSchema>) {
    this.getResolver = DocOperationPropsSchema.parse(props).getResolver;
  }

  handler({ id }: z.infer<typeof DocOperationInputSchema>): z.infer<typeof DocOperationOutputSchema> {
    return this.getResolver().resolve(id);
  }
}
