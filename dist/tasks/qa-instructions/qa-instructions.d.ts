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
export interface QaInstructionsFinderProps {
    fs?: QaFileSystem;
}
/**
 * Finds the freeform QA instructions that apply to a directory. Walks from the
 * directory up to the git repository root and takes, at each level, the first
 * of: a "QA" section in AGENTS.md, a QA.md, a .agents/QA.md. Sources come back
 * nearest first, so a subproject's instructions precede the repository's.
 */
export declare class QaInstructionsFinder {
    private readonly fs;
    constructor(props?: QaInstructionsFinderProps);
    discover(input: QaDiscoverInput): QaInstructions;
    /**
     * Extracts the body of the first heading whose text is exactly "QA" (any
     * case, any level), up to the next heading of the same or a higher level.
     * Headings inside fenced code blocks are ignored. Returns undefined when the
     * section is absent or empty.
     */
    extractQaSection(markdown: string): string | undefined;
    /** The start directory and each parent up to the repository root; only the start when no root is found. */
    private levels;
    private sourceAt;
    private fileSource;
    private legacySource;
}
