import { z } from "zod";
declare const StdioLaunchPropsSchema: z.ZodObject<{
    trustedRef: z.ZodOptional<z.ZodString>;
    owners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    requireMapping: z.ZodDefault<z.ZodBoolean>;
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
    cwd: z.ZodDefault<z.ZodString>;
    env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>>;
}, z.core.$strict>;
export type StdioLaunchProps = z.input<typeof StdioLaunchPropsSchema>;
export interface FlightRulesMcpTransport {
    serve(): Promise<void>;
}
/** Owns one launch-bound server across modern and legacy stdio connections. */
export declare class StdioFlightRulesMcpTransport implements FlightRulesMcpTransport {
    private readonly launch;
    constructor(props?: StdioLaunchProps);
    serve(): Promise<void>;
}
export { StdioLaunchPropsSchema };
