import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type QaSourceKind = "agents-md-section" | "qa-md" | "agents-dir-qa-md" | "legacy-recipe";

export interface QaSource {
  path: string;
  kind: QaSourceKind;
  dir: string;
  content: string;
  legacy?: true;
  hint?: string;
}

export interface QaInstructions {
  found: boolean;
  sources: QaSource[];
}

/** The filesystem reads discovery needs, injectable so tests run against an in-memory tree. */
export interface QaFileSystem {
  isFile(path: string): boolean;
  exists(path: string): boolean;
  readFile(path: string): string;
}

export interface QaDiscoverInput {
  from: string;
  legacyRecipePath?: string | undefined;
}

/** An ATX heading: one to six hashes, a space, the text, and an optional closing run of hashes. */
const atxHeading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Up to three leading spaces, then a run of three or more backticks or tildes. */
const fenceRun = /^ {0,3}(`{3,}|~{3,})/;

const legacyHint =
  'Legacy QA recipe in use. Move its content into a QA.md at the repo root (or a "QA" section of AGENTS.md); see docs/qa-instructions.md.';

const nodeFileSystem: QaFileSystem = {
  isFile: (path) => existsSync(path) && statSync(path).isFile(),
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, "utf8"),
};

export interface QaInstructionsFinderProps {
  fs?: QaFileSystem;
}

/**
 * Finds the freeform QA instructions that apply to a directory. Walks from the
 * directory up to the git repository root and takes, at each level, the first
 * of: a "QA" section in AGENTS.md, a QA.md, a .agents/QA.md. Sources come back
 * nearest first, so a subproject's instructions precede the repository's.
 */
export class QaInstructionsFinder {
  private readonly fs: QaFileSystem;

  constructor(props: QaInstructionsFinderProps = {}) {
    this.fs = props.fs ?? nodeFileSystem;
  }

  discover(input: QaDiscoverInput): QaInstructions {
    const sources = this.levels(input.from)
      .map((dir) => this.sourceAt(dir))
      .filter((source) => source !== undefined);
    if (sources.length > 0) return { found: true, sources };

    const legacy = this.legacySource(input.legacyRecipePath);
    if (legacy !== undefined) return { found: true, sources: [legacy] };
    return { found: false, sources: [] };
  }

  /**
   * Extracts the body of the first heading whose text is exactly "QA" (any
   * case, any level), up to the next heading of the same or a higher level.
   * Headings inside fenced code blocks are ignored. Returns undefined when the
   * section is absent or empty.
   */
  extractQaSection(markdown: string): string | undefined {
    const lines = markdown.split("\n");
    let openFence: string | null = null;
    let sectionLevel: number | null = null;
    const body: string[] = [];

    for (const line of lines) {
      const fence = fenceRun.exec(line)?.[1];
      if (fence !== undefined) {
        if (openFence === null) openFence = fence;
        else if (fence[0] === openFence[0] && fence.length >= openFence.length) openFence = null;
        if (sectionLevel !== null) body.push(line);
        continue;
      }
      const heading = openFence === null ? atxHeading.exec(line) : null;
      if (heading !== null) {
        const level = heading[1]?.length ?? 0;
        if (sectionLevel !== null && level <= sectionLevel) break;
        if (sectionLevel === null && (heading[2] ?? "").trim().toLowerCase() === "qa") {
          sectionLevel = level;
          continue;
        }
      }
      if (sectionLevel !== null) body.push(line);
    }

    const content = body.join("\n").trim();
    return content.length > 0 ? content : undefined;
  }

  /** The start directory and each parent up to the repository root; only the start when no root is found. */
  private levels(from: string): string[] {
    const absolute = resolve(from);
    const start = this.fs.isFile(absolute) ? dirname(absolute) : absolute;
    const levels: string[] = [];
    let current = start;
    for (;;) {
      levels.push(current);
      if (this.fs.exists(join(current, ".git"))) return levels;
      const parent = dirname(current);
      if (parent === current) return [start];
      current = parent;
    }
  }

  private sourceAt(dir: string): QaSource | undefined {
    const agentsMd = join(dir, "AGENTS.md");
    if (this.fs.isFile(agentsMd)) {
      const section = this.extractQaSection(this.fs.readFile(agentsMd));
      if (section !== undefined)
        return { path: agentsMd, kind: "agents-md-section", dir, content: section };
    }
    return (
      this.fileSource(join(dir, "QA.md"), "qa-md", dir) ??
      this.fileSource(join(dir, ".agents", "QA.md"), "agents-dir-qa-md", dir)
    );
  }

  private fileSource(path: string, kind: QaSourceKind, dir: string): QaSource | undefined {
    if (!this.fs.isFile(path)) return undefined;
    const content = this.fs.readFile(path).trim();
    return content.length > 0 ? { path, kind, dir, content } : undefined;
  }

  private legacySource(path: string | undefined): QaSource | undefined {
    if (path === undefined) return undefined;
    const source = this.fileSource(path, "legacy-recipe", dirname(path));
    return source === undefined ? undefined : { ...source, legacy: true, hint: legacyHint };
  }
}
