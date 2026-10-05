import { z } from "zod";
declare const EnvSchema: z.ZodObject<{
    githubToken: z.ZodOptional<z.ZodString>;
    jiraToken: z.ZodOptional<z.ZodString>;
    jiraEmail: z.ZodOptional<z.ZodString>;
    jiraHost: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
}, z.core.$strip>;
export type Env = z.infer<typeof EnvSchema>;
export declare class EnvLoader {
    private readonly overrides;
    private cachedEnv;
    constructor(overrides?: Partial<Env>);
    load(source?: Record<string, unknown>, forceRefresh?: boolean): Env;
}
export {};
