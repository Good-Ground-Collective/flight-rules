import { describe, it, expect } from "vitest";
import { QaInstructionsFinder, type QaFileSystem } from "../qa-instructions.js";

/** An in-memory tree: keys are absolute file paths, plus `.git` markers. */
const memoryFs = (files: Record<string, string>): QaFileSystem => ({
  isFile: (path) => path in files && !path.endsWith("/.git"),
  exists: (path) => path in files,
  readFile: (path) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  },
});

const finder = (files: Record<string, string>): QaInstructionsFinder =>
  new QaInstructionsFinder({ fs: memoryFs(files) });

describe("QaInstructionsFinder.discover", () => {
  it("finds a QA section in AGENTS.md", () => {
    const result = finder({
      "/repo/.git": "",
      "/repo/AGENTS.md": "# Repo\n\nIntro.\n\n## QA\n\nHit staging.\n\n## Other\n\nNot QA.\n",
    }).discover({ from: "/repo" });
    expect(result).toEqual({
      found: true,
      sources: [
        {
          path: "/repo/AGENTS.md",
          kind: "agents-md-section",
          dir: "/repo",
          content: "Hit staging.",
        },
      ],
    });
  });

  it("finds QA.md at the root", () => {
    const result = finder({ "/repo/.git": "", "/repo/QA.md": "Use the API.\n" }).discover({
      from: "/repo",
    });
    expect(result.sources).toEqual([
      { path: "/repo/QA.md", kind: "qa-md", dir: "/repo", content: "Use the API." },
    ]);
  });

  it("finds .agents/QA.md", () => {
    const result = finder({ "/repo/.git": "", "/repo/.agents/QA.md": "Salesforce org." }).discover({
      from: "/repo",
    });
    expect(result.sources[0]?.kind).toBe("agents-dir-qa-md");
    expect(result.sources[0]?.path).toBe("/repo/.agents/QA.md");
  });

  it("prefers the AGENTS.md section, then QA.md, then .agents/QA.md at one level", () => {
    const all = {
      "/repo/.git": "",
      "/repo/AGENTS.md": "## QA\n\nfrom agents\n",
      "/repo/QA.md": "from qa",
      "/repo/.agents/QA.md": "from dot-agents",
    };
    expect(
      finder(all)
        .discover({ from: "/repo" })
        .sources.map((s) => s.content),
    ).toEqual(["from agents"]);

    const noSection = { ...all, "/repo/AGENTS.md": "# Repo\n\nNo QA here.\n" };
    expect(
      finder(noSection)
        .discover({ from: "/repo" })
        .sources.map((s) => s.content),
    ).toEqual(["from qa"]);

    const onlyDotAgents: Record<string, string> = { ...noSection };
    delete onlyDotAgents["/repo/QA.md"];
    expect(
      finder(onlyDotAgents)
        .discover({ from: "/repo" })
        .sources.map((s) => s.content),
    ).toEqual(["from dot-agents"]);
  });

  it("returns one source per level, nearest first, stopping at the repo root", () => {
    const result = finder({
      "/QA.md": "outside the repo",
      "/repo/.git": "",
      "/repo/QA.md": "root",
      "/repo/packages/api/AGENTS.md": "## QA\n\nsubproject\n",
      "/repo/packages/api/src/handler.ts": "export {}",
    }).discover({ from: "/repo/packages/api/src" });
    expect(result.sources.map((s) => [s.dir, s.content])).toEqual([
      ["/repo/packages/api", "subproject"],
      ["/repo", "root"],
    ]);
  });

  it("starts from the containing directory when given a file path", () => {
    const result = finder({
      "/repo/.git": "",
      "/repo/pkg/QA.md": "pkg",
      "/repo/pkg/index.ts": "",
    }).discover({ from: "/repo/pkg/index.ts" });
    expect(result.sources.map((s) => s.content)).toEqual(["pkg"]);
  });

  it("checks only the start directory when no repo root exists", () => {
    const result = finder({ "/QA.md": "far away", "/work/QA.md": "here" }).discover({
      from: "/work",
    });
    expect(result.sources.map((s) => s.content)).toEqual(["here"]);
  });

  it("skips empty files and empty sections", () => {
    const result = finder({
      "/repo/.git": "",
      "/repo/AGENTS.md": "## QA\n\n## Next\n",
      "/repo/QA.md": "   \n",
      "/repo/.agents/QA.md": "real",
    }).discover({ from: "/repo" });
    expect(result.sources.map((s) => s.content)).toEqual(["real"]);
  });

  it("falls back to the legacy recipe flagged legacy with a hint", () => {
    const result = finder({
      "/repo/.git": "",
      "/repo/.claude/flight-rules.qa.md": "---\napp: web\n---\n",
    }).discover({ from: "/repo", legacyRecipePath: "/repo/.claude/flight-rules.qa.md" });
    expect(result.found).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      kind: "legacy-recipe",
      legacy: true,
      path: "/repo/.claude/flight-rules.qa.md",
    });
    expect(result.sources[0]?.hint).toContain("QA.md");
  });

  it("ignores the legacy recipe when new instructions exist", () => {
    const result = finder({
      "/repo/.git": "",
      "/repo/QA.md": "new",
      "/repo/.claude/flight-rules.qa.md": "old",
    }).discover({ from: "/repo", legacyRecipePath: "/repo/.claude/flight-rules.qa.md" });
    expect(result.sources.map((s) => s.kind)).toEqual(["qa-md"]);
  });

  it("reports found false with no sources when nothing exists", () => {
    expect(
      finder({ "/repo/.git": "" }).discover({ from: "/repo", legacyRecipePath: "/repo/x.md" }),
    ).toEqual({
      found: false,
      sources: [],
    });
  });
});

describe("QaInstructionsFinder.extractQaSection", () => {
  const extract = (md: string): string | undefined =>
    new QaInstructionsFinder().extractQaSection(md);

  it("runs to the next heading of the same or higher level, keeping deeper subheadings", () => {
    const md = "# Top\n\n## QA\n\nIntro.\n\n### Logins\n\nUse SSO bypass.\n\n## Deploy\n\nNope.\n";
    expect(extract(md)).toBe("Intro.\n\n### Logins\n\nUse SSO bypass.");
  });

  it("ends at a higher-level heading", () => {
    expect(extract("### QA\n\nbody\n\n# Next\n\nafter\n")).toBe("body");
  });

  it("matches the heading text case-insensitively and exactly", () => {
    expect(extract("## qa\n\nlower\n")).toBe("lower");
    expect(extract("## QA notes\n\nnope\n")).toBeUndefined();
    expect(extract("## QA ##\n\nclosed\n")).toBe("closed");
  });

  it("ignores headings inside fenced code blocks", () => {
    const md =
      "```md\n## QA\nfake\n```\n\n## QA\n\nreal\n\n```sh\n# comment, not a heading\n```\n\n## End\n";
    expect(extract(md)).toBe("real\n\n```sh\n# comment, not a heading\n```");
  });

  it("returns undefined without a QA heading", () => {
    expect(extract("# Repo\n\nNothing.\n")).toBeUndefined();
  });
});
