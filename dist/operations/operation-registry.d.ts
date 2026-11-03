import { z } from "zod";
import { type CliRoute, type OperationEffect, type OperationEnvelope } from "./operation.schema.js";
declare const OperationRegistryPropsSchema: z.ZodObject<{
    operations: z.ZodArray<z.ZodCustom<OperationDescriptor<unknown, unknown>, OperationDescriptor<unknown, unknown>>>;
    policy: z.ZodOptional<z.ZodCustom<OperationAccessPolicy, OperationAccessPolicy>>;
}, z.core.$strip>;
export interface OperationDescriptor<TInput = unknown, TOutput = unknown> {
    id: string;
    description: string;
    inputSchema: z.ZodType<TInput>;
    outputSchema: z.ZodType<TOutput>;
    effects: readonly OperationEffect[];
    cli: CliRoute;
    handler(input: TInput): OperationHandlerResult<TOutput> | Promise<OperationHandlerResult<TOutput>>;
}
export interface OperationInputField {
    name: string;
    type: string;
    required: boolean;
}
export interface OperationSummary {
    id: string;
    description: string;
    effects: OperationEffect[];
    cli: CliRoute;
    input?: OperationInputField[];
}
export interface OperationCatalog {
    list(): OperationSummary[];
}
export interface OperationRegistry extends OperationCatalog {
    admitted?(): OperationSummary[];
    invoke(id: string, input: unknown): Promise<OperationEnvelope>;
}
export type OperationHandlerResult<TOutput> = TOutput | {
    status: "partial";
    data: TOutput;
    error: {
        name: string;
        message: string;
    };
};
export interface OperationAccessPolicy {
    allows(operation: Pick<OperationDescriptor, "id" | "effects">): boolean;
}
declare const AccessPolicyPropsSchema: z.ZodObject<{
    allowedOperationIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowedEffects: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        read: "read";
        network: "network";
        write: "write";
        process: "process";
    }>>>;
}, z.core.$strip>;
/** Captures launch-time grants so request fields cannot authorize their own effects. */
export declare class LaunchOperationAccessPolicy implements OperationAccessPolicy {
    private readonly operationIds;
    private readonly effects;
    constructor(props?: z.input<typeof AccessPolicyPropsSchema>);
    allows(operation: Pick<OperationDescriptor, "id" | "effects">): boolean;
}
/** Describes the object fields an operation's input schema accepts, in the compact form a model can read. */
export declare class OperationInputShape {
    fieldsOf(schema: z.ZodType): OperationInputField[];
    render(fields: readonly OperationInputField[]): string;
    private typeOf;
}
export declare const operationInputShape: OperationInputShape;
export declare class OperationInputError extends Error {
    name: string;
}
export declare class OperationOutputError extends Error {
    name: string;
}
export declare class OperationAccessDeniedError extends Error {
    name: string;
}
export declare class UnknownOperationError extends Error {
    name: string;
}
export declare class DuplicateOperationIdError extends Error {
    name: string;
    constructor(operationId: string);
}
export declare class OperationCliError extends Error {
    name: string;
    readonly operationId: string;
    readonly operationErrorName: string;
    readonly partialData: unknown | undefined;
    constructor(props: {
        operationId: string;
        errorName: string;
        message: string;
        partialData?: unknown;
    });
}
/** Validates shared operation boundaries before and after executing application behavior. */
export declare class MapOperationRegistry implements OperationRegistry {
    private readonly operations;
    private readonly policy;
    constructor(props: z.input<typeof OperationRegistryPropsSchema>);
    list(): OperationSummary[];
    admitted(): OperationSummary[];
    invoke(id: string, input: unknown): Promise<OperationEnvelope>;
}
export {};
