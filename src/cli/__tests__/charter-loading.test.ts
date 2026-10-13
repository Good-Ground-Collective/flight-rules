import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const filesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
const files = ["skills", "agents", "docs"].flatMap((directory) => filesIn(join(root, directory)));

describe("coding charters load through flight-rules charter", () => {
  it("never loads a charter document on its own", () => {
    const loads = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /\bdoc\s+coding-charter\b/.test(line) ? [`${relative(root, file)}:${index + 1}`] : [],
        ),
    );
    expect(loads).toEqual([]);
  });

  it("is how every agent and skill that applies the charter loads it", () => {
    const consumers = [
      "agents/code-implementation.md",
      "agents/code-verifier.md",
      "skills/execute-work/SKILL.md",
      "skills/guided-code-review/SKILL.md",
      "skills/autonomous-code-review/SKILL.md",
    ];
    for (const consumer of consumers) {
      expect(readFileSync(join(root, consumer), "utf8"), consumer).toMatch(/flight-rules charter\b/);
    }
  });
});
