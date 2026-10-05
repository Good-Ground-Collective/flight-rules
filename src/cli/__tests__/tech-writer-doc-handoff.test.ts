import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileDocResolver } from "../../bundled-docs/doc-resolver/doc-resolver.js";

const root = join(import.meta.dirname, "..", "..", "..");
const writer = readFileSync(join(root, "agents/tech-writer.md"), "utf8");
const resolver = new FileDocResolver({ docsDir: join(root, "docs") });

describe("read-only tech-writer document handoff", () => {
  it("keeps the writer read-only and free of CLI instructions", () => {
    expect(writer).toMatch(/^tools: Glob, Grep, LS, Read$/m);
    expect(writer).not.toMatch(/flight-rules doc/);
    expect(writer).toMatch(/Read both required files in full/);
    expect(writer).toMatch(/Use Read to read that file in full before drafting/);
  });

  it.each([
    { skill: "review-prose", heading: "## Step 2: Dispatch the agent", author: false },
    { skill: "execute-work", heading: "**Write the PR body", author: true },
  ])("$skill resolves readable documents before dispatch", ({ skill, heading, author }) => {
    const source = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    const dispatch = source.slice(source.indexOf(heading));
    const handoff = dispatch.split(author ? "It returns YAML" : "## Step 3")[0] ?? "";
    const ids = [...handoff.matchAll(/^flight-rules doc ([a-z-]+) --path$/gm)]
      .map((match) => match[1]);
    const required = ["prose-charter", "claudeish-tells", "google-style-digest"];
    if (author) required.push("pr-body-format");

    expect(ids.toSorted()).toEqual(required.toSorted());
    for (const id of required) {
      const doc = resolver.resolve(id);
      expect(() => accessSync(doc.path, constants.R_OK)).not.toThrow();
      expect(doc.contents.trim()).not.toBe("");
    }
    expect(handoff).toContain("Pass the printed paths, labelled by document id");
    expect(handoff).toContain("must read the required files in full");
    expect(handoff).toContain("optional digest in full only when needed");
  });
});
