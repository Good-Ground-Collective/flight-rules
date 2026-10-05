export interface LocalReference {
    line: number;
    match: string;
}
export interface PortableContextGuard {
    find(body: string): LocalReference[];
    assertPortable(body: string, opts?: {
        allowLocalPaths?: boolean | undefined;
    }): void;
}
/**
 * Rejects tracker bodies that point at files on the author's machine. A ticket is
 * the source of truth for whoever picks it up on another machine, so every
 * reference in it must resolve from a fresh clone or a URL
 * (docs/layered-body-format.md, "Portable context").
 */
export declare class RegexPortableContextGuard implements PortableContextGuard {
    find(body: string): LocalReference[];
    assertPortable(body: string, opts?: {
        allowLocalPaths?: boolean | undefined;
    }): void;
}
export declare const portableContextGuard: PortableContextGuard;
