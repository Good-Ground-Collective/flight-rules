import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const filesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return entry.isFile() ? [path] : [];
  });
const files = ["skills", "agents", "docs"].flatMap((directory) => filesIn(join(root, directory)));

const locationsContaining = (pattern: RegExp): string[] =>
  files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(root, file)}:${index + 1}`] : [],
      ),
  );

describe("document references are host neutral", () => {
  it("finds skills, agents, and docs to check", () => {
    for (const directory of ["skills", "agents", "docs"]) {
      expect(files.some((file) => relative(root, file).startsWith(`${directory}/`))).toBe(true);
    }
  });

  it("does not resolve docs through the Claude plugin root", () => {
    expect(locationsContaining(/CLAUDE_PLUGIN_ROOT}\/docs/)).toEqual([]);
  });

  it("allows only the two setup binary PATH references", () => {
    const failures = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => {
          const references = [...line.matchAll(/CLAUDE_PLUGIN_ROOT/g)];
          if (references.length === 0) return [];
          const allowed =
            relative(root, file) === "skills/setup/SKILL.md" &&
            index === 25 &&
            references.length === 2 &&
            [...line.matchAll(/CLAUDE_PLUGIN_ROOT}\/bin/g)].length === 2;
          return allowed ? [] : [`${relative(root, file)}:${index + 1}`];
        }),
    );
    expect(failures).toEqual([]);
    const setup = readFileSync(join(root, "skills/setup/SKILL.md"), "utf8");
    expect([...setup.matchAll(/CLAUDE_PLUGIN_ROOT/g)]).toHaveLength(2);
  });
});

describe("config references are host neutral", () => {
  it("does not hard-code the Claude config path", () => {
    expect(locationsContaining(/\.claude\/flight-rules\.local\.md/)).toEqual([]);
  });

  it("does not hard-code the Claude QA recipe path", () => {
    expect(locationsContaining(/\.claude\/flight-rules\.qa\.md/)).toEqual([]);
  });
});
