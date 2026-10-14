import type { Command } from "commander";
import { z } from "zod";
import { type CliRoute } from "./operation.schema.js";
import type { OperationCatalog } from "./operation-registry.js";
declare const RouteDispositionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"supported">;
    route: z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    operationId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"pending-migration">;
    route: z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    operationId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"excluded">;
    route: z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    reason: z.ZodString;
}, z.core.$strip>], "status">;
declare const CliRouteCoveragePropsSchema: z.ZodObject<{
    entries: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"supported">;
        route: z.ZodObject<{
            path: z.ZodArray<z.ZodString>;
            aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        operationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"pending-migration">;
        route: z.ZodObject<{
            path: z.ZodArray<z.ZodString>;
            aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        operationId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"excluded">;
        route: z.ZodObject<{
            path: z.ZodArray<z.ZodString>;
            aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        reason: z.ZodString;
    }, z.core.$strip>], "status">>;
}, z.core.$strip>;
export type RouteDisposition = z.infer<typeof RouteDispositionSchema>;
export interface CliRouteCoverage {
    check(program: Command, catalog: OperationCatalog): CliRoute[];
    assertComplete(program: Command, catalog: OperationCatalog): void;
    list(): RouteDisposition[];
}
export declare class CliRouteCoverageError extends Error {
    name: string;
}
/** Explicitly records how each executable CLI route is served by the shared core. */
export declare class ManifestCliRouteCoverage implements CliRouteCoverage {
    private readonly entries;
    constructor(props: z.input<typeof CliRouteCoveragePropsSchema>);
    check(program: Command, catalog: OperationCatalog): CliRoute[];
    assertComplete(program: Command, catalog: OperationCatalog): void;
    list(): RouteDisposition[];
    private checkCatalog;
    static routeKey(path: string[]): string;
    static sameAliases(left: string[], right: string[]): boolean;
    static discover(program: Command): CliRoute[];
}
/** Inventory of the existing 68 CLI routes; pending entries stay unavailable to operation consumers. */
export declare const cliRouteCoverage: CliRouteCoverage;
export {};
