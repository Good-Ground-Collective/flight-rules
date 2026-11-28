/** Reads unified-diff hunks and records which new-side lines they add or border a removal. */
export declare class DiffHunks {
    /** True when the line opens a hunk. */
    static isHeader(line: string): boolean;
    /**
     * Consumes the hunk that starts at `lines[from]` and adds its changed new-side
     * lines to `into`. Only `+` lines count as added, so context lines are safe.
     * Removed lines mark the new-side lines on either side of the removal, which
     * is `c` and `c+1` for a `-U0` header `+c,0`. Returns the index after the hunk.
     */
    static collect(lines: readonly string[], from: number, into: Set<number>): number;
}
