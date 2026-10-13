import type { DocResolver } from '../doc-resolver/doc-resolver.js';
/** One charter document: the always-applicable core (`language: null`) or a language charter scoped by globs. */
export interface Charter {
    id: string;
    language: string | null;
    appliesTo: string[];
    /** Tier A mandate IDs from the charter's Review tiers section, in table order. */
    tierA: string[];
    path: string;
    contents: string;
}
/** Selects the coding charters that govern a set of repository-relative paths. */
export interface CharterCatalog {
    /** The core charter followed by every language charter, sorted by id. */
    all(): Charter[];
    /** The core charter followed by each language charter whose globs match at least one path. */
    select(paths: readonly string[]): Charter[];
}
export interface DocCharterCatalogProps {
    docs: DocResolver;
}
/** Reads charters from bundled docs: `coding-charter` is the core, `coding-charter-<language>` a language charter. */
export declare class DocCharterCatalog implements CharterCatalog {
    private readonly docs;
    constructor(props: DocCharterCatalogProps);
    all(): Charter[];
    select(paths: readonly string[]): Charter[];
    private languageCharter;
    private tierA;
}
export declare class CharterFormatError extends Error {
    name: string;
}
