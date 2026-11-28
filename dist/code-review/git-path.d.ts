/** Reads file paths as git prints them in diffs: C-quoted when they hold special characters, and prefixed with `a/` or `b/`. */
export declare class GitPath {
    /** Decodes a path token, unquoting and unescaping it when git quoted it. */
    static decode(token: string): string;
    /** Removes the single-letter `a/` or `b/` side prefix git adds to diff paths. */
    static stripSidePrefix(path: string): string;
    /** Reads the path from a `---` or `+++` line, dropping the tab git appends after unquoted paths. */
    static fromFileMarker(rest: string): string;
    /** Reads the new-side path from the arguments of a `diff --git` line. */
    static fromDiffHeader(rest: string): string | undefined;
    private static closingQuote;
    private static unescape;
}
