import { z } from "zod";
declare const UnifiedDiffChangesPropsSchema: z.ZodObject<{
    entries: z.ZodMap<z.ZodString, z.ZodUnion<readonly [z.ZodLiteral<"all">, z.ZodSet<z.ZodNumber>]>>;
}, z.core.$strict>;
declare const FilePatchesSchema: z.ZodArray<z.ZodObject<{
    filename: z.ZodString;
    previous_filename: z.ZodOptional<z.ZodString>;
    status: z.ZodString;
    patch: z.ZodOptional<z.ZodString>;
    changes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>;
export type UnifiedDiffChangesProps = z.input<typeof UnifiedDiffChangesPropsSchema>;
export type ComparedFile = z.input<typeof FilePatchesSchema>[number];
/**
 * Index of the new-side lines a diff adds or modifies, per path.
 *
 * The diff must run from the last reviewed head to the current head; the
 * caller owns choosing that base. Nothing here reads git or GitHub.
 * The diff passed to `parse()` must be generated with
 * `--src-prefix=a/ --dst-prefix=b/ --no-color --no-ext-diff`, because only
 * `a/` and `b/` prefixes are stripped.
 * A file counts as wholly changed when it is new, binary, or arrives without a
 * patch. A deleted file has no new side and is absent from the index.
 */
export declare class UnifiedDiffChanges {
    private readonly entries;
    constructor(props: UnifiedDiffChangesProps);
    /**
     * True when any line in the inclusive range `startLine..line` is changed, or
     * the file is wholly changed. Line 0 (a PR-wide finding) and an inverted
     * range are treated as changed; a path absent from the diff is unchanged.
     */
    touches(path: string, line: number, startLine?: number): boolean;
    /** Builds the index from the text of a `git diff` (typically `-U0`). */
    static parse(diff: string): UnifiedDiffChanges;
    /** Builds the index from GitHub compare-API file entries. */
    static fromFilePatches(files: ComparedFile[]): UnifiedDiffChanges;
    private static openBlock;
    private static readMetadata;
    private static finish;
    private static merge;
}
export {};
