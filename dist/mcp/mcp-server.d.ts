import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type QaFileSystem } from "../tasks/qa-instructions/qa-instructions.js";
declare const McpLaunchPropsSchema: z.ZodObject<{
    trustedRef: z.ZodOptional<z.ZodString>;
    owners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    requireMapping: z.ZodDefault<z.ZodBoolean>;
    cwd: z.ZodString;
    env: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
    allowedOperationIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowedEffects: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        read: "read";
        network: "network";
        write: "write";
        process: "process";
    }>>>;
    allowedConfigScopes: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        file: "file";
        local: "local";
        user: "user";
        project: "project";
    }>>>;
}, z.core.$strict>;
export type McpLaunchProps = z.input<typeof McpLaunchPropsSchema>;
declare const LaunchBoundQaFileSystemPropsSchema: z.ZodObject<{
    root: z.ZodString;
}, z.core.$strip>;
export declare class LaunchCheckoutChangedError extends Error {
    name: string;
}
export declare class UnsafeQaInstructionsPathError extends Error {
    name: string;
}
/** Restricts QA instruction reads to files whose resolved path stays in the launch checkout. */
export declare class LaunchBoundQaFileSystem implements QaFileSystem {
    private readonly root;
    constructor(props: z.input<typeof LaunchBoundQaFileSystemPropsSchema>);
    exists(path: string): boolean;
    isFile(path: string): boolean;
    readFile(path: string): string;
    private isInsideLaunch;
    private requireInsideLaunch;
}
export interface McpProtocolServerFactory {
    createProtocolServer(): McpServer;
}
/** Serves shared operations using the original launch directory across protocol negotiations. */
export declare class FlightRulesMcpServer implements McpProtocolServerFactory {
    private readonly props;
    private readonly cwd;
    private readonly launchDevice;
    private readonly launchInode;
    private readonly qaFileSystem;
    private registry;
    private operationDescriptors;
    private instructions;
    constructor(props: McpLaunchProps);
    createProtocolServer(): McpServer;
    private initializeLaunchServices;
    private operations;
    private findOperation;
    /** Pathnames can be reused after a rename; the launch grant belongs to the original directory. */
    private requireOriginalLaunchCheckout;
    private validateLocalPaths;
}
export { McpLaunchPropsSchema };
