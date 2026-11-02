import { z } from "zod";
import { ModelBindingsSchema } from "../../agents/agent-emitter/agent-emitter.schema.js";
export type ClaudeModelBindings = z.output<typeof ModelBindingsSchema>;
declare const FileModelTierCatalogPropsSchema: z.ZodObject<{
    moduleUrl: z.ZodString;
    env: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
}, z.core.$strict>;
export declare class ModelTiersUnavailableError extends Error {
    name: string;
}
export interface ModelTierCatalog {
    load(): ClaudeModelBindings;
}
/** Reads the reviewed Claude tier table shipped with the installed package, independent of cwd. */
export declare class FileModelTierCatalog implements ModelTierCatalog {
    private readonly path;
    constructor(props: z.input<typeof FileModelTierCatalogPropsSchema>);
    load(): ClaudeModelBindings;
}
export declare const claudeModelTiers: ModelTierCatalog;
export {};
