import { z } from "zod";
import { DiffHunks } from "./diff-hunks.js";
import { GitPath } from "./git-path.js";

type FileChange = Set<number> | "all";

const UnifiedDiffChangesPropsSchema = z.strictObject({
  entries: z.map(z.string(), z.union([z.literal("all"), z.set(z.number().int())])),
});
const FilePatchesSchema = z.array(
  z.object({
    filename: z.string(),
    previous_filename: z.string().optional(),
    status: z.string(),
    patch: z.string().optional(),
    changes: z.number().int().nonnegative().optional(),
  }),
);

export type UnifiedDiffChangesProps = z.input<typeof UnifiedDiffChangesPropsSchema>;
export type ComparedFile = z.input<typeof FilePatchesSchema>[number];

interface FileBlock {
  path: string | undefined;
  wholeFile: boolean;
  deleted: boolean;
  sawTarget: boolean;
  lines: Set<number>;
}

/**
 * Index of the new-side lines a diff adds or modifies, per path.
 *
 * The diff must run from the last reviewed head to the current head; the
 * caller owns choosing that base. Nothing here reads git or GitHub.
 * A file counts as wholly changed when it is new, binary, or arrives without a
 * patch. A deleted file has no new side and is absent from the index.
 */
export class UnifiedDiffChanges {
  private readonly entries: ReadonlyMap<string, FileChange>;

  constructor(props: UnifiedDiffChangesProps) {
    this.entries = UnifiedDiffChangesPropsSchema.parse(props).entries;
  }

  /**
   * True when any line in the inclusive range `startLine..line` is changed, or
   * the file is wholly changed. Line 0 (a PR-wide finding) and an inverted
   * range are treated as changed; a path absent from the diff is unchanged.
   */
  touches(path: string, line: number, startLine?: number): boolean {
    const first = startLine ?? line;

    if (line <= 0 || first > line) {
      return true;
    }

    const entry = this.entries.get(path);
    if (entry === undefined) {
      return false;
    }
    if (entry === "all") {
      return true;
    }
    return [...entry].some((changed) => changed >= first && changed <= line);
  }

  /** Builds the index from the text of a `git diff` (typically `-U0`). */
  static parse(diff: string): UnifiedDiffChanges {
    const text = z.string().parse(diff);
    const lines = text.split(/\r?\n/);
    const entries = new Map<string, FileChange>();
    let block: FileBlock | undefined;
    let at = 0;

    while (at < lines.length) {
      const line = lines[at] ?? "";

      if (line.startsWith("diff --git ")) {
        UnifiedDiffChanges.finish(entries, block);
        block = UnifiedDiffChanges.openBlock(GitPath.fromDiffHeader(line.slice(11)));
        at++;
      } else if (DiffHunks.isHeader(line)) {
        block ??= UnifiedDiffChanges.openBlock(undefined);
        at = DiffHunks.collect(lines, at, block.lines);
      } else {
        if (line.startsWith("--- ") && (lines[at + 1] ?? "").startsWith("+++ ") && (!block || block.sawTarget)) {
          UnifiedDiffChanges.finish(entries, block);
          block = UnifiedDiffChanges.openBlock(undefined);
        }
        if (block) {
          UnifiedDiffChanges.readMetadata(block, line);
        }
        at++;
      }
    }

    UnifiedDiffChanges.finish(entries, block);
    return new UnifiedDiffChanges({ entries });
  }

  /** Builds the index from GitHub compare-API file entries. */
  static fromFilePatches(files: ComparedFile[]): UnifiedDiffChanges {
    const entries = new Map<string, FileChange>();

    for (const file of FilePatchesSchema.parse(files)) {
      const pureRename =
        file.status === "renamed" && file.patch === undefined && !(file.changes && file.changes > 0);

      if (file.status === "removed") {
        continue;
      }

      if (pureRename) {
        UnifiedDiffChanges.merge(entries, file.filename, new Set());
      } else if (file.status === "added" || file.patch === undefined) {
        UnifiedDiffChanges.merge(entries, file.filename, "all");
      } else {
        const changed = new Set<number>();
        const lines = file.patch.split(/\r?\n/);
        for (let at = 0; at < lines.length; ) {
          at = DiffHunks.isHeader(lines[at] ?? "")
            ? DiffHunks.collect(lines, at, changed)
            : at + 1;
        }
        UnifiedDiffChanges.merge(entries, file.filename, changed);
      }
    }

    return new UnifiedDiffChanges({ entries });
  }

  private static openBlock(path: string | undefined): FileBlock {
    return { path, wholeFile: false, deleted: false, sawTarget: false, lines: new Set() };
  }

  private static readMetadata(block: FileBlock, line: string): void {
    if (line.startsWith("new file mode ")) {
      block.wholeFile = true;
    } else if (line.startsWith("deleted file mode ")) {
      block.deleted = true;
    } else if (line.startsWith("rename to ")) {
      block.path = GitPath.fromFileMarker(line.slice(10));
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      block.wholeFile = true;
    } else if (line.startsWith("--- ")) {
      if (GitPath.fromFileMarker(line.slice(4)) === "/dev/null") {
        block.wholeFile = true;
      }
    } else if (line.startsWith("+++ ")) {
      const target = GitPath.fromFileMarker(line.slice(4));
      block.sawTarget = true;
      if (target === "/dev/null") {
        block.deleted = true;
      } else {
        block.path = GitPath.stripSidePrefix(target);
      }
    }
  }

  private static finish(entries: Map<string, FileChange>, block: FileBlock | undefined): void {
    if (!block || block.path === undefined || block.deleted) {
      return;
    }
    UnifiedDiffChanges.merge(entries, block.path, block.wholeFile ? "all" : block.lines);
  }

  private static merge(entries: Map<string, FileChange>, path: string, change: FileChange): void {
    const existing = entries.get(path);

    if (existing === "all" || change === "all") {
      entries.set(path, "all");
    } else {
      entries.set(path, new Set([...(existing ?? []), ...change]));
    }
  }
}
