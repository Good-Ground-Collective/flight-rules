import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  instructionCatalog,
  FileInstructionCatalog,
  UnsafeInstructionPathError,
  UnknownInstructionError,
} from "../instruction-catalog.js";
import { InvalidWorkerReportError, ReportModeSchema, WorkerReportCodec } from "../report-codec.js";

const temporaryRoots: string[] = [];
const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "flight-rules-sdk-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("neutral SDK instruction catalog", () => {
  it("lists canonical skills and all named agent variants with unchanged prompt bodies", () => {
    expect(instructionCatalog.listSkills()).toContain("execute-work");
    expect(instructionCatalog.listAgents()).toEqual([
      "code-implementation",
      "code-implementation-escalated",
      "code-verifier",
      "qa-engineer",
      "qa-engineer-verify",
      "research-agent",
      "tech-writer",
    ]);
    const canonical = instructionCatalog.loadAgent("qa-engineer");
    expect(instructionCatalog.loadAgent("qa-engineer-verify").body).toBe(canonical.body);
    const raw = readFileSync(new URL("../../../agents/qa-engineer.md", import.meta.url), "utf8");
    expect(canonical.body).toBe(raw.replace(/^---\r?\n[\s\S]*?^---(?:\r?\n|$)/m, ""));
  });

  it("loads from an unrelated working directory using the installation override", () => {
    const root = makeRoot();
    mkdirSync(join(root, "skills", "sample"), { recursive: true });
    mkdirSync(join(root, "bin", "resources", "agents"), { recursive: true });
    writeFileSync(join(root, "skills", "sample", "SKILL.md"), "Canonical bytes\n");
    copyFileSync(
      new URL("../../../agents/variants.json", import.meta.url),
      join(root, "bin/resources/agents/variants.json"),
    );
    for (const name of [
      "code-implementation",
      "code-verifier",
      "qa-engineer",
      "research-agent",
      "tech-writer",
    ]) {
      copyFileSync(
        new URL(`../../../agents/${name}.md`, import.meta.url),
        join(root, `bin/resources/agents/${name}.md`),
      );
    }
    const catalog = new FileInstructionCatalog({
      moduleUrl: pathToFileURL(join(root, "somewhere", "sdk.js")).href,
      env: { FLIGHT_RULES_HOME: root },
    });
    expect(catalog.listSkills()).toEqual(["sample"]);
    expect(catalog.loadSkill("sample").contents).toBe("Canonical bytes\n");
    expect(() => catalog.loadSkill("unknown")).toThrow(UnknownInstructionError);
    expect(() => catalog.loadSkill("../sample")).toThrow(UnsafeInstructionPathError);
  });

  it("rejects skill symlinks that resolve outside the installed skill", () => {
    const root = makeRoot();
    mkdirSync(join(root, "skills", "sample"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(join(root, "outside.md"), "escaped");
    symlinkSync(join(root, "outside.md"), join(root, "skills", "sample", "SKILL.md"));
    writeFileSync(join(root, "agents", "variants.json"), "[]");
    const catalog = new FileInstructionCatalog({
      moduleUrl: pathToFileURL(join(root, "sdk.js")).href,
      env: { FLIGHT_RULES_HOME: root },
    });
    expect(() => catalog.loadSkill("sample")).toThrow(UnsafeInstructionPathError);
  });

  it("rejects an installation skill directory that resolves outside the installation home", () => {
    const root = makeRoot();
    const outside = makeRoot();
    mkdirSync(join(outside, "escape"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(join(outside, "escape", "SKILL.md"), "Outside resource");
    writeFileSync(join(root, "agents", "variants.json"), "[]");
    symlinkSync(outside, join(root, "skills"));

    expect(
      () =>
        new FileInstructionCatalog({
          moduleUrl: pathToFileURL(join(root, "sdk.js")).href,
          env: { FLIGHT_RULES_HOME: root },
        }),
    ).toThrow(UnsafeInstructionPathError);
  });
});

describe("worker report codec", () => {
  const codec = new WorkerReportCodec();

  it("validates implementation and each required research mode slot", () => {
    expect(
      codec.parse("```yaml\nsummary: Done\nfilesChanged: []\ntestsRun: []\napproach: Direct\n```", {
        agent: "code-implementation",
        mode: "implement",
      }),
    ).toMatchObject({ summary: "Done" });
    expect(() =>
      codec.parse("```yaml\nsummary: Research\nconfidence: high\ninternal: {}\n```", {
        agent: "research-agent",
        mode: "mixed",
      }),
    ).toThrow(InvalidWorkerReportError);
  });

  it("accepts canonical inline rewrite reports and a research prose preamble", () => {
    const rewritten = {
      summary: "Rewritten inline text",
      verdict: "MINOR",
      rewritten: "The revised paragraph.",
      preserved: ["The direct opening."],
    };
    expect(
      codec.parse(
        `\`\`\`yaml\n${JSON.stringify(rewritten)}\n\`\`\``,
        { agent: "tech-writer", mode: "rewrite" },
      ),
    ).toEqual(rewritten);

    const research = {
      summary: "The feature is supported.",
      confidence: "high",
      external: { answer: "Yes", sources: [], exampleUsage: null, caveats: [] },
    };
    expect(
      codec.parse(
        `Here is the research result.\n\n\`\`\`yaml\n${JSON.stringify(research)}\n\`\`\``,
        { agent: "research-agent", mode: "external" },
      ),
    ).toEqual(research);

    expect(() =>
      codec.parse(
        `Research complete.\n\n\`\`\`yaml\n${JSON.stringify(research)}\n\`\`\`\nMore prose`,
        { agent: "research-agent", mode: "external" },
      ),
    ).toThrow(InvalidWorkerReportError);
  });

  it("requires exactly one canonical rewrite payload", () => {
    const base = { summary: "Updated", verdict: "MINOR", preserved: [] };
    for (const payload of [
      { ...base },
      { ...base, changes: [], rewritten: "Inline text" },
    ]) {
      expect(() =>
        codec.parse(
          `\`\`\`yaml\n${JSON.stringify(payload)}\n\`\`\``,
          { agent: "tech-writer", mode: "rewrite" },
        ),
      ).toThrow(InvalidWorkerReportError);
    }
  });

  it.each([
    [
      "code-verifier",
      "verify",
      {
        summary: "Checked",
        criteria: [{ criterion: "Works", verdict: "PASS", evidence: "Observed" }],
        verified: true,
      },
    ],
    [
      "research-agent",
      "internal",
      {
        summary: "Found it",
        confidence: "high",
        internal: { files: [], patterns: [], integrationPoints: [], risks: [] },
      },
    ],
    [
      "research-agent",
      "external",
      {
        summary: "Found it",
        confidence: "med",
        external: { answer: "Yes", sources: [], exampleUsage: null, caveats: [] },
      },
    ],
    [
      "research-agent",
      "mixed",
      {
        summary: "Found it",
        confidence: "high",
        internal: { files: [], patterns: [], integrationPoints: [], risks: [] },
        external: { answer: "Yes", sources: [], exampleUsage: null, caveats: [] },
      },
    ],
    [
      "qa-engineer",
      "reproduce",
      {
        summary: "Seen",
        reproduced: true,
        steps: ["Run"],
        after: ["Clear"],
        rootCause: "Cause",
        trapForQA: "Trap",
        fixedWhen: ["Gone"],
        evidence: { dir: "/tmp/evidence", items: [] },
      },
    ],
    [
      "qa-engineer-verify",
      "verify",
      {
        summary: "Checked",
        items: [{ item: "Works", verdict: "PASS", evidence: "Observed" }],
        evidence: { dir: "/tmp/evidence", items: [] },
        verified: true,
      },
    ],
    [
      "tech-writer",
      "feedback",
      { summary: "Clean", verdict: "CLEAN", findings: [], strengths: [] },
    ],
    [
      "tech-writer",
      "rewrite",
      { summary: "Updated", verdict: "MINOR", changes: [], preserved: [] },
    ],
    [
      "tech-writer",
      "author",
      {
        summary: "Drafted",
        whatWasChanged: ["SDK"],
        whyWasItChanged: "Access",
        otsMaterials: "No visual evidence",
      },
    ],
  ] as const)("validates %s %s reports against canonical slots", (agent, mode, report) => {
    const yaml = `\`\`\`yaml\n${JSON.stringify(report)}\n\`\`\``;
    expect(codec.parse(yaml, ReportModeSchema.parse({ agent, mode }))).toEqual(report);
  });

  it("rejects multiple final reports, malformed YAML, and non-JSON values", () => {
    expect(() =>
      codec.parse("```yaml\nsummary: A\n```\n```yaml\nsummary: B\n```", {
        agent: "code-implementation",
        mode: "implement",
      }),
    ).toThrow(InvalidWorkerReportError);
    expect(() =>
      codec.parse("```yaml\nsummary: [\n```", { agent: "code-implementation", mode: "implement" }),
    ).toThrow(InvalidWorkerReportError);
    expect(() =>
      codec.parse(
        "```yaml\nsummary: .inf\nfilesChanged: []\ntestsRun: []\napproach: Direct\n```",
        { agent: "code-implementation", mode: "implement" },
      ),
    ).toThrow(InvalidWorkerReportError);
    expect(() =>
      codec.parse(
        "```yaml\nsummary: Done\nfilesChanged: []\ntestsRun: []\napproach: Direct\n```\nextra text",
        { agent: "code-implementation", mode: "implement" },
      ),
    ).toThrow(InvalidWorkerReportError);
    expect(() =>
      codec.parse(
        "```yaml\nsummary: Done\nconfidence: high\nexternal: { answer: Yes, sources: [], exampleUsage: null, caveats: [] }\n```\n```yaml\nsummary: duplicate\n```",
        { agent: "research-agent", mode: "external" },
      ),
    ).toThrow(InvalidWorkerReportError);
    expect(() =>
      codec.parse(
        `\`\`\`yaml\n${JSON.stringify({
          summary: "Drafted",
          whatWasChanged: ["x".repeat(257)],
          whyWasItChanged: "Reason",
          otsMaterials: "No visual evidence: not needed",
        })}\n\`\`\``,
        { agent: "tech-writer", mode: "author" },
      ),
    ).toThrow(InvalidWorkerReportError);
  });

  it("accepts the 256-character author bullet limit", () => {
    const report = {
      summary: "Drafted",
      whatWasChanged: ["x".repeat(256)],
      whyWasItChanged: "Reason",
      otsMaterials: "No visual evidence: not needed",
    };
    expect(
      codec.parse(
        `\`\`\`yaml\n${JSON.stringify(report)}\n\`\`\``,
        { agent: "tech-writer", mode: "author" },
      ),
    ).toEqual(report);
  });
});
