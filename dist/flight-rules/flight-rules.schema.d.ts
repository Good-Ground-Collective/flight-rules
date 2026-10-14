import { z } from "zod";
import type { HostSettingsSource } from "../shared/host-settings/host-settings-source.js";
export declare const FlightRulesPropsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>>;
    configPath: z.ZodOptional<z.ZodString>;
    host: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    configWritePolicy: z.ZodOptional<z.ZodObject<{
        scopes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            file: "file";
            local: "local";
            user: "user";
            project: "project";
        }>>>;
        roots: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strip>;
export type FlightRulesProps = z.input<typeof FlightRulesPropsSchema> & {
    /** The host's settings layers (a host adapter's seam); defaults to Claude Code's. */
    hostSettings?: HostSettingsSource;
};
