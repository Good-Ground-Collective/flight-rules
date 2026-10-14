import { z } from "zod";
export declare const OperationEffectSchema: z.ZodEnum<{
    read: "read";
    network: "network";
    write: "write";
    process: "process";
}>;
export declare const OperationIdSchema: z.ZodString;
export declare const CliRouteSchema: z.ZodObject<{
    path: z.ZodArray<z.ZodString>;
    aliases: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const OperationErrorSchema: z.ZodObject<{
    name: z.ZodString;
    message: z.ZodString;
}, z.core.$strip>;
export declare const OperationEnvelopeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"success">;
    data: z.ZodUnknown;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"error">;
    error: z.ZodObject<{
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"partial">;
    data: z.ZodUnknown;
    error: z.ZodObject<{
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>], "status">;
export type OperationEffect = z.infer<typeof OperationEffectSchema>;
export type OperationEnvelope = z.infer<typeof OperationEnvelopeSchema>;
export type CliRoute = z.infer<typeof CliRouteSchema>;
