import { z } from 'zod';
/**
 * The validated shape of a pull request the CLI will open. Title parts mirror
 * the conventional-commit vocabulary; the body parts render to the four
 * human-facing sections (What / Why / OTS Materials / Ticket Link) defined in
 * docs/pr-body-format.md; branch/reviewer/label fields are PR API parameters,
 * not body content.
 *
 * The prose fields (`whatWasChanged`, `whyWasItChanged`, `otsMaterials`) are
 * authored upstream by the tech-writer agent — this schema guarantees the
 * skeleton and the length budget, not the wording.
 */
export declare const PullRequestTemplateSchema: z.ZodObject<{
    type: z.ZodEnum<{
        docs: "docs";
        feat: "feat";
        fix: "fix";
        perf: "perf";
        refactor: "refactor";
        test: "test";
        build: "build";
        ci: "ci";
        chore: "chore";
        style: "style";
        revert: "revert";
    }>;
    scope: z.ZodString;
    description: z.ZodString;
    whatWasChanged: z.ZodArray<z.ZodString>;
    whyWasItChanged: z.ZodString;
    otsMaterials: z.ZodOptional<z.ZodString>;
    ticketId: z.ZodOptional<z.ZodString>;
    ticketUrl: z.ZodOptional<z.ZodURL>;
    baseBranch: z.ZodString;
    headBranch: z.ZodString;
    reviewers: z.ZodDefault<z.ZodArray<z.ZodString>>;
    labels: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type PullRequestTemplate = z.infer<typeof PullRequestTemplateSchema>;
export interface RenderedPullRequest {
    title: string;
    body: string;
}
export interface PullRequestBuilder {
    build(input: PullRequestTemplate): RenderedPullRequest;
}
/**
 * Renders a validated template into a deterministic PR title and markdown body.
 * Same input always yields byte-identical output. The "What Was Changed" and
 * "Why Was It Changed" sections are always present (their fields are required);
 * "OTS Materials" and "Ticket Link" appear only when their fields are supplied.
 */
export declare class DefaultPullRequestBuilder implements PullRequestBuilder {
    build(input: PullRequestTemplate): RenderedPullRequest;
    /**
     * A markdown link when a URL is present, the bare id when only an id is, the
     * bare URL when only a URL is, and nothing when neither is — so the section
     * is omitted rather than rendered empty.
     */
    private renderTicketLink;
}
export declare const pullRequestBuilder: PullRequestBuilder;
