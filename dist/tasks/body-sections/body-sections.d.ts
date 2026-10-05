export type BodyFormat = 'layered-body' | 'bug-report';
export type SectionKey = 'problemStatement' | 'solution' | 'acceptanceCriteria' | 'technicalWriteup' | 'guidedWalkthrough' | 'symptom' | 'environment' | 'stepsToReproduce' | 'expectedVsActual' | 'rootCause' | 'fixedWhen' | 'evidence' | 'reproductionNotes';
export interface AcceptanceCriterion {
    text: string;
    done: boolean;
}
export interface SectionSourceInput {
    body: string;
    format?: BodyFormat;
}
export interface BodySections {
    format: BodyFormat;
    problemStatement?: string;
    solution?: string;
    acceptanceCriteria?: string;
    technicalWriteup?: string;
    guidedWalkthrough?: string;
    symptom?: string;
    environment?: string;
    stepsToReproduce?: string;
    expectedVsActual?: string;
    rootCause?: string;
    fixedWhen?: string;
    evidence?: string;
    reproductionNotes?: string;
    acceptanceCriteriaItems: AcceptanceCriterion[];
    fixedWhenItems: AcceptanceCriterion[];
}
export interface SectionReadResult {
    id: string;
    section: string;
    format: BodyFormat;
    markdown: string | null;
    items?: AcceptanceCriterion[];
}
export interface SectionSource {
    read(input: SectionSourceInput): BodySections;
}
/**
 * Reads a body blob into its named prose sections and the two checklists it can
 * carry. It recognizes both the layered-body headings (docs/layered-body-format.md)
 * and the Bug Report headings (docs/bug-report-format.md), choosing the map from
 * the caller-supplied `format` or, when absent, from a leading `## Symptom` sniff.
 * Sections are delimited strictly between one heading (or a matching details
 * block) and the next boundary, so the raw LLM-Context YAML that GitHub bodies
 * carry — and Jira bodies strip — is consumed and never bleeds into a section.
 * The Guided Walkthrough and Reproduction Notes blocks may be hint-only or
 * absent; that is a valid state, not an error. A field-backed source that reads
 * the same sections straight from tracker fields is the planned sibling.
 */
export declare class BlobSectionSource implements SectionSource {
    read(input: SectionSourceInput): BodySections;
    /**
     * Classifies the body from its FIRST top-level `##` heading, not from any
     * occurrence anywhere: a bug report leads with `## Symptom`, a layered body
     * with `## Problem Statement`. A `## Symptom` buried inside a fenced code
     * block or a `<details>` block (e.g. the Guided Walkthrough) must not flip a
     * layered body to `bug-report`, so both are skipped exactly as the section
     * parser skips them — details via `consumeDetails`, fences by tracking the
     * open marker.
     */
    private sniff;
    private checklistItems;
    private consumeDetails;
}
export declare const blobSectionSource: SectionSource;
export interface SectionSelector {
    select(id: string, sections: BodySections, slug: string): SectionReadResult;
}
/**
 * Turns a read `BodySections` and a `--section` slug into the CLI's section
 * result. `markdown` is null when the detected format does not carry the
 * requested section; the checklist slugs also surface their parsed `items`.
 */
export declare class BodySectionSelector implements SectionSelector {
    select(id: string, sections: BodySections, slug: string): SectionReadResult;
}
export declare const sectionSelector: SectionSelector;
