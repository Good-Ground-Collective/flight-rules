import { z } from "zod";
import type { HostSettingsSource, SettingsScope } from "./host-settings-source.js";
declare const PropsSchema: z.ZodObject<{
    cwd: z.ZodString;
    home: z.ZodDefault<z.ZodString>;
    untrackedCwd: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare class InvalidSettingsError extends Error {
    name: string;
}
/** Flight-rules-owned settings for Codex; never adds unsupported keys to native config.toml. */
export declare class NeutralSettingsSource implements HostSettingsSource {
    readonly host = "codex";
    private readonly props;
    constructor(props: z.input<typeof PropsSchema>);
    pathFor(scope: SettingsScope): string;
    read(scope: SettingsScope): Record<string, unknown> | undefined;
    write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void;
    hint(): string;
}
export {};
