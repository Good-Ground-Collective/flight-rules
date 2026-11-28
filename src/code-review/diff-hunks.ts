const hunkHeader = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Reads unified-diff hunks and records which new-side lines they add or border a removal. */
export class DiffHunks {
  /** True when the line opens a hunk. */
  static isHeader(line: string): boolean {
    return hunkHeader.test(line);
  }

  /**
   * Consumes the hunk that starts at `lines[from]` and adds its changed new-side
   * lines to `into`. Only `+` lines count as added, so context lines are safe.
   * Removed lines mark the new-side lines on either side of the removal, which
   * is `c` and `c+1` for a `-U0` header `+c,0`. Returns the index after the hunk.
   */
  static collect(lines: readonly string[], from: number, into: Set<number>): number {
    const header = hunkHeader.exec(lines[from] ?? "");
    if (!header) {
      return from + 1;
    }

    let newLine = header[3] === "0" ? Number(header[2]) + 1 : Number(header[2]);
    let oldRemaining = header[1] === undefined ? 1 : Number(header[1]);
    let newRemaining = header[3] === undefined ? 1 : Number(header[3]);
    let removalPending = false;
    let at = from + 1;

    while (at < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
      const line = lines[at] ?? "";
      at++;

      if (line.startsWith("\\")) {
        continue;
      }

      if (line.startsWith("+")) {
        into.add(newLine);
        newLine++;
        newRemaining--;
        removalPending = false;
      } else if (line.startsWith("-")) {
        oldRemaining--;
        removalPending = true;
      } else {
        if (removalPending) {
          into.add(newLine - 1);
          into.add(newLine);
          removalPending = false;
        }
        newLine++;
        oldRemaining--;
        newRemaining--;
      }
    }

    if (removalPending) {
      into.add(newLine - 1);
      into.add(newLine);
    }

    while (at < lines.length && (lines[at] ?? "").startsWith("\\")) {
      at++;
    }
    return at;
  }
}
