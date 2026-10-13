import { z } from "zod";
import type { ReadinessCheck } from "./readiness.schema.js";
declare const ProbeDiagnosticsPropsSchema: z.ZodObject<{
    env: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export interface ProbeDiagnostics {
    redact(text: string): string;
    failure(name: string, error: unknown, required: boolean, fallback?: string): ReadinessCheck;
}
/** Keeps observed failure categories separate and removes credentials before diagnostics leave the process. */
export declare class RedactedProbeDiagnostics implements ProbeDiagnostics {
    private readonly secrets;
    constructor(props: z.infer<typeof ProbeDiagnosticsPropsSchema>);
    redact(text: string): string;
    failure(name: string, error: unknown, required: boolean, fallback?: string): ReadinessCheck;
}
export {};
