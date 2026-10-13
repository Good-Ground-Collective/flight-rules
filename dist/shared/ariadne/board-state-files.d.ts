import type { z } from "zod";
/** Ids become file names, so only the API's own session alphabet is accepted. */
export declare const stateIdPattern: RegExp;
export interface BoardStateFilesProps {
    env?: Record<string, string | undefined>;
    home?: string;
    now?: () => number;
}
/**
 * Small JSON files under `$XDG_STATE_HOME/flight-rules/board` (default
 * `~/.local/state/flight-rules/board`), outside every repository, written
 * with mode 0600. Reads never throw: a missing or unreadable file is absent.
 */
export declare class BoardStateFiles {
    readonly now: () => number;
    private readonly env;
    private readonly home;
    constructor(props?: BoardStateFilesProps);
    root(): string;
    read<T>(folder: string | undefined, id: string, schema: z.ZodType<T>): T | undefined;
    write(folder: string | undefined, id: string, value: unknown): void;
    /** Writes a file only if none exists, atomically; returns whether it wrote. */
    create(folder: string | undefined, id: string, value: unknown): boolean;
    remove(folder: string | undefined, id: string): void;
    /** Deletes a folder's files last written more than `maxAgeMs` ago. */
    prune(folder: string, maxAgeMs: number): void;
    private folder;
    private pathFor;
}
