import { describe, expect, it } from "vitest";
import { UnifiedDiffChanges } from "../diff-changes.js";

const modify = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,2 +10,3 @@ fn
-old one
-old two
+new one
+new two
+new three
@@ -30 +31 @@
-x
+y
\\ No newline at end of file
`;

describe("UnifiedDiffChanges.parse", () => {
  it("indexes added and modified lines and ignores the rest", () => {
    const changes = UnifiedDiffChanges.parse(modify);
    expect(changes.touches("src/a.ts", 10)).toBe(true);
    expect(changes.touches("src/a.ts", 12)).toBe(true);
    expect(changes.touches("src/a.ts", 31)).toBe(true);
    expect(changes.touches("src/a.ts", 13)).toBe(false);
    expect(changes.touches("src/a.ts", 30)).toBe(false);
  });

  it("treats a path absent from the diff as unchanged", () => {
    expect(UnifiedDiffChanges.parse(modify).touches("src/other.ts", 10)).toBe(false);
  });

  it("matches a range that spans a change", () => {
    const changes = UnifiedDiffChanges.parse(modify);
    expect(changes.touches("src/a.ts", 20, 5)).toBe(true);
    expect(changes.touches("src/a.ts", 29, 14)).toBe(false);
  });

  it("treats line 0 and inverted ranges as changed", () => {
    const changes = UnifiedDiffChanges.parse(modify);
    expect(changes.touches("src/other.ts", 0)).toBe(true);
    expect(changes.touches("src/a.ts", 5, 9)).toBe(true);
  });

  it("reads an add-only hunk and a missing count as one line", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -4,0 +5,2 @@\n+a\n+b\n@@ -9 +12 @@\n-c\n+d\n",
    );
    expect(changes.touches("b.ts", 5, 6)).toBe(true);
    expect(changes.touches("b.ts", 12)).toBe(true);
    expect(changes.touches("b.ts", 11)).toBe(false);
    expect(changes.touches("b.ts", 7)).toBe(false);
  });

  it("marks both neighbours of a deletion-only hunk", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/d.ts b/d.ts\n--- a/d.ts\n+++ b/d.ts\n@@ -8,2 +7,0 @@\n-a\n-b\n",
    );
    expect(changes.touches("d.ts", 7)).toBe(true);
    expect(changes.touches("d.ts", 8)).toBe(true);
    expect(changes.touches("d.ts", 6)).toBe(false);
    expect(changes.touches("d.ts", 9)).toBe(false);
  });

  it("treats new files as wholly changed", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n",
    );
    expect(changes.touches("n.ts", 500)).toBe(true);
  });

  it("treats binary files as wholly changed", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ\n",
    );
    expect(changes.touches("img.png", 3)).toBe(true);
  });

  it("gives deleted files no new side", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n",
    );
    expect(changes.touches("gone.ts", 1)).toBe(false);
  });

  it("indexes a pure rename by its new path as unchanged", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n",
    );
    expect(changes.touches("new.ts", 1)).toBe(false);
    expect(changes.touches("old.ts", 1)).toBe(false);
  });

  it("indexes a rename with edits by its new path", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -3 +3 @@\n-a\n+b\n",
    );
    expect(changes.touches("new.ts", 3)).toBe(true);
    expect(changes.touches("new.ts", 4)).toBe(false);
  });

  it("decodes quoted C-escaped paths", () => {
    const changes = UnifiedDiffChanges.parse(
      'diff --git "a/caf\\303\\251 \\"x\\".ts" "b/caf\\303\\251 \\"x\\".ts"\n--- "a/caf\\303\\251 \\"x\\".ts"\n+++ "b/caf\\303\\251 \\"x\\".ts"\n@@ -1 +1 @@\n-a\n+b\n',
    );
    expect(changes.touches('café "x".ts', 1)).toBe(true);
  });

  it("handles a quoted binary path with only a diff header", () => {
    const changes = UnifiedDiffChanges.parse(
      'diff --git "a/t\\tab.bin" "b/t\\tab.bin"\nBinary files "a/t\\tab.bin" and "b/t\\tab.bin" differ\n',
    );
    expect(changes.touches("t\tab.bin", 9)).toBe(true);
  });

  it("handles unquoted paths with spaces", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/my dir/f b.ts b/my dir/f b.ts\nnew file mode 100644\nBinary files /dev/null and b/my dir/f b.ts differ\n",
    );
    expect(changes.touches("my dir/f b.ts", 1)).toBe(true);
  });

  it("does not mistake hunk lines that look like file markers for new files", () => {
    const changes = UnifiedDiffChanges.parse(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n--- a/other\n+++ b/other\n keep\n",
    );
    expect(changes.touches("a.ts", 1)).toBe(true);
    expect(changes.touches("other", 1)).toBe(false);
  });

  it("indexes several files in one diff", () => {
    const changes = UnifiedDiffChanges.parse(
      `${modify}diff --git a/z.ts b/z.ts\n--- a/z.ts\n+++ b/z.ts\n@@ -1 +1 @@\n-a\n+b\n`,
    );
    expect(changes.touches("z.ts", 1)).toBe(true);
    expect(changes.touches("src/a.ts", 12)).toBe(true);
  });
});

describe("UnifiedDiffChanges.fromFilePatches", () => {
  it("builds the same index as parse for equivalent input", () => {
    const parsed = UnifiedDiffChanges.parse(modify);
    const patched = UnifiedDiffChanges.fromFilePatches([
      {
        filename: "src/a.ts",
        status: "modified",
        patch:
          "@@ -10,2 +10,3 @@ fn\n-old one\n-old two\n+new one\n+new two\n+new three\n@@ -30 +31 @@\n-x\n+y\n\\ No newline at end of file",
      },
    ]);
    for (let line = 1; line < 40; line++) {
      expect(patched.touches("src/a.ts", line)).toBe(parsed.touches("src/a.ts", line));
    }
  });

  it("counts only plus lines when the patch carries context", () => {
    const changes = UnifiedDiffChanges.fromFilePatches([
      {
        filename: "c.ts",
        status: "modified",
        patch: "@@ -1,5 +1,5 @@\n one\n two\n-three\n+THREE\n four\n five",
      },
    ]);
    expect(changes.touches("c.ts", 3)).toBe(true);
    expect(changes.touches("c.ts", 2, 1)).toBe(false);
    expect(changes.touches("c.ts", 5, 4)).toBe(false);
  });

  it("marks neighbours of a deletion between context lines", () => {
    const changes = UnifiedDiffChanges.fromFilePatches([
      { filename: "d.ts", status: "modified", patch: "@@ -1,4 +1,3 @@\n a\n b\n-c\n d" },
    ]);
    expect(changes.touches("d.ts", 3, 2)).toBe(true);
    expect(changes.touches("d.ts", 1)).toBe(false);
  });

  it("treats added files, and entries without a patch, as wholly changed", () => {
    const changes = UnifiedDiffChanges.fromFilePatches([
      { filename: "new.ts", status: "added", patch: "@@ -0,0 +1 @@\n+a" },
      { filename: "big.bin", status: "modified" },
    ]);
    expect(changes.touches("new.ts", 99)).toBe(true);
    expect(changes.touches("big.bin", 99)).toBe(true);
  });

  it("skips removed files and leaves pure renames unchanged under the new path", () => {
    const changes = UnifiedDiffChanges.fromFilePatches([
      { filename: "gone.ts", status: "removed", patch: "@@ -1 +0,0 @@\n-a" },
      { filename: "new.ts", previous_filename: "old.ts", status: "renamed", changes: 0 },
    ]);
    expect(changes.touches("gone.ts", 1)).toBe(false);
    expect(changes.touches("new.ts", 1)).toBe(false);
  });

  it("treats a renamed file with edits but no patch as wholly changed", () => {
    const changes = UnifiedDiffChanges.fromFilePatches([
      { filename: "new.ts", previous_filename: "old.ts", status: "renamed", changes: 40 },
    ]);
    expect(changes.touches("new.ts", 3)).toBe(true);
  });

  it("treats a renamed file with no patch and no change count as wholly changed", () => {
    const changes = UnifiedDiffChanges.fromFilePatches([
      { filename: "new.ts", previous_filename: "old.ts", status: "renamed" },
    ]);
    expect(changes.touches("new.ts", 3)).toBe(true);
  });
});
