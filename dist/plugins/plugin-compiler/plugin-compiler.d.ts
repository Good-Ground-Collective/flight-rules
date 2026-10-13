import { z } from "zod";
declare const NativePluginCompilerPropsSchema: z.ZodObject<{
    sourceDir: z.ZodString;
}, z.core.$strict>;
declare const PluginHostSchema: z.ZodEnum<{
    claude: "claude";
    codex: "codex";
}>;
export type PluginHost = z.infer<typeof PluginHostSchema>;
export interface CompiledPlugin {
    directory: string;
    agents: string[];
    diagnostics: string[];
}
export interface PluginCompiler {
    compile(host?: PluginHost): CompiledPlugin;
}
export declare class InvalidPluginSourceError extends Error {
    name: string;
}
/** Assembles native packages without rewriting canonical skills or retaining stale generated resources. */
export declare class NativePluginCompiler implements PluginCompiler {
    private readonly sourceDir;
    constructor(props: z.infer<typeof NativePluginCompilerPropsSchema>);
    compile(host?: PluginHost): CompiledPlugin;
    private validateSource;
    private copyDirectory;
}
export {};
