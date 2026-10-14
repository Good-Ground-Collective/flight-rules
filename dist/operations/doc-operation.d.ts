import { z } from "zod";
import { type DocResolver } from "../bundled-docs/doc-resolver/doc-resolver.js";
import type { OperationDescriptor } from "./operation-registry.js";
import type { CliRoute, OperationEffect } from "./operation.schema.js";
export declare const DocOperationInputSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const DocOperationOutputSchema: z.ZodObject<{
    id: z.ZodString;
    path: z.ZodString;
    contents: z.ZodString;
}, z.core.$strip>;
declare const DocOperationPropsSchema: z.ZodObject<{
    getResolver: z.ZodCustom<() => DocResolver, () => DocResolver>;
}, z.core.$strip>;
/** Resolves a bundled document through the same boundary used by CLI and SDK callers. */
export declare class DocOperation implements OperationDescriptor<z.infer<typeof DocOperationInputSchema>, z.infer<typeof DocOperationOutputSchema>> {
    readonly id = "doc";
    readonly description = "Read a bundled flight-rules document by its document ID.";
    readonly inputSchema: z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>;
    readonly outputSchema: z.ZodObject<{
        id: z.ZodString;
        path: z.ZodString;
        contents: z.ZodString;
    }, z.core.$strip>;
    readonly effects: OperationEffect[];
    readonly cli: CliRoute;
    private readonly getResolver;
    constructor(props: z.input<typeof DocOperationPropsSchema>);
    handler({ id }: z.infer<typeof DocOperationInputSchema>): z.infer<typeof DocOperationOutputSchema>;
}
export {};
