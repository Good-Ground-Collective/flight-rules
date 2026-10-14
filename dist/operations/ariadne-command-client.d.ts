import { z } from "zod";
import type { BoardOutcome } from "../shared/ariadne/ariadne-board.js";
import { type OperationRegistry } from "./operation-registry.js";
declare const ClientPropsSchema: z.ZodObject<{
    registry: z.ZodCustom<OperationRegistry, OperationRegistry>;
}, z.core.$strip>;
export interface AriadneCommandClient {
    board<T>(id: string, input: unknown, valueSchema: z.ZodType<T>): Promise<BoardOutcome<T>>;
    packet<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
}
/** Adapts validated Ariadne operations to Commander result and error contracts. */
export declare class RegistryAriadneCommandClient implements AriadneCommandClient {
    private readonly registry;
    constructor(props: z.input<typeof ClientPropsSchema>);
    board<T>(id: string, input: unknown, valueSchema: z.ZodType<T>): Promise<BoardOutcome<T>>;
    packet<T>(id: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
}
export {};
