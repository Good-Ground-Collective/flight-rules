import { z } from 'zod';
export declare const DocIdSchema: z.ZodString;
declare const FileDocResolverPropsSchema: z.ZodObject<{
    docsDir: z.ZodString;
}, z.core.$strip>;
declare const DocNotFoundPropsSchema: z.ZodObject<{
    id: z.ZodString;
    available: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export interface ResolvedDoc {
    id: string;
    path: string;
    contents: string;
}
export interface DocResolver {
    list(): string[];
    resolve(id: string): ResolvedDoc;
}
export type FileDocResolverProps = z.infer<typeof FileDocResolverPropsSchema>;
export interface InstallDocsProps {
    moduleUrl: string;
    env: NodeJS.ProcessEnv;
}
export declare class InvalidDocIdError extends Error {
    name: string;
}
export declare class DocNotFoundError extends Error {
    name: string;
    readonly available: string[];
    constructor(props: z.infer<typeof DocNotFoundPropsSchema>);
}
/** Resolves on-disk documentation beside the installed CLI, independent of the caller's cwd. */
export declare class FileDocResolver implements DocResolver {
    private readonly docsDir;
    constructor(props: FileDocResolverProps);
    list(): string[];
    resolve(id: string): ResolvedDoc;
    static fromInstall(props: InstallDocsProps): FileDocResolver;
}
export {};
