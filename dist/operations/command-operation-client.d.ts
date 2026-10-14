import { z } from "zod";
import { type OperationRegistry } from "./operation-registry.js";
declare const CommandOperationClientPropsSchema: z.ZodObject<{
    registry: z.ZodCustom<OperationRegistry, OperationRegistry>;
}, z.core.$strip>;
export interface CommandOperationClient {
    invoke<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
}
/** Turns validated shared-operation envelopes into command results and CLI errors. */
export declare class RegistryCommandOperationClient implements CommandOperationClient {
    private readonly registry;
    constructor(props: z.input<typeof CommandOperationClientPropsSchema>);
    invoke<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
}
export {};
