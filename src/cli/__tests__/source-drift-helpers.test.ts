import { describe, expect, it } from "vitest";
import { sourceFailures, unresolvedWorkers, workerReferences } from "./source-drift-helpers.js";

describe("source drift regression controls", () => {
  it.each([
    ["Call the `AskUserQuestion` tool.", "shared capability"],
    ["Use sonnet for this task.", "neutral tier"],
    ["Read ${CLAUDE_PLUGIN_ROOT}/docs/charter.md", "flight-rules doc"],
    ["Write .claude/flight-rules.local.md", "flight-rules config path"],
    ["Read .claude/flight-rules.qa.md", "config show"],
  ])("reports an actionable source location for %s", (line, remedy) => {
    expect(sourceFailures("skills/future/SKILL.md", `# Future\n${line}`)).toEqual([
      expect.stringContaining("skills/future/SKILL.md:2:"),
    ]);
    expect(sourceFailures("skills/future/SKILL.md", line)[0]).toContain(remedy);
  });

  it.each([
    "Dispatch `future-specialist`.",
    "Dispatch the **`future-specialist`** agent.",
    "Use `dispatch` with the named `future-specialist` registration.",
    "Use `dispatch` with `future-specialist`.",
    "The `future-specialist` worker returns a report.",
    "| Attempt | Agent | Tier |\n| --- | --- | --- |\n| 1 | `future-specialist` | standard |",
  ])("detects a novel missing worker in %s", (contents) => {
    const names = new Set<string>();
    const references = workerReferences("skills/future/SKILL.md", contents, names);
    expect(references.map((reference) => reference.name)).toEqual(["future-specialist"]);
    expect(unresolvedWorkers(references, names)[0]).toMatch(/skills\/future\/SKILL.md:\d+: unknown worker future-specialist; add/);
    expect(unresolvedWorkers(references, new Set(["future-specialist"]))).toEqual([]);
  });

  it("enumerates future registry names without interpreting unrelated inline values as agents", () => {
    const names = new Set(["future-specialist", "another-new-role"]);
    const contents = "Read `coding-charter`, then use `future-specialist`. The `PASS` result has `filesChanged`.\nRun the sibling `execute-work` skill.";
    expect(workerReferences("skill.md", contents, names).map((reference) => reference.name)).toEqual(["future-specialist"]);
    expect(sourceFailures("skill.md", contents)).toEqual([]);
  });
});
